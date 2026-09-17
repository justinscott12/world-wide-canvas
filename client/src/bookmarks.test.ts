import { describe, it, expect } from "vitest";
import { parseBookmarks } from "./bookmarks.js";

describe("parseBookmarks", () => {
  it("returns [] for null / empty / malformed input", () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks("")).toEqual([]);
    expect(parseBookmarks("not json")).toEqual([]);
    expect(parseBookmarks('{"x":1}')).toEqual([]); // not an array
  });

  it("keeps valid entries and drops invalid ones", () => {
    const raw = JSON.stringify([
      { name: "Home", x: 0, y: 0 },
      { name: "bad", x: 1.5, y: 2 }, // non-integer
      { name: 123, x: 3, y: 4 }, // bad name
      { x: 5, y: 6 }, // missing name
      { name: "Spot", x: -100, y: 200 },
    ]);
    expect(parseBookmarks(raw)).toEqual([
      { name: "Home", x: 0, y: 0 },
      { name: "Spot", x: -100, y: 200 },
    ]);
  });

  it("clamps overly long names", () => {
    const raw = JSON.stringify([{ name: "x".repeat(100), x: 0, y: 0 }]);
    expect(parseBookmarks(raw)[0]!.name).toHaveLength(40);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `p${i}`, x: i, y: i }));
    expect(parseBookmarks(JSON.stringify(many))).toHaveLength(50);
  });
});
