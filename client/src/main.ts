import { CONFIG } from "@shared/config.js";
import { clamp, worldMin, worldMaxExclusive } from "@shared/chunk.js";
import { predictCharges } from "@shared/charges.js";
import { Camera } from "./camera.js";
import { WorldRenderer } from "./world.js";
import { Net } from "./net.js";
import { UI } from "./ui.js";
import { lineCells } from "./line.js";
import type { RGB } from "./color.js";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const camera = new Camera();
const renderer = new WorldRenderer();

let color: RGB = { r: 190, g: 0, b: 57 };
let brush = 1;

const ui = new UI({
  onColor: (rgb) => (color = rgb),
  onBrush: (b) => (brush = b),
  onTeleport: (x, y) => {
    camera.cx = clamp(x, worldMin(CONFIG.worldWidth), worldMaxExclusive(CONFIG.worldWidth) - 1) + 0.5;
    camera.cy = clamp(y, worldMin(CONFIG.worldHeight), worldMaxExclusive(CONFIG.worldHeight) - 1) + 0.5;
    if (camera.cellPx < CONFIG.minPaintCellPx) camera.cellPx = CONFIG.defaultCellPx;
    forceViewport = true;
  },
});

// ---------------- Canvas sizing ----------------

let viewW = 0;
let viewH = 0;
let dpr = 1;

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
}
window.addEventListener("resize", resize);
resize();

// ---------------- Networking ----------------

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${CONFIG.server.wsPath}`;
let forceViewport = false;

// Last server-reported charge value, used to predict the live count between
// messages so the meter ticks up as charges regenerate.
let chargeBase = CONFIG.chargeMax;
let chargeBaseTime = performance.now();
let chargeFirstInMs = CONFIG.chargeRefillMs;
function syncCharges(charges: number, nextInMs: number): void {
  chargeBase = charges;
  chargeBaseTime = performance.now();
  chargeFirstInMs = nextInMs;
}

const net = new Net(wsUrl, {
  onWelcome: (_id, charges) => {
    syncCharges(charges, CONFIG.chargeRefillMs);
    forceViewport = true;
  },
  onChunk: (cx, cy, empty, data) => renderer.setChunk(cx, cy, empty, data),
  onEdit: (cells) => renderer.applyEdits(cells),
  onCharges: (charges, nextInMs) => syncCharges(charges, nextInMs),
  onReject: (reason) => {
    if (reason === "out-of-charges") ui.toast("Out of charges — wait a moment");
    else if (reason === "rate-limited") ui.toast("Slow down!");
    else if (reason === "banned") ui.toast("You are blocked from painting");
  },
  onStatus: (connected) => {
    ui.setStatus(connected);
    if (connected) forceViewport = true;
  },
});
net.connect();

// Throttled viewport reporting so the server streams the right chunks.
let lastRect = { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
let lastViewportSent = 0;
function maybeSendViewport(now: number): void {
  if (!net.connected) return;
  const tl = camera.screenToWorld(0, 0, viewW, viewH);
  const br = camera.screenToWorld(viewW, viewH, viewW, viewH);
  const rect = {
    minX: Math.floor(tl.x),
    minY: Math.floor(tl.y),
    maxX: Math.ceil(br.x),
    maxY: Math.ceil(br.y),
  };
  const changed =
    rect.minX !== lastRect.minX ||
    rect.minY !== lastRect.minY ||
    rect.maxX !== lastRect.maxX ||
    rect.maxY !== lastRect.maxY;
  if ((changed || forceViewport) && now - lastViewportSent > 100) {
    net.sendViewport(rect.minX, rect.minY, rect.maxX, rect.maxY);
    lastRect = rect;
    lastViewportSent = now;
    forceViewport = false;
  }
}

// ---------------- Painting ----------------

let lastPaintCell: { x: number; y: number } | null = null;

function paintCell(x: number, y: number): void {
  if (!camera.canPaint()) return;
  net.sendPaint(x, y, color.r, color.g, color.b, brush);
}

function paintTo(x: number, y: number): void {
  if (!camera.canPaint()) return;
  if (lastPaintCell && (lastPaintCell.x !== x || lastPaintCell.y !== y)) {
    // Fill the gap between pointer samples so fast drags stay continuous.
    const cells = lineCells(lastPaintCell.x, lastPaintCell.y, x, y);
    for (const c of cells) {
      if (c.x === lastPaintCell.x && c.y === lastPaintCell.y) continue;
      paintCell(c.x, c.y);
    }
  } else if (!lastPaintCell) {
    paintCell(x, y);
  }
  lastPaintCell = { x, y };
}

// ---------------- Pointer input (pan / zoom / pinch / paint) ----------------

interface Pt {
  x: number;
  y: number;
}
const pointers = new Map<number, Pt>();
let mode: "none" | "paint" | "pan" | "pinch" = "none";
let panPrev: Pt = { x: 0, y: 0 };
let pinchDist = 0;
let pinchMid: Pt = { x: 0, y: 0 };
let hover: { x: number; y: number } | null = null;
let spaceHeld = false;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    startPinch();
    mode = "pinch";
    lastPaintCell = null;
    return;
  }

  const wantPaint = camera.canPaint() && e.button === 0 && !spaceHeld;
  if (wantPaint) {
    mode = "paint";
    lastPaintCell = null;
    const cell = camera.cellAt(e.clientX, e.clientY, viewW, viewH);
    paintTo(cell.x, cell.y);
  } else {
    mode = "pan";
    panPrev = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener("pointermove", (e) => {
  const cur = { x: e.clientX, y: e.clientY };
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, cur);
  hover = camera.cellAt(cur.x, cur.y, viewW, viewH);

  if (mode === "pinch" && pointers.size >= 2) {
    updatePinch();
    return;
  }
  if (mode === "paint") {
    const cell = camera.cellAt(cur.x, cur.y, viewW, viewH);
    paintTo(cell.x, cell.y);
    return;
  }
  if (mode === "pan") {
    camera.panByPixels(cur.x - panPrev.x, cur.y - panPrev.y);
    panPrev = cur;
  }
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size === 1) {
    // Dropped from pinch to one finger — continue as a pan from where it is.
    const [pt] = [...pointers.values()];
    mode = "pan";
    panPrev = pt!;
    lastPaintCell = null;
  } else if (pointers.size === 0) {
    mode = "none";
    lastPaintCell = null;
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

function startPinch(): void {
  const [a, b] = [...pointers.values()];
  pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
  pinchMid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
}
function updatePinch(): void {
  const [a, b] = [...pointers.values()];
  const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
  const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  camera.zoomAt(dist / pinchDist, mid.x, mid.y, viewW, viewH);
  camera.panByPixels(mid.x - pinchMid.x, mid.y - pinchMid.y);
  pinchDist = dist;
  pinchMid = mid;
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    camera.zoomAt(factor, e.clientX, e.clientY, viewW, viewH);
  },
  { passive: false },
);

// ---------------- Keyboard (WASD pan, space to pan-drag) ----------------

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") spaceHeld = true;
  keys.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") spaceHeld = false;
  keys.delete(e.key.toLowerCase());
});

function applyKeyboardPan(dt: number): void {
  const step = 700 * dt; // pixels/second
  let dx = 0;
  let dy = 0;
  if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
  if (keys.has("d") || keys.has("arrowright")) dx += 1;
  if (keys.has("w") || keys.has("arrowup")) dy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) dy += 1;
  if (dx !== 0 || dy !== 0) camera.panByPixels(-dx * step, -dy * step);
}

// ---------------- Render loop ----------------

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  applyKeyboardPan(dt);
  maybeSendViewport(now);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderer.render(ctx, camera, viewW, viewH, hover, brush);

  const readout = hover ?? { x: Math.floor(camera.cx), y: Math.floor(camera.cy) };
  ui.setCoords(readout.x, readout.y);
  ui.noteCenter(Math.floor(camera.cx), Math.floor(camera.cy));

  // Live-predicted charge count (ticks up between server messages).
  ui.setCharges(
    CONFIG.chargesEnabled
      ? predictCharges(chargeBase, now - chargeBaseTime, chargeFirstInMs, CONFIG.chargeRefillMs, CONFIG.chargeMax)
      : CONFIG.chargeMax,
  );

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
