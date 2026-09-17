/**
 * In-memory authoritative world state. Chunks are lazily loaded from storage
 * on first access, mutated in memory, and periodically flushed back.
 *
 * Cell format is RGBA (4 bytes/cell); alpha 0 means "unpainted". Legacy
 * palette-index chunks (1 byte/cell) are migrated on load.
 */
import { EMPTY_CELL, BYTES_PER_CELL, CONFIG } from "@shared/config.js";
import { cellToChunk, chunkKey, localIndex } from "@shared/chunk.js";
import type { StorageAdapter } from "./storage.js";

export interface ChunkView {
  empty: boolean;
  /** RGBA bytes, present iff !empty. */
  data?: Uint8Array;
}

/** Palette as RGB triples, for migrating legacy 1-byte-per-cell chunks. */
const LEGACY_PALETTE_RGB = CONFIG.palette.map((hex) => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
});

export class ChunkStore {
  private chunks = new Map<string, Uint8Array>();
  /** Count of painted (alpha>0) cells per chunk, to answer "is empty?" cheaply. */
  private paintedCount = new Map<string, number>();
  private dirty = new Set<string>();
  private readonly bytesPerChunk: number;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly chunkSize: number,
    private readonly maxChunks = 2048,
  ) {
    this.bytesPerChunk = chunkSize * chunkSize * BYTES_PER_CELL;
  }

  private countPainted(data: Uint8Array): number {
    let n = 0;
    for (let i = 3; i < data.length; i += BYTES_PER_CELL) if (data[i] !== 0) n++;
    return n;
  }

  /** Convert a legacy 1-byte-per-cell palette chunk to RGBA. */
  private migrateLegacy(old: Uint8Array): Uint8Array {
    const data = new Uint8Array(this.bytesPerChunk);
    for (let i = 0; i < old.length; i++) {
      const v = old[i]!;
      if (v === EMPTY_CELL || v >= LEGACY_PALETTE_RGB.length) continue; // leave transparent
      const rgb = LEGACY_PALETTE_RGB[v]!;
      const o = i * BYTES_PER_CELL;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
    return data;
  }

  private ensureChunk(cx: number, cy: number): Uint8Array {
    const key = chunkKey(cx, cy);
    const cached = this.chunks.get(key);
    if (cached) {
      // Touch: move to the most-recently-used end (Map keeps insertion order).
      this.chunks.delete(key);
      this.chunks.set(key, cached);
      return cached;
    }

    let data: Uint8Array;
    const loaded = this.storage.loadChunk(cx, cy);
    if (loaded && loaded.length === this.bytesPerChunk) {
      data = loaded; // already RGBA
      this.paintedCount.set(key, this.countPainted(data));
    } else if (loaded && loaded.length === this.chunkSize * this.chunkSize) {
      data = this.migrateLegacy(loaded); // legacy palette chunk
      this.paintedCount.set(key, this.countPainted(data));
      this.dirty.add(key); // persist in the new format
    } else {
      data = new Uint8Array(this.bytesPerChunk); // all zero = empty
      this.paintedCount.set(key, 0);
    }
    this.chunks.set(key, data);
    this.evictIfNeeded(key);
    return data;
  }

  /**
   * Evict least-recently-used chunks once over the cap, skipping any with
   * unflushed edits (they'd lose data) and the just-loaded chunk (a caller is
   * about to use it, and setCell marks it dirty only after this runs). Evicted
   * chunks lazily reload from storage, bounding memory on a huge, explored world.
   */
  private evictIfNeeded(protectedKey: string): void {
    if (this.chunks.size <= this.maxChunks) return;
    for (const key of this.chunks.keys()) {
      if (this.chunks.size <= this.maxChunks) break;
      if (key === protectedKey || this.dirty.has(key)) continue;
      this.chunks.delete(key);
      this.paintedCount.delete(key);
    }
  }

  /** Chunk contents for a client, cheaply flagged empty when nothing is painted. */
  getChunkView(cx: number, cy: number): ChunkView {
    const data = this.ensureChunk(cx, cy);
    const painted = this.paintedCount.get(chunkKey(cx, cy)) ?? 0;
    return painted === 0 ? { empty: true } : { empty: false, data };
  }

  /** Paint one cell to an RGB color. Returns true if the value actually changed. */
  setCell(x: number, y: number, r: number, g: number, b: number): boolean {
    const { cx, cy } = cellToChunk(x, y, this.chunkSize);
    const key = chunkKey(cx, cy);
    const data = this.ensureChunk(cx, cy);
    const o = localIndex(x, y, this.chunkSize) * BYTES_PER_CELL;
    if (data[o] === r && data[o + 1] === g && data[o + 2] === b && data[o + 3] === 255) return false;

    const wasEmpty = data[o + 3] === 0;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
    if (wasEmpty) this.paintedCount.set(key, (this.paintedCount.get(key) ?? 0) + 1);
    this.dirty.add(key);
    return true;
  }

  /** Chunks currently held in memory (for tests / monitoring). */
  get inMemoryCount(): number {
    return this.chunks.size;
  }

  /** Flush changed chunks to storage. Returns how many were written. */
  flushDirty(): number {
    let n = 0;
    for (const key of this.dirty) {
      const data = this.chunks.get(key);
      if (!data) continue;
      const comma = key.indexOf(",");
      this.storage.saveChunk(Number(key.slice(0, comma)), Number(key.slice(comma + 1)), data);
      n++;
    }
    this.dirty.clear();
    return n;
  }
}
