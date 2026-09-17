import { CONFIG } from "@shared/config.js";
import { pickerColor, rgbToCss, rgbToHex, hexToRgb, rgbToHsl, type RGB } from "./color.js";
import { loadBookmarks, saveBookmarks, type Bookmark } from "./bookmarks.js";

export interface UICallbacks {
  onColor: (rgb: RGB) => void;
  onBrush: (size: number) => void;
  onTeleport: (x: number, y: number) => void;
}

/** Owns the DOM overlay: color wheel + sliders, coords, charges, teleport. */
export class UI {
  // Color state: hue 0-360, sat/light/metallic 0-1.
  private h = 345;
  private s = 0.9;
  private l = 0.45;
  private m = 0;
  private wheelDrag = false;

  private el = {
    coords: byId("coords"),
    statusDot: byId("status-dot"),
    statusText: byId("status-text"),
    chargesFill: byId("charges-fill"),
    chargesText: byId("charges-text"),
    wheel: byId("wheel") as HTMLCanvasElement,
    hex: byId("hex") as HTMLInputElement,
    hexText: byId("hex-text"),
    sat: byId("sat") as HTMLInputElement,
    light: byId("light") as HTMLInputElement,
    metal: byId("metal") as HTMLInputElement,
    brushRange: byId("brush-range") as HTMLInputElement,
    brushSize: byId("brush-size"),
    tpX: byId("tp-x") as HTMLInputElement,
    tpY: byId("tp-y") as HTMLInputElement,
    tpGo: byId("tp-go"),
    placeName: byId("place-name") as HTMLInputElement,
    placeSave: byId("place-save"),
    placesList: byId("places-list"),
    toast: byId("toast"),
    help: byId("help"),
    helpClose: byId("help-close"),
  };
  private wheelCtx = this.el.wheel.getContext("2d")!;
  private toastTimer = 0;

  // Current view-center cell (updated each frame), used when saving a bookmark.
  private center = { x: 0, y: 0 };
  private bookmarks: Bookmark[] = loadBookmarks();

  constructor(private readonly cb: UICallbacks) {
    // Seed color state from the sliders' initial values.
    this.s = Number(this.el.sat.value) / 100;
    this.l = Number(this.el.light.value) / 100;
    this.m = Number(this.el.metal.value) / 100;

    this.el.sat.addEventListener("input", () => {
      this.s = Number(this.el.sat.value) / 100;
      this.recompute();
    });
    this.el.light.addEventListener("input", () => {
      this.l = Number(this.el.light.value) / 100;
      this.recompute();
    });
    this.el.metal.addEventListener("input", () => {
      this.m = Number(this.el.metal.value) / 100;
      this.recompute();
    });

    // Native color picker: pick an exact color, snap wheel + sliders to match.
    this.el.hex.addEventListener("input", () => {
      const { h, s, l } = rgbToHsl(hexToRgb(this.el.hex.value));
      this.h = h;
      this.s = s;
      this.l = l;
      this.m = 0;
      this.el.sat.value = String(Math.round(s * 100));
      this.el.light.value = String(Math.round(l * 100));
      this.el.metal.value = "0";
      this.recompute();
    });

    this.el.brushRange.max = String(CONFIG.maxBrushSize);
    this.el.brushRange.addEventListener("input", () => {
      const size = Number(this.el.brushRange.value);
      this.el.brushSize.textContent = String(size);
      this.cb.onBrush(size);
    });

    this.setupWheel();

    this.el.tpGo.addEventListener("click", () => this.teleport());
    for (const input of [this.el.tpX, this.el.tpY]) {
      input.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") this.teleport();
      });
    }
    this.el.helpClose.addEventListener("click", () => this.el.help.classList.add("hidden"));

    this.el.placeSave.addEventListener("click", () => this.addBookmark());
    this.el.placeName.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.addBookmark();
    });
    this.renderPlaces();

    this.drawWheel();
    this.recompute();
  }

  // ---------------- Bookmarked coordinates ----------------

  /** Called each frame with the current view-center cell. */
  noteCenter(x: number, y: number): void {
    this.center.x = x;
    this.center.y = y;
  }

  private addBookmark(): void {
    const name = this.el.placeName.value.trim().slice(0, 40) || `${this.center.x}, ${this.center.y}`;
    this.bookmarks.push({ name, x: this.center.x, y: this.center.y });
    saveBookmarks(this.bookmarks);
    this.el.placeName.value = "";
    this.renderPlaces();
    this.toast(`Saved "${name}"`, "ok");
  }

  private removeBookmark(i: number): void {
    this.bookmarks.splice(i, 1);
    saveBookmarks(this.bookmarks);
    this.renderPlaces();
  }

  private renderPlaces(): void {
    const list = this.el.placesList;
    list.textContent = "";
    for (let i = 0; i < this.bookmarks.length; i++) {
      const bm = this.bookmarks[i]!;
      const chip = document.createElement("div");
      chip.className = "place";

      const go = document.createElement("button");
      go.className = "place-go";
      go.textContent = bm.name;
      go.title = `Go to ${bm.x}, ${bm.y}`;
      go.addEventListener("click", () => this.cb.onTeleport(bm.x, bm.y));

      const del = document.createElement("button");
      del.className = "place-del";
      del.textContent = "×";
      del.title = "Remove bookmark";
      del.addEventListener("click", () => this.removeBookmark(i));

      chip.append(go, del);
      list.appendChild(chip);
    }
  }

  // ---------------- Color wheel ----------------

  private setupWheel(): void {
    const cv = this.el.wheel;
    const pick = (ev: PointerEvent): void => {
      const rect = cv.getBoundingClientRect();
      const mx = ev.clientX - rect.left - rect.width / 2;
      const my = ev.clientY - rect.top - rect.height / 2;
      const ang = Math.atan2(my, mx);
      this.h = (((ang * 180) / Math.PI) % 360 + 360) % 360;
      this.recompute();
    };
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      this.wheelDrag = true;
      pick(e);
    });
    cv.addEventListener("pointermove", (e) => {
      if (this.wheelDrag) pick(e);
    });
    const stop = (): void => {
      this.wheelDrag = false;
    };
    cv.addEventListener("pointerup", stop);
    cv.addEventListener("pointercancel", stop);
  }

  private drawWheel(): void {
    const cv = this.el.wheel;
    const ctx = this.wheelCtx;
    const W = cv.width;
    const cx = W / 2;
    const cy = W / 2;
    const outer = W / 2 - 2;
    const inner = W / 2 - 18;
    ctx.clearRect(0, 0, W, W);

    // Hue ring.
    const segments = 360;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI + 0.02;
      ctx.beginPath();
      ctx.arc(cx, cy, outer, a0, a1);
      ctx.arc(cx, cy, inner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${i}, 100%, 50%)`;
      ctx.fill();
    }

    // Center: preview of the final color.
    const c = pickerColor(this.h, this.s, this.l, this.m);
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 3, 0, 2 * Math.PI);
    ctx.fillStyle = rgbToCss(c);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.stroke();

    // Hue marker on the ring.
    const ang = (this.h * Math.PI) / 180;
    const mr = (outer + inner) / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * mr, cy + Math.sin(ang) * mr, 6, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();
  }

  private recompute(): void {
    const color = pickerColor(this.h, this.s, this.l, this.m);
    this.cb.onColor(color);
    const hex = rgbToHex(color);
    this.el.hex.value = hex;
    this.el.hexText.textContent = hex;
    this.drawWheel();
  }

  // ---------------- Misc controls ----------------

  private teleport(): void {
    const x = Math.floor(Number(this.el.tpX.value));
    const y = Math.floor(Number(this.el.tpY.value));
    if (Number.isFinite(x) && Number.isFinite(y)) this.cb.onTeleport(x, y);
  }

  setCoords(x: number, y: number): void {
    this.el.coords.textContent = `${x}, ${y}`;
  }

  setStatus(connected: boolean): void {
    this.el.statusDot.classList.toggle("online", connected);
    this.el.statusDot.classList.toggle("offline", !connected);
    this.el.statusText.textContent = connected ? "live" : "reconnecting…";
  }

  setCharges(charges: number): void {
    if (!CONFIG.chargesEnabled) {
      this.el.chargesFill.style.width = "100%";
      this.el.chargesText.textContent = "∞";
      return;
    }
    const pct = Math.max(0, Math.min(100, (charges / CONFIG.chargeMax) * 100));
    this.el.chargesFill.style.width = `${pct}%`;
    this.el.chargesText.textContent = `${charges}/${CONFIG.chargeMax}`;
  }

  toast(msg: string, kind: "error" | "ok" = "error"): void {
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove("hidden");
    this.el.toast.classList.toggle("ok", kind === "ok");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.el.toast.classList.add("hidden"), 1600);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}
