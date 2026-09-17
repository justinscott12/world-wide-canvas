import { describe, it, expect } from "vitest";
import { ChunkStore } from "./chunkStore.js";
import { MemoryStorage } from "./storage.js";
import { EMPTY_CELL, BYTES_PER_CELL } from "@shared/config.js";
import { cellToChunk, localIndex } from "@shared/chunk.js";

const CS = 256;

function rgbaAt(data: Uint8Array, x: number, y: number): number[] {
  const o = localIndex(x, y, CS) * BYTES_PER_CELL;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
}

describe("ChunkStore (RGBA)", () => {
  it("reports fresh chunks as empty", () => {
    const store = new ChunkStore(new MemoryStorage(), CS);
    expect(store.getChunkView(0, 0)).toEqual({ empty: true });
  });

  it("marks a chunk non-empty after a paint and stores the RGB + opaque alpha", () => {
    const store = new ChunkStore(new MemoryStorage(), CS);
    expect(store.setCell(10, 20, 12, 34, 56)).toBe(true);
    const view = store.getChunkView(0, 0);
    expect(view.empty).toBe(false);
    expect(rgbaAt(view.data!, 10, 20)).toEqual([12, 34, 56, 255]);
  });

  it("returns false when painting the same color twice", () => {
    const store = new ChunkStore(new MemoryStorage(), CS);
    store.setCell(5, 5, 100, 100, 100);
    expect(store.setCell(5, 5, 100, 100, 100)).toBe(false);
  });

  it("persists to storage and reloads into a fresh store", () => {
    const storage = new MemoryStorage();
    const store = new ChunkStore(storage, CS);
    store.setCell(300, 400, 9, 8, 7); // chunk (1,1)
    expect(store.flushDirty()).toBe(1);

    const { cx, cy } = cellToChunk(300, 400, CS);
    const reloaded = new ChunkStore(storage, CS);
    const view = reloaded.getChunkView(cx, cy);
    expect(view.empty).toBe(false);
    expect(rgbaAt(view.data!, 300, 400)).toEqual([9, 8, 7, 255]);
  });

  it("evicts least-recently-used flushed chunks past the cap, reloading on access", () => {
    const storage = new MemoryStorage();
    const store = new ChunkStore(storage, CS, 4); // tiny cap for the test
    // Paint 10 distinct chunks, flushing each so it becomes clean/evictable.
    for (let i = 0; i < 10; i++) {
      store.setCell(i * CS + 1, i * CS + 1, i + 1, i + 1, i + 1); // chunk (i,i)
      store.flushDirty();
    }
    expect(store.inMemoryCount).toBeLessThanOrEqual(4); // memory stayed bounded
    // An early, evicted chunk still returns correct data (reloaded from storage).
    const view = store.getChunkView(0, 0);
    expect(view.empty).toBe(false);
    expect(rgbaAt(view.data!, 1, 1)).toEqual([1, 1, 1, 255]);
  });

  it("never evicts chunks with unflushed edits", () => {
    const store = new ChunkStore(new MemoryStorage(), CS, 2); // cap below the load
    for (let i = 0; i < 5; i++) store.setCell(i * CS + 1, 1, 1, 1, 1); // 5 dirty chunks
    expect(store.inMemoryCount).toBe(5); // all retained — evicting would lose edits
    expect(store.flushDirty()).toBe(5);
    store.getChunkView(9 * CS, 0); // now-clean chunks become evictable on next load
    expect(store.inMemoryCount).toBeLessThanOrEqual(2);
  });

  it("migrates a legacy 1-byte palette chunk to RGBA on load", () => {
    const storage = new MemoryStorage();
    // Build an old-format chunk: all EMPTY except one cell set to palette index 2.
    const legacy = new Uint8Array(CS * CS).fill(EMPTY_CELL);
    legacy[localIndex(1, 1, CS)] = 2; // "#FF4500" in the default palette
    storage.saveChunk(0, 0, legacy);

    const store = new ChunkStore(storage, CS);
    const view = store.getChunkView(0, 0);
    expect(view.empty).toBe(false);
    expect(rgbaAt(view.data!, 1, 1)).toEqual([0xff, 0x45, 0x00, 255]);
    // migrated chunk is marked dirty so it re-saves in the new format
    expect(store.flushDirty()).toBe(1);
  });
});
