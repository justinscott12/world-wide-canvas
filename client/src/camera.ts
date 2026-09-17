import { CONFIG } from "@shared/config.js";
import { clamp, worldMin, worldMaxExclusive } from "@shared/chunk.js";

/**
 * The view onto the world. Center is in world-cell coordinates (fractional);
 * `cellPx` is how many screen pixels one cell occupies (i.e. the zoom).
 */
export class Camera {
  cx: number;
  cy: number;
  cellPx: number;

  constructor() {
    // Everyone spawns at the world origin (0,0) — a shared anchor point.
    this.cx = 0;
    this.cy = 0;
    this.cellPx = CONFIG.defaultCellPx;
  }

  /** Screen pixel -> world cell (fractional). */
  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: (sx - viewW / 2) / this.cellPx + this.cx,
      y: (sy - viewH / 2) / this.cellPx + this.cy,
    };
  }

  /** World cell -> screen pixel. */
  worldToScreen(wx: number, wy: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: (wx - this.cx) * this.cellPx + viewW / 2,
      y: (wy - this.cy) * this.cellPx + viewH / 2,
    };
  }

  /** The integer cell under a screen pixel. */
  cellAt(sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
    const w = this.screenToWorld(sx, sy, viewW, viewH);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  panByPixels(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.cellPx;
    this.cy -= dyPx / this.cellPx;
    this.clampCenter();
  }

  /** Zoom by `factor`, keeping the world point under (sx,sy) fixed on screen. */
  zoomAt(factor: number, sx: number, sy: number, viewW: number, viewH: number): void {
    const before = this.screenToWorld(sx, sy, viewW, viewH);
    this.cellPx = clamp(this.cellPx * factor, CONFIG.minCellPx, CONFIG.maxCellPx);
    const after = this.screenToWorld(sx, sy, viewW, viewH);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clampCenter();
  }

  canPaint(): boolean {
    return this.cellPx >= CONFIG.minPaintCellPx;
  }

  private clampCenter(): void {
    this.cx = clamp(this.cx, worldMin(CONFIG.worldWidth), worldMaxExclusive(CONFIG.worldWidth));
    this.cy = clamp(this.cy, worldMin(CONFIG.worldHeight), worldMaxExclusive(CONFIG.worldHeight));
  }
}
