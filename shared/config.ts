/**
 * Central admin config — the single source of truth shared by client & server.
 * "Sensible defaults, tuned live": change values here and everything follows.
 */

/** Old palette-format sentinel for an unpainted cell (still used to migrate
 *  legacy chunks). New format is RGBA per cell, where alpha 0 means empty. */
export const EMPTY_CELL = 255;

/** Bytes per cell in the new RGBA chunk format. */
export const BYTES_PER_CELL = 4;

export interface WorldConfig {
  /** World size in cells (finite, but large). */
  worldWidth: number;
  worldHeight: number;
  /** Side length of a square chunk, in cells. */
  chunkSize: number;

  /** Paint colors. Index into this array is what we store per cell (0..len-1). */
  palette: string[];

  /** Grid overlay color. */
  gridColor: string;
  /** Background (unpainted) color inside the world. */
  backgroundColor: string;
  /** Color rendered outside the world's limits (the void). */
  voidColor: string;

  // --- Zoom, expressed as on-screen pixels per cell ---
  /** Most zoomed-out (smallest cells). Low enough to survey the whole world. */
  minCellPx: number;
  /** Most zoomed-in (largest cells). */
  maxCellPx: number;
  /** Starting zoom. */
  defaultCellPx: number;
  /** Painting is only allowed at/above this zoom (cells big enough to aim at). */
  minPaintCellPx: number;
  /** Grid is fully visible at/above `gridFullCellPx` and fades to nothing by `gridHideCellPx`. */
  gridFullCellPx: number;
  gridHideCellPx: number;

  /** Largest brush (NxN cells) any user may paint at once. */
  maxBrushSize: number;

  // --- Guardrails ---
  /** Master switch for the charge budget. When false, painting is unlimited. */
  chargesEnabled: boolean;
  /** Max pixel "charges" a session holds. */
  chargeMax: number;
  /** Milliseconds to regenerate one charge. */
  chargeRefillMs: number;

  server: ServerConfig;
}

export interface ServerConfig {
  port: number;
  /** WebSocket path the client connects to. */
  wsPath: string;
  /** SQLite database file. */
  dbFile: string;
  /** How often dirty chunks are flushed to disk. */
  snapshotIntervalMs: number;
  /** Master switch for the anti-flood rate limit. When false, no per-second cap. */
  rateLimitEnabled: boolean;
  /** Hard ceiling on edits accepted per IP per second (anti-flood). */
  maxEditsPerSecond: number;
  /** Max concurrent WebSocket connections from one IP (anti-flood). */
  maxConnectionsPerIp: number;
  /** How long to retain an IP's charge budget after its last connection closes,
   *  so reopening tabs / reconnecting can't reset the anti-takeover budget. */
  ipRetentionMs: number;
}

/** Read an env var when running under Node; return the default in the browser. */
function envStr(name: string, fallback: string): string {
  if (typeof process !== "undefined" && process.env && process.env[name]) return process.env[name]!;
  return fallback;
}
function envInt(name: string, fallback: number): number {
  const v = envStr(name, "");
  const n = Number(v);
  return v && Number.isFinite(n) ? n : fallback;
}

/** r/place-style 32-color palette. */
const PALETTE_32 = [
  "#6D001A", "#BE0039", "#FF4500", "#FFA800", "#FFD635", "#FFF8B8",
  "#00A368", "#00CC78", "#7EED56", "#00756F", "#009EAA", "#00CCC0",
  "#2450A4", "#3690EA", "#51E9F4", "#493AC1", "#6A5CFF", "#94B3FF",
  "#811E9F", "#B44AC0", "#E4ABFF", "#DE107F", "#FF3881", "#FF99AA",
  "#6D482F", "#9C6926", "#FFB470", "#000000", "#515252", "#898D90",
  "#D4D7D9", "#FFFFFF",
];

export const CONFIG: WorldConfig = {
  worldWidth: 262144,
  worldHeight: 262144,
  chunkSize: 256,

  palette: PALETTE_32,
  gridColor: "#e0e0e0",
  backgroundColor: "#ffffff",
  voidColor: "#000000",

  minCellPx: 0.1,
  maxCellPx: 40,
  defaultCellPx: 16,
  minPaintCellPx: 4.8,
  gridFullCellPx: 12,
  gridHideCellPx: 4,

  maxBrushSize: 10,

  // Anti-takeover: build big over time, but can't nuke the world at once.
  // Burst 1000 cells, then ~5 cells/sec sustained (+1 per 200ms).
  chargesEnabled: true,
  chargeMax: 1000,
  chargeRefillMs: 100,

  server: {
    // PORT is set by most cloud hosts (Fly, Railway); WWC_DB_FILE points at a
    // persistent volume in production.
    port: envInt("PORT", 8787),
    wsPath: "/ws",
    dbFile: envStr("WWC_DB_FILE", "world.db"),
    snapshotIntervalMs: 5000,
    // Anti-flood. Charges + this cap are keyed by client IP (see server/index.ts),
    // so opening tabs / reconnecting shares one budget rather than refilling it.
    rateLimitEnabled: true,
    maxEditsPerSecond: 120,
    maxConnectionsPerIp: 16,
    ipRetentionMs: 5 * 60_000,
  },
};
