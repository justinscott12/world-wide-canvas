/**
 * World Wide Canvas game server.
 * - Serves the built client (production) and upgrades `/ws` to WebSocket.
 * - Streams visible chunks to each client and broadcasts validated edits.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

import { CONFIG } from "@shared/config.js";
import { ChargeBucket } from "@shared/charges.js";
import { chunkKey, chunksInCellRect, brushCells, inBounds } from "@shared/chunk.js";
import { bytesToBase64 } from "@shared/protocol.js";
import type { ClientMsg, ServerMsg, EditedCell } from "@shared/protocol.js";
import { ChunkStore } from "./chunkStore.js";
import { SqliteStorage, MemoryStorage, type StorageAdapter, type EditRecord } from "./storage.js";

const { server: SRV } = CONFIG;
const CHUNK = CONFIG.chunkSize;
/** Never stream more than this many chunks for one viewport (far zoom = overview later). */
const MAX_CHUNKS_PER_VIEWPORT = 64;

const useDb = !process.argv.includes("--no-db");
const storage: StorageAdapter = useDb ? new SqliteStorage(SRV.dbFile) : new MemoryStorage();
const store = new ChunkStore(storage, CHUNK, SRV.maxChunksInMemory);

// chunkKey -> set of sockets currently viewing it (for targeted broadcast).
const subscribers = new Map<string, Set<WebSocket>>();

/**
 * Guardrail state shared by every connection from one IP, so opening tabs or
 * reconnecting shares a single charge budget / rate-limit window instead of
 * getting a fresh burst each time (the anti-takeover fix, per README).
 */
interface IpState {
  charges: ChargeBucket;
  editTimes: number[]; // recent paint timestamps, for the rate limit
  conns: number; // live connections from this IP
  lastSeen: number;
}
interface Client {
  id: string;
  ip: string;
  budget: IpState;
  viewing: Set<string>;
}
const clients = new WeakMap<WebSocket, Client>();
const ipStates = new Map<string, IpState>();

/** Real client IP behind a trusted proxy (Fly sets Fly-Client-IP; XFF otherwise). */
function clientIp(req: http.IncomingMessage): string {
  const fly = req.headers["fly-client-ip"];
  if (typeof fly === "string" && fly) return fly;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0]!.trim();
  return req.socket.remoteAddress || "unknown";
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function subscribe(ws: WebSocket, c: Client, cx: number, cy: number): void {
  const key = chunkKey(cx, cy);
  if (c.viewing.has(key)) return;
  c.viewing.add(key);
  let set = subscribers.get(key);
  if (!set) subscribers.set(key, (set = new Set()));
  set.add(ws);

  const view = store.getChunkView(cx, cy);
  send(ws, {
    type: "chunk",
    cx,
    cy,
    empty: view.empty,
    data: view.data ? bytesToBase64(view.data) : undefined,
  });
}

function unsubscribe(ws: WebSocket, c: Client, key: string): void {
  c.viewing.delete(key);
  const set = subscribers.get(key);
  if (set) {
    set.delete(ws);
    if (set.size === 0) subscribers.delete(key);
  }
}

function handleViewport(ws: WebSocket, c: Client, minX: number, minY: number, maxX: number, maxY: number): void {
  const wanted = chunksInCellRect(minX, minY, maxX, maxY, CHUNK, CONFIG.worldWidth, CONFIG.worldHeight);
  if (wanted.length > MAX_CHUNKS_PER_VIEWPORT) {
    // Too zoomed out to stream cell-accurate chunks; drop everything and wait
    // for the client to zoom in. (Overview tiles handle this range later.)
    for (const key of [...c.viewing]) unsubscribe(ws, c, key);
    return;
  }
  const wantedKeys = new Set(wanted.map((ch) => chunkKey(ch.cx, ch.cy)));
  // Unsubscribe from chunks that scrolled out of view.
  for (const key of [...c.viewing]) if (!wantedKeys.has(key)) unsubscribe(ws, c, key);
  // Subscribe to newly-visible chunks (sends their data).
  for (const ch of wanted) subscribe(ws, c, ch.cx, ch.cy);
}

function isByte(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 255;
}

function handlePaint(
  ws: WebSocket,
  c: Client,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  brush: number,
): void {
  if (!isByte(r) || !isByte(g) || !isByte(b)) {
    send(ws, { type: "reject", reason: "bad-color" });
    return;
  }
  if (!inBounds(x, y, CONFIG.worldWidth, CONFIG.worldHeight)) {
    send(ws, { type: "reject", reason: "out-of-bounds" });
    return;
  }

  const now = Date.now();
  // Sliding-window rate limit (anti-flood), shared across this IP's connections.
  if (SRV.rateLimitEnabled) {
    c.budget.editTimes = c.budget.editTimes.filter((t) => now - t < 1000);
    if (c.budget.editTimes.length >= SRV.maxEditsPerSecond) {
      send(ws, { type: "reject", reason: "rate-limited" });
      return;
    }
  }

  const size = Math.max(1, Math.min(CONFIG.maxBrushSize, Math.floor(brush) || 1));
  const cells = brushCells(x, y, size, CONFIG.worldWidth, CONFIG.worldHeight);
  if (cells.length === 0) return;

  if (CONFIG.chargesEnabled && !c.budget.charges.trySpend(cells.length, now)) {
    send(ws, { type: "reject", reason: "out-of-charges" });
    send(ws, { type: "charges", charges: c.budget.charges.current(now), nextInMs: c.budget.charges.nextInMs(now) });
    return;
  }
  if (SRV.rateLimitEnabled) c.budget.editTimes.push(now);

  const packed = (r << 16) | (g << 8) | b;
  const changed: EditedCell[] = [];
  const records: EditRecord[] = [];
  for (const cell of cells) {
    if (store.setCell(cell.x, cell.y, r, g, b)) {
      changed.push({ x: cell.x, y: cell.y, r, g, b });
      records.push({ session: c.id, x: cell.x, y: cell.y, color: packed, ts: now });
    }
  }

  if (changed.length > 0) {
    storage.appendEdits(records);
    broadcastEdits(changed);
  }
  if (CONFIG.chargesEnabled) {
    send(ws, { type: "charges", charges: c.budget.charges.current(now), nextInMs: c.budget.charges.nextInMs(now) });
  }
}

/** Send changed cells to every socket viewing an affected chunk (deduped). */
function broadcastEdits(cells: EditedCell[]): void {
  const affectedChunks = new Set<string>();
  for (const cell of cells) {
    affectedChunks.add(chunkKey(Math.floor(cell.x / CHUNK), Math.floor(cell.y / CHUNK)));
  }
  const targets = new Set<WebSocket>();
  for (const key of affectedChunks) {
    const set = subscribers.get(key);
    if (set) for (const ws of set) targets.add(ws);
  }
  const msg = JSON.stringify({ type: "edit", cells } satisfies ServerMsg);
  for (const ws of targets) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
}

// ---------------- HTTP + static client ----------------

const distDir = fileURLToPath(new URL("../dist/client", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const httpServer = http.createServer((req, res) => {
  if (!fs.existsSync(distDir)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("World Wide Canvas server is running. Start the client with `npm run dev:client`.");
    return;
  }
  const urlPath = (req.url || "/").split("?")[0]!;
  let filePath = path.join(distDir, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(distDir)) filePath = path.join(distDir, "index.html"); // path traversal guard
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html"); // SPA fallback
  }
  res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocketServer({ server: httpServer, path: SRV.wsPath });

wss.on("connection", (ws, req) => {
  const now = Date.now();
  const ip = clientIp(req);
  let budget = ipStates.get(ip);
  if (!budget) {
    budget = {
      charges: new ChargeBucket(CONFIG.chargeMax, CONFIG.chargeRefillMs, now),
      editTimes: [],
      conns: 0,
      lastSeen: now,
    };
    ipStates.set(ip, budget);
  }
  // Cap concurrent sockets per IP. The shared budget already stops charge-refill
  // abuse; this stops socket/subscription flooding from one source.
  if (budget.conns >= SRV.maxConnectionsPerIp) {
    ws.close(1013, "too many connections");
    return;
  }
  budget.conns++;
  budget.lastSeen = now;
  const client: Client = {
    id: randomUUID(),
    ip,
    budget,
    viewing: new Set(),
  };
  clients.set(ws, client);
  send(ws, { type: "welcome", config: CONFIG, sessionId: client.id, charges: budget.charges.current(now) });

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const c = clients.get(ws);
    if (!c) return;
    if (msg.type === "viewport") {
      handleViewport(ws, c, msg.minX, msg.minY, msg.maxX, msg.maxY);
    } else if (msg.type === "paint") {
      handlePaint(ws, c, msg.x, msg.y, msg.r, msg.g, msg.b, msg.brush);
    }
  });

  ws.on("close", () => {
    const c = clients.get(ws);
    if (c) {
      for (const key of [...c.viewing]) unsubscribe(ws, c, key);
      c.budget.conns = Math.max(0, c.budget.conns - 1);
      c.budget.lastSeen = Date.now();
    }
    clients.delete(ws);
  });
});

const snapshotTimer = setInterval(() => {
  const n = store.flushDirty();
  if (n > 0) console.log(`[snapshot] flushed ${n} chunk(s)`);
}, SRV.snapshotIntervalMs);

// Drop idle per-IP budgets once their charges have refilled anyway — frees
// memory without handing an active abuser a fresh burst.
const ipGcTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, st] of ipStates) {
    if (st.conns <= 0 && now - st.lastSeen > SRV.ipRetentionMs) ipStates.delete(ip);
  }
}, SRV.ipRetentionMs);
ipGcTimer.unref();

httpServer.listen(SRV.port, () => {
  console.log(`World Wide Canvas server on http://localhost:${SRV.port} (ws ${SRV.wsPath})`);
  console.log(`Storage: ${useDb ? SRV.dbFile : "in-memory (--no-db)"}`);
});

function shutdown(): void {
  console.log("\nShutting down — flushing world...");
  clearInterval(snapshotTimer);
  clearInterval(ipGcTimer);
  store.flushDirty();
  storage.close();
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
