import { describe, it, expect } from "vitest";
import {
  cellToChunk,
  chunkKey,
  parseChunkKey,
  localIndex,
  inBounds,
  chunkGridSize,
  chunksInCellRect,
  brushCells,
  worldMin,
  worldMaxExclusive,
} from "./chunk.js";

const CS = 256;
const W = 8192;
const H = 8192;

describe("worldMin / worldMaxExclusive (origin-centered)", () => {
  it("centers the world on 0,0", () => {
    expect(worldMin(8192)).toBe(-4096);
    expect(worldMaxExclusive(8192)).toBe(4096);
  });
});

describe("cellToChunk", () => {
  it("maps origin to chunk 0,0", () => {
    expect(cellToChunk(0, 0, CS)).toEqual({ cx: 0, cy: 0 });
  });
  it("maps a cell just inside a chunk boundary", () => {
    expect(cellToChunk(255, 255, CS)).toEqual({ cx: 0, cy: 0 });
    expect(cellToChunk(256, 256, CS)).toEqual({ cx: 1, cy: 1 });
  });
  it("maps negative cells to negative chunks", () => {
    expect(cellToChunk(-1, -1, CS)).toEqual({ cx: -1, cy: -1 });
    expect(cellToChunk(-256, -256, CS)).toEqual({ cx: -1, cy: -1 });
    expect(cellToChunk(-257, -257, CS)).toEqual({ cx: -2, cy: -2 });
  });
});

describe("chunkKey / parseChunkKey round-trip", () => {
  it("round-trips", () => {
    expect(parseChunkKey(chunkKey(12, 34))).toEqual({ cx: 12, cy: 34 });
  });
});

describe("localIndex", () => {
  it("is 0 at a chunk's top-left", () => {
    expect(localIndex(256, 512, CS)).toBe(0);
  });
  it("is chunkSize-1 at the end of the first row", () => {
    expect(localIndex(255, 0, CS)).toBe(255);
  });
  it("computes row-major offset", () => {
    // cell (257, 513) -> local (1, 1) -> 1*256 + 1
    expect(localIndex(257, 513, CS)).toBe(CS + 1);
  });
  it("stays within a chunk's byte range", () => {
    expect(localIndex(8191, 8191, CS)).toBe(CS * CS - 1);
  });
  it("wraps negative coords into the correct local slot", () => {
    // (-1,-1) is the bottom-right cell of chunk (-1,-1)
    expect(localIndex(-1, -1, CS)).toBe(CS * CS - 1);
    expect(localIndex(-256, -256, CS)).toBe(0); // top-left of chunk (-1,-1)
  });
});

describe("inBounds (origin-centered)", () => {
  it("accepts the origin and cells just around it, including negatives", () => {
    expect(inBounds(0, 0, W, H)).toBe(true);
    expect(inBounds(-1, -1, W, H)).toBe(true);
  });
  it("accepts the extreme corners", () => {
    expect(inBounds(-4096, -4096, W, H)).toBe(true);
    expect(inBounds(4095, 4095, W, H)).toBe(true);
  });
  it("rejects cells past the edges and non-integers", () => {
    expect(inBounds(-4097, 0, W, H)).toBe(false);
    expect(inBounds(4096, 0, W, H)).toBe(false);
    expect(inBounds(0, 4096, W, H)).toBe(false);
    expect(inBounds(1.5, 0, W, H)).toBe(false);
  });
});

describe("chunkGridSize", () => {
  it("divides evenly", () => {
    expect(chunkGridSize(8192, 256)).toBe(32);
  });
  it("rounds up a partial final chunk", () => {
    expect(chunkGridSize(300, 256)).toBe(2);
  });
});

describe("chunksInCellRect", () => {
  it("returns a single chunk for a small rect", () => {
    expect(chunksInCellRect(10, 10, 20, 20, CS, W, H)).toEqual([{ cx: 0, cy: 0 }]);
  });
  it("includes negative chunks around the origin", () => {
    const chunks = chunksInCellRect(-10, -10, 10, 10, CS, W, H);
    expect(chunks).toContainEqual({ cx: -1, cy: -1 });
    expect(chunks).toContainEqual({ cx: 0, cy: 0 });
    expect(chunks).toHaveLength(4); // {-1,0} × {-1,0}
  });
  it("clamps to the world's chunk extent", () => {
    // world min chunk is floor(-4096/256) = -16
    const chunks = chunksInCellRect(-999999, -999999, -4096, -4096, CS, W, H);
    expect(chunks.every((c) => c.cx >= -16 && c.cy >= -16)).toBe(true);
    expect(chunks).toContainEqual({ cx: -16, cy: -16 });
  });
});

describe("brushCells", () => {
  it("returns a single cell for size 1", () => {
    expect(brushCells(5, 5, 1, W, H)).toEqual([{ x: 5, y: 5 }]);
  });
  it("returns NxN cells for larger brushes", () => {
    expect(brushCells(5, 5, 3, W, H)).toHaveLength(9);
  });
  it("paints all 9 cells of a 3x3 brush around the origin (negatives allowed)", () => {
    const cells = brushCells(0, 0, 3, W, H);
    expect(cells).toContainEqual({ x: -1, y: -1 });
    expect(cells).toContainEqual({ x: 0, y: 0 });
    expect(cells).toHaveLength(9);
  });
  it("clamps against the world's outer corner", () => {
    // top-left corner: the -4097 row/column is out of bounds and dropped
    const cells = brushCells(-4096, -4096, 3, W, H);
    expect(cells.every((c) => c.x >= -4096 && c.y >= -4096)).toBe(true);
    expect(cells).toContainEqual({ x: -4096, y: -4096 });
    expect(cells).toHaveLength(4);
  });
});
