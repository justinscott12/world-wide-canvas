import type { Cell } from "@shared/chunk.js";

/**
 * Integer cells along the line from (x0,y0) to (x1,y1), inclusive
 * (Bresenham). Used so a fast drag paints a continuous stroke instead of
 * dotted gaps between pointer samples.
 */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Cell[] {
  const cells: Cell[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}
