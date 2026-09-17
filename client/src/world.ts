import { CONFIG } from "@shared/config.js";
import { chunkKey, chunksInCellRect, brushCells, worldMin, worldMaxExclusive } from "@shared/chunk.js";
import type { EditedCell } from "@shared/protocol.js";
import type { Camera } from "./camera.js";

const CS = CONFIG.chunkSize;

/** Clamp a screen coordinate into [0, max]. */
function clampPx(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/** One rendered chunk: a CS×CS canvas where each pixel is a cell (RGBA). */
interface ChunkTile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export class WorldRenderer {
  private tiles = new Map<string, ChunkTile>();

  private tile(cx: number, cy: number): ChunkTile {
    const key = chunkKey(cx, cy);
    let tile = this.tiles.get(key);
    if (!tile) {
      const canvas = document.createElement("canvas");
      canvas.width = CS;
      canvas.height = CS;
      const ctx = canvas.getContext("2d")!;
      tile = { canvas, ctx };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  /** Load a full RGBA chunk (from the server) into its tile canvas. */
  setChunk(cx: number, cy: number, empty: boolean, data?: Uint8Array): void {
    const tile = this.tile(cx, cy);
    if (empty || !data || data.length !== CS * CS * 4) {
      tile.ctx.clearRect(0, 0, CS, CS);
      return;
    }
    const img = tile.ctx.createImageData(CS, CS);
    img.data.set(data);
    tile.ctx.putImageData(img, 0, 0);
  }

  /** Apply incremental edits (from the server broadcast). */
  applyEdits(cells: EditedCell[]): void {
    for (const cell of cells) {
      const cx = Math.floor(cell.x / CS);
      const cy = Math.floor(cell.y / CS);
      const tile = this.tile(cx, cy);
      const lx = cell.x - cx * CS;
      const ly = cell.y - cy * CS;
      tile.ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
      tile.ctx.fillRect(lx, ly, 1, 1);
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    viewW: number,
    viewH: number,
    hover: { x: number; y: number } | null,
    brush: number,
  ): void {
    // Outside the world limits is void; inside is the paintable background.
    ctx.fillStyle = CONFIG.voidColor;
    ctx.fillRect(0, 0, viewW, viewH);
    const wtl = cam.worldToScreen(worldMin(CONFIG.worldWidth), worldMin(CONFIG.worldHeight), viewW, viewH);
    const wbr = cam.worldToScreen(
      worldMaxExclusive(CONFIG.worldWidth),
      worldMaxExclusive(CONFIG.worldHeight),
      viewW,
      viewH,
    );
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(wtl.x, wtl.y, wbr.x - wtl.x, wbr.y - wtl.y);

    const tl = cam.screenToWorld(0, 0, viewW, viewH);
    const br = cam.screenToWorld(viewW, viewH, viewW, viewH);
    const visible = chunksInCellRect(
      Math.floor(tl.x),
      Math.floor(tl.y),
      Math.floor(br.x),
      Math.floor(br.y),
      CS,
      CONFIG.worldWidth,
      CONFIG.worldHeight,
    );

    ctx.imageSmoothingEnabled = false;
    for (const { cx, cy } of visible) {
      const tile = this.tiles.get(chunkKey(cx, cy));
      if (!tile) continue;
      const p = cam.worldToScreen(cx * CS, cy * CS, viewW, viewH);
      const size = CS * cam.cellPx;
      ctx.drawImage(tile.canvas, p.x, p.y, size, size);
    }

    this.drawGrid(ctx, cam, viewW, viewH, tl, br);
    this.drawBrushCursor(ctx, cam, viewW, viewH, hover, brush);
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    viewW: number,
    viewH: number,
    tl: { x: number; y: number },
    br: { x: number; y: number },
  ): void {
    const { cellPx } = cam;
    if (cellPx < CONFIG.gridHideCellPx) return;
    const t = Math.min(1, (cellPx - CONFIG.gridHideCellPx) / (CONFIG.gridFullCellPx - CONFIG.gridHideCellPx));
    ctx.save();
    ctx.globalAlpha = t;
    ctx.strokeStyle = CONFIG.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wMinX = worldMin(CONFIG.worldWidth);
    const wMaxX = worldMaxExclusive(CONFIG.worldWidth);
    const wMinY = worldMin(CONFIG.worldHeight);
    const wMaxY = worldMaxExclusive(CONFIG.worldHeight);
    const x0 = Math.max(wMinX, Math.floor(tl.x));
    const x1 = Math.min(wMaxX, Math.ceil(br.x));
    const y0 = Math.max(wMinY, Math.floor(tl.y));
    const y1 = Math.min(wMaxY, Math.ceil(br.y));
    // Confine grid lines to the world rect so they don't bleed into the void.
    const topY = clampPx(cam.worldToScreen(wMinX, wMinY, viewW, viewH).y, viewH);
    const botY = clampPx(cam.worldToScreen(wMinX, wMaxY, viewW, viewH).y, viewH);
    const leftX = clampPx(cam.worldToScreen(wMinX, wMinY, viewW, viewH).x, viewW);
    const rightX = clampPx(cam.worldToScreen(wMaxX, wMinY, viewW, viewH).x, viewW);
    for (let x = x0; x <= x1; x++) {
      const sx = Math.round(cam.worldToScreen(x, 0, viewW, viewH).x) + 0.5;
      ctx.moveTo(sx, topY);
      ctx.lineTo(sx, botY);
    }
    for (let y = y0; y <= y1; y++) {
      const sy = Math.round(cam.worldToScreen(0, y, viewW, viewH).y) + 0.5;
      ctx.moveTo(leftX, sy);
      ctx.lineTo(rightX, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBrushCursor(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    viewW: number,
    viewH: number,
    hover: { x: number; y: number } | null,
    brush: number,
  ): void {
    if (!hover || !cam.canPaint()) return;
    const cells = brushCells(hover.x, hover.y, brush, CONFIG.worldWidth, CONFIG.worldHeight);
    if (cells.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
    const p = cam.worldToScreen(minX, minY, viewW, viewH);
    const w = (maxX - minX + 1) * cam.cellPx;
    const h = (maxY - minY + 1) * cam.cellPx;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 1, p.y + 1, w - 2, h - 2);
    ctx.restore();
  }
}
