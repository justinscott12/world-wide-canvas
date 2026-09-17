/**
 * Pure chunk / coordinate math shared by client & server.
 * Cells are 0-indexed: valid x in [0, worldWidth), y in [0, worldHeight).
 */

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export interface Cell {
  x: number;
  y: number;
}

/**
 * The world is centered on the origin: valid cells span
 * [worldMin(size), worldMaxExclusive(size)), so 0,0 sits at the middle.
 * For size 8192 that's cells -4096 .. 4095.
 */
export function worldMin(size: number): number {
  return -Math.floor(size / 2);
}
export function worldMaxExclusive(size: number): number {
  return worldMin(size) + size;
}

/** Which chunk a cell belongs to. */
export function cellToChunk(x: number, y: number, chunkSize: number): ChunkCoord {
  return { cx: Math.floor(x / chunkSize), cy: Math.floor(y / chunkSize) };
}

/** Stable string key for a chunk (usable as a Map key). */
export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function parseChunkKey(key: string): ChunkCoord {
  const comma = key.indexOf(",");
  return { cx: Number(key.slice(0, comma)), cy: Number(key.slice(comma + 1)) };
}

/** Index of a cell within its chunk's flat byte array. */
export function localIndex(x: number, y: number, chunkSize: number): number {
  const lx = x - Math.floor(x / chunkSize) * chunkSize;
  const ly = y - Math.floor(y / chunkSize) * chunkSize;
  return ly * chunkSize + lx;
}

/** True when a cell is inside the finite, origin-centered world. */
export function inBounds(x: number, y: number, worldWidth: number, worldHeight: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= worldMin(worldWidth) &&
    y >= worldMin(worldHeight) &&
    x < worldMaxExclusive(worldWidth) &&
    y < worldMaxExclusive(worldHeight)
  );
}

/** Number of chunks spanning each axis. */
export function chunkGridSize(worldSize: number, chunkSize: number): number {
  return Math.ceil(worldSize / chunkSize);
}

/**
 * Every chunk coordinate overlapping the given inclusive cell rectangle,
 * clamped to the world. Used for viewport subscription.
 */
export function chunksInCellRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  chunkSize: number,
  worldWidth: number,
  worldHeight: number,
): ChunkCoord[] {
  const minCX = Math.floor(worldMin(worldWidth) / chunkSize);
  const maxCX = Math.floor((worldMaxExclusive(worldWidth) - 1) / chunkSize);
  const minCY = Math.floor(worldMin(worldHeight) / chunkSize);
  const maxCY = Math.floor((worldMaxExclusive(worldHeight) - 1) / chunkSize);
  const cx0 = clamp(Math.floor(minX / chunkSize), minCX, maxCX);
  const cy0 = clamp(Math.floor(minY / chunkSize), minCY, maxCY);
  const cx1 = clamp(Math.floor(maxX / chunkSize), minCX, maxCX);
  const cy1 = clamp(Math.floor(maxY / chunkSize), minCY, maxCY);
  const out: ChunkCoord[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      out.push({ cx, cy });
    }
  }
  return out;
}

/**
 * Cells covered by an NxN brush centered (as best as possible) on (x, y),
 * clamped to the world. Never returns more than size*size cells.
 */
export function brushCells(
  x: number,
  y: number,
  size: number,
  worldWidth: number,
  worldHeight: number,
): Cell[] {
  const n = Math.max(1, Math.floor(size));
  const offset = Math.floor((n - 1) / 2);
  const cells: Cell[] = [];
  for (let dy = 0; dy < n; dy++) {
    for (let dx = 0; dx < n; dx++) {
      const cx = x - offset + dx;
      const cy = y - offset + dy;
      if (inBounds(cx, cy, worldWidth, worldHeight)) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
