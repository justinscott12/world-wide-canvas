import { describe, it, expect } from "vitest";
import { ChargeBucket, predictCharges } from "./charges.js";

describe("ChargeBucket", () => {
  it("starts full by default", () => {
    const b = new ChargeBucket(60, 2000, 0);
    expect(b.current(0)).toBe(60);
  });

  it("can start empty", () => {
    const b = new ChargeBucket(60, 2000, 0, false);
    expect(b.current(0)).toBe(0);
  });

  it("spends charges when available", () => {
    const b = new ChargeBucket(60, 2000, 0);
    expect(b.trySpend(10, 0)).toBe(true);
    expect(b.current(0)).toBe(50);
  });

  it("refuses to spend more than it has", () => {
    const b = new ChargeBucket(5, 2000, 0);
    expect(b.trySpend(10, 0)).toBe(false);
    expect(b.current(0)).toBe(5); // unchanged
  });

  it("regenerates one charge per refill interval", () => {
    const b = new ChargeBucket(60, 2000, 0, false);
    expect(b.current(2000)).toBe(1);
    expect(b.current(6000)).toBe(3);
  });

  it("does not exceed max", () => {
    const b = new ChargeBucket(3, 1000, 0, false);
    expect(b.current(100000)).toBe(3);
  });

  it("accumulates partial progress across calls", () => {
    const b = new ChargeBucket(60, 2000, 0, false);
    expect(b.current(1000)).toBe(0); // half a charge, not yet granted
    expect(b.current(2000)).toBe(1); // now the full interval elapsed
  });

  it("reports time until the next charge", () => {
    const b = new ChargeBucket(60, 2000, 0, false);
    expect(b.nextInMs(0)).toBe(2000);
    expect(b.nextInMs(1500)).toBe(500);
  });

  it("reports 0 time-to-next when full", () => {
    const b = new ChargeBucket(60, 2000, 0);
    expect(b.nextInMs(0)).toBe(0);
  });

  it("spend then refill works end to end", () => {
    const b = new ChargeBucket(10, 1000, 0);
    expect(b.trySpend(10, 0)).toBe(true);
    expect(b.current(0)).toBe(0);
    expect(b.trySpend(1, 500)).toBe(false); // nothing regenerated yet
    expect(b.trySpend(1, 1000)).toBe(true); // one charge back
  });
});

describe("predictCharges", () => {
  const REFILL = 200;
  const MAX = 1000;

  it("stays at max when already full", () => {
    expect(predictCharges(1000, 5000, 0, REFILL, MAX)).toBe(MAX);
  });

  it("holds the base value until the first charge is due", () => {
    expect(predictCharges(500, 0, 200, REFILL, MAX)).toBe(500);
    expect(predictCharges(500, 199, 200, REFILL, MAX)).toBe(500);
  });

  it("grants the first charge exactly at firstInMs", () => {
    expect(predictCharges(500, 200, 200, REFILL, MAX)).toBe(501);
  });

  it("grants further charges every refill interval after the first", () => {
    expect(predictCharges(500, 600, 200, REFILL, MAX)).toBe(503); // 1 + 2 more
  });

  it("never exceeds max", () => {
    expect(predictCharges(999, 100000, 200, REFILL, MAX)).toBe(MAX);
  });
});
