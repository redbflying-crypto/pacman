/**
 * Seeded deterministic PRNG (mulberry32). The original game uses a hardware
 * LFSR for frightened turns and a frame counter for fruit lifetime; both are
 * replaced by explicit seeded streams so a replay is reproducible.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** integer in [0, bound) */
  int(bound: number): number {
    return Math.floor(this.next() * bound);
  }

  get seed(): number {
    return this.state >>> 0;
  }

  clone(): Rng {
    const r = new Rng(0);
    r.state = this.state;
    return r;
  }
}

/** The original resets its PRNG at the start of each level and after a death. */
export const FRIGHTENED_SEED = 0x1a2b3c4d;
export const FRUIT_SEED = 0x5e6f7a8b;