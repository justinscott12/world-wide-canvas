import { describe, it, expect } from "vitest";
import { hslToRgb, applyMetallic, pickerColor, rgbToHex, hexToRgb, rgbToHsl } from "./color.js";

describe("hslToRgb", () => {
  it("produces primary colors at full saturation", () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb(120, 1, 0.5)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(240, 1, 0.5)).toEqual({ r: 0, g: 0, b: 255 });
  });
  it("produces gray when saturation is 0", () => {
    const c = hslToRgb(200, 0, 0.5);
    expect(c.r).toBe(c.g);
    expect(c.g).toBe(c.b);
    expect(c.r).toBeGreaterThan(120);
    expect(c.r).toBeLessThan(135);
  });
  it("wraps hue past 360", () => {
    expect(hslToRgb(360, 1, 0.5)).toEqual(hslToRgb(0, 1, 0.5));
  });
});

describe("applyMetallic", () => {
  it("is a no-op at 0", () => {
    const red = { r: 255, g: 0, b: 0 };
    expect(applyMetallic(red, 0)).toEqual(red);
  });
  it("desaturates and brightens toward metal at full strength", () => {
    const metal = applyMetallic({ r: 255, g: 0, b: 0 }, 1);
    // channels move closer together (desaturated) and the dark channels lift
    expect(metal.g).toBeGreaterThan(0);
    expect(metal.b).toBeGreaterThan(0);
    expect(metal.r - metal.g).toBeLessThan(255);
  });
  it("stays within byte range", () => {
    const c = applyMetallic({ r: 255, g: 255, b: 255 }, 1);
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("hex conversions", () => {
  it("round-trips rgb -> hex -> rgb", () => {
    expect(rgbToHex({ r: 255, g: 69, b: 0 })).toBe("#ff4500");
    expect(hexToRgb("#ff4500")).toEqual({ r: 255, g: 69, b: 0 });
    expect(hexToRgb("3690ea")).toEqual({ r: 0x36, g: 0x90, b: 0xea });
  });
  it("pads single-digit channels", () => {
    expect(rgbToHex({ r: 1, g: 2, b: 3 })).toBe("#010203");
  });
});

describe("rgbToHsl", () => {
  it("matches known hues", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 }).h).toBeCloseTo(0);
    expect(rgbToHsl({ r: 0, g: 255, b: 0 }).h).toBeCloseTo(120);
    expect(rgbToHsl({ r: 0, g: 0, b: 255 }).h).toBeCloseTo(240);
  });
  it("reports 0 saturation for grays", () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });
  it("round-trips through hslToRgb", () => {
    for (const rgb of [
      { r: 190, g: 0, b: 57 },
      { r: 54, g: 144, b: 234 },
      { r: 126, g: 237, b: 86 },
    ]) {
      const { h, s, l } = rgbToHsl(rgb);
      const back = hslToRgb(h, s, l);
      expect(back.r).toBeCloseTo(rgb.r, -0.5);
      expect(back.g).toBeCloseTo(rgb.g, -0.5);
      expect(back.b).toBeCloseTo(rgb.b, -0.5);
    }
  });
});

describe("pickerColor", () => {
  it("returns valid bytes across the range", () => {
    for (const [h, s, l, m] of [
      [0, 1, 0.5, 0],
      [180, 0.5, 0.4, 0.5],
      [359, 0.2, 0.8, 1],
    ] as const) {
      const c = pickerColor(h, s, l, m);
      for (const v of [c.r, c.g, c.b]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});
