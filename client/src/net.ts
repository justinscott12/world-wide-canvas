import { base64ToBytes } from "@shared/protocol.js";
import type { ServerMsg, PaintMsg, ViewportMsg, RejectReason } from "@shared/protocol.js";

export interface NetHandlers {
  onWelcome?: (sessionId: string, charges: number) => void;
  onChunk?: (cx: number, cy: number, empty: boolean, data?: Uint8Array) => void;
  onEdit?: (cells: { x: number; y: number; r: number; g: number; b: number }[]) => void;
  onCharges?: (charges: number, nextInMs: number) => void;
  onReject?: (reason: RejectReason) => void;
  onStatus?: (connected: boolean) => void;
}

/** Thin WebSocket client with exponential-backoff reconnect. */
export class Net {
  private ws: WebSocket | null = null;
  private backoff = 500;
  private closed = false;

  constructor(private readonly url: string, private readonly handlers: NetHandlers) {}

  connect(): void {
    this.closed = false;
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.handlers.onStatus?.(true);
    };
    ws.onclose = () => {
      this.handlers.onStatus?.(false);
      if (!this.closed) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 10_000);
      }
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => this.dispatch(ev.data);
  }

  private dispatch(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        this.handlers.onWelcome?.(msg.sessionId, msg.charges);
        break;
      case "chunk":
        this.handlers.onChunk?.(msg.cx, msg.cy, msg.empty, msg.data ? base64ToBytes(msg.data) : undefined);
        break;
      case "edit":
        this.handlers.onEdit?.(msg.cells);
        break;
      case "charges":
        this.handlers.onCharges?.(msg.charges, msg.nextInMs);
        break;
      case "reject":
        this.handlers.onReject?.(msg.reason);
        break;
    }
  }

  private send(msg: ViewportMsg | PaintMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendViewport(minX: number, minY: number, maxX: number, maxY: number): void {
    this.send({ type: "viewport", minX, minY, maxX, maxY });
  }

  sendPaint(x: number, y: number, r: number, g: number, b: number, brush: number): void {
    this.send({ type: "paint", x, y, r, g, b, brush });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
