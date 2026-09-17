/**
 * Pure color math for the picker: HSL -> RGB, and a "metallic tint" transform
 * that pushes a color toward a shiny-metal rendition of itself.
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** h in degrees [0,360), s and l in [0,1]. */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = clamp255(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clamp255(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: clamp255(hue2rgb(p, q, hn) * 255),
    b: clamp255(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

/**
 * Blend a color toward a metallic rendition of itself by amount m in [0,1].
 * The metal version desaturates toward the color's own luma (so hue survives
 * faintly) and lifts toward a bright sheen — chrome/gold/silver flavor.
 */
export function applyMetallic(rgb: RGB, m: number): RGB {
  if (m <= 0) return rgb;
  const amt = m > 1 ? 1 : m;
  const luma = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  const metalChannel = (c: number): number => {
    const desat = c + (luma - c) * 0.65; // 65% toward gray
    return clamp255(desat * 0.8 + 100); // brighten toward a metallic midtone
  };
  const mix = (a: number, b: number): number => a + (b - a) * amt;
  return {
    r: clamp255(mix(rgb.r, metalChannel(rgb.r))),
    g: clamp255(mix(rgb.g, metalChannel(rgb.g))),
    b: clamp255(mix(rgb.b, metalChannel(rgb.b))),
  };
}

/** Full picker pipeline: hue/sat/lightness (+ metallic) -> RGB. */
export function pickerColor(h: number, s: number, l: number, m: number): RGB {
  return applyMetallic(hslToRgb(h, s, l), m);
}

export function rgbToCss(c: RGB): string {
  return `rgb(${c.r},${c.g},${c.b})`;
}

function byteHex(n: number): string {
  return clamp255(n).toString(16).padStart(2, "0");
}

export function rgbToHex(c: RGB): string {
  return `#${byteHex(c.r)}${byteHex(c.g)}${byteHex(c.b)}`;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

/** Inverse of hslToRgb. Returns h in degrees [0,360), s and l in [0,1]. */
export function rgbToHsl(c: RGB): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}
