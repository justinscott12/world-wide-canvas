/**
 * WebSocket wire protocol (JSON) shared by client & server.
 * All messages are discriminated on `type`.
 */
import type { WorldConfig } from "./config.js";

// ---------------- Client -> Server ----------------

/** Tell the server which cell rectangle the client is currently viewing. */
export interface ViewportMsg {
  type: "viewport";
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Request to paint an NxN brush centered on (x, y) with an RGB color. */
export interface PaintMsg {
  type: "paint";
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  brush: number;
}

export type ClientMsg = ViewportMsg | PaintMsg;

// ---------------- Server -> Client ----------------

/** Sent once on connect. */
export interface WelcomeMsg {
  type: "welcome";
  config: WorldConfig;
  sessionId: string;
  charges: number;
}

/** Full contents of one chunk. `empty` chunks omit data to stay cheap. */
export interface ChunkMsg {
  type: "chunk";
  cx: number;
  cy: number;
  empty: boolean;
  /** base64 of the chunk's byte array; present iff !empty. */
  data?: string;
}

export interface EditedCell {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

/** Broadcast of cells that changed (from anyone, including the requester). */
export interface EditMsg {
  type: "edit";
  cells: EditedCell[];
}

/** Updated charge balance for this session. */
export interface ChargesMsg {
  type: "charges";
  charges: number;
  /** ms until the next charge regenerates, for client-side UI. */
  nextInMs: number;
}

export type RejectReason =
  | "out-of-charges"
  | "rate-limited"
  | "out-of-bounds"
  | "bad-color"
  | "too-far-out"
  | "banned";

/** A paint request was refused. */
export interface RejectMsg {
  type: "reject";
  reason: RejectReason;
}

export type ServerMsg = WelcomeMsg | ChunkMsg | EditMsg | ChargesMsg | RejectMsg;

// ---------------- Isomorphic base64 (browser + Node) ----------------

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  // Node
  return Buffer.from(bytes).toString("base64");
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node
  return new Uint8Array(Buffer.from(b64, "base64"));
}
