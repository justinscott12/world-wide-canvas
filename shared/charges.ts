/**
 * Token-bucket charge budget. A session holds up to `max` charges; one
 * charge regenerates every `refillMs`. Painting a cell spends a charge.
 * Server-authoritative, but pure + deterministic so it's easy to test and
 * could drive client-side prediction later.
 */
export class ChargeBucket {
  private charges: number;
  private lastUpdate: number;

  constructor(
    private readonly max: number,
    private readonly refillMs: number,
    now: number,
    startFull = true,
  ) {
    this.charges = startFull ? max : 0;
    this.lastUpdate = now;
  }

  private refill(now: number): void {
    if (this.charges >= this.max) {
      this.charges = this.max;
      this.lastUpdate = now;
      return;
    }
    const gained = Math.floor((now - this.lastUpdate) / this.refillMs);
    if (gained > 0) {
      this.charges = Math.min(this.max, this.charges + gained);
      this.lastUpdate += gained * this.refillMs;
      if (this.charges >= this.max) this.lastUpdate = now;
    }
  }

  /** Current available charges. */
  current(now: number): number {
    this.refill(now);
    return this.charges;
  }

  /** Spend `n` charges if available; returns whether it succeeded. */
  trySpend(n: number, now: number): boolean {
    this.refill(now);
    if (n <= 0) return true;
    if (this.charges >= n) {
      this.charges -= n;
      return true;
    }
    return false;
  }

  /** Milliseconds until the next charge regenerates (0 when already full). */
  nextInMs(now: number): number {
    this.refill(now);
    if (this.charges >= this.max) return 0;
    const remaining = this.refillMs - (now - this.lastUpdate);
    return remaining > 0 ? remaining : 0;
  }
}

/**
 * Client-side prediction of the charge count, so the meter ticks up live
 * between server messages. Given the last server-reported count, the time
 * elapsed since, and how long until the *next* charge (from the server),
 * returns the count now. Resynced whenever a fresh server value arrives.
 */
export function predictCharges(
  base: number,
  elapsedMs: number,
  firstInMs: number,
  refillMs: number,
  max: number,
): number {
  if (base >= max) return max;
  if (elapsedMs < firstInMs) return base;
  const gained = 1 + Math.floor((elapsedMs - firstInMs) / refillMs);
  return Math.min(max, base + gained);
}
