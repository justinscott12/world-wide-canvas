import { describe, it, expect } from "vitest";
import { lineCells } from "./line.js";

describe("lineCells", () => {
  it("returns a single cell when start equals end", () => {
    expect(lineCells(3, 3, 3, 3)).toEqual([{ x: 3, y: 3 }]);
  });

  it("walks a horizontal run with no gaps", () => {
    expect(lineCells(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("walks a perfect diagonal", () => {
    expect(lineCells(0, 0, 2, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("is contiguous (each step moves at most one cell) for a shallow slope", () => {
    const cells = lineCells(0, 0, 10, 3);
    for (let i = 1; i < cells.length; i++) {
      const dx = Math.abs(cells[i]!.x - cells[i - 1]!.x);
      const dy = Math.abs(cells[i]!.y - cells[i - 1]!.y);
      expect(Math.max(dx, dy)).toBe(1);
    }
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells[cells.length - 1]).toEqual({ x: 10, y: 3 });
  });

  it("handles reversed direction", () => {
    expect(lineCells(3, 0, 0, 0)).toEqual([
      { x: 3, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});
