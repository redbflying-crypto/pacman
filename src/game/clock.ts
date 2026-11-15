/** Fixed-step accumulator shared by the browser loop and the tests. */
export class FixedStepClock {
  private acc = 0;
  private readonly stepMs: number;
  private readonly maxSteps: number;

  constructor(stepMs: number, maxSteps = 8) {
    this.stepMs = stepMs;
    this.maxSteps = maxSteps;
  }

  advance(dtMs: number, step: () => void): number {
    this.acc += dtMs;
    let n = 0;
    while (this.acc >= this.stepMs && n < this.maxSteps) {
      this.acc -= this.stepMs;
      step();
      n++;
    }
    if (n >= this.maxSteps) this.acc = 0;
    return n;
  }

  reset(): void {
    this.acc = 0;
  }

  get pending(): number {
    return this.acc;
  }
}