/**
 * A small three-voice wavetable synthesiser in the style of early-80s arcade
 * sound chips: each voice plays one of eight 32-sample, 4-bit waveforms at a
 * frequency and a 4-bit volume. The waveforms are our own (generated below),
 * not copies of any ROM.
 *
 * The synth is driven by register frames, one per simulation tick. Frames are
 * queued and consumed at exactly the tick rate in *audio* time, so sound stays
 * in step with the game even when frames arrive in bursts. If frames stop
 * arriving (pause, hidden tab, game frozen) the last frame is held briefly and
 * then the output falls silent, so nothing can drone on.
 *
 * Pure TypeScript with no Web Audio dependency: it runs inside the
 * AudioWorklet, in the ScriptProcessor fallback, and in unit tests.
 */

export const VOICES = 3;
export const WAVE_LEN = 32;
export const WAVE_COUNT = 8;

/** Wave numbers, by character. */
export const Wave = {
  Sine: 0,
  Triangle: 1,
  Saw: 2,
  Square: 3,
  Pulse25: 4,
  Pulse12: 5,
  Organ: 6,
  Reed: 7,
} as const;

function quantise(v: number): number {
  return Math.max(0, Math.min(15, Math.round(7.5 + 7.5 * v)));
}

function makeWave(fn: (t: number) => number): Uint8Array {
  const w = new Uint8Array(WAVE_LEN);
  for (let i = 0; i < WAVE_LEN; i++) w[i] = quantise(fn(i / WAVE_LEN));
  return w;
}

const TAU = Math.PI * 2;

/** Eight 4-bit waveforms (values 0..15). */
export const WAVEFORMS: readonly Uint8Array[] = [
  makeWave((t) => Math.sin(TAU * t)),
  makeWave((t) => (t < 0.5 ? 4 * t - 1 : 3 - 4 * t)),
  makeWave((t) => 2 * t - 1),
  makeWave((t) => (t < 0.5 ? 1 : -1)),
  makeWave((t) => (t < 0.25 ? 1 : -1)),
  makeWave((t) => (t < 0.125 ? 1 : -1)),
  makeWave((t) => 0.7 * Math.sin(TAU * t) + 0.3 * Math.sin(2 * TAU * t)),
  makeWave((t) => 0.75 * Math.sin(TAU * t) + 0.25 * Math.sin(3 * TAU * t) * 1.2),
];

/** One voice's registers for one tick. */
export interface VoiceRegs {
  wave: number; // 0..7
  freq: number; // Hz
  vol: number; // 0..15
}

export const SILENT: VoiceRegs = { wave: 0, freq: 0, vol: 0 };

/** Registers for all voices for one tick, flattened: [wave, freq, vol] × VOICES. */
export type Frame = number[];

export function packFrame(voices: readonly VoiceRegs[]): Frame {
  const f: number[] = [];
  for (let v = 0; v < VOICES; v++) {
    const r = voices[v] ?? SILENT;
    f.push(r.wave, r.freq, r.vol);
  }
  return f;
}

/** Frames held after the queue runs dry before the synth goes silent. */
export const HOLD_FRAMES = 3;
/** Queue cap: older frames are dropped beyond this to bound latency. */
export const MAX_QUEUE = 6;

export class WsgSynth {
  private readonly queue: Frame[] = [];
  private current: Frame = packFrame([]);
  private readonly phase = new Float64Array(VOICES);
  private readonly samplesPerFrame: number;
  private untilNextFrame = 0;
  private starved = HOLD_FRAMES; // start silent
  private lp = 0;

  constructor(
    readonly sampleRate: number,
    tickHz: number,
  ) {
    this.samplesPerFrame = sampleRate / tickHz;
  }

  push(frame: Frame): void {
    this.queue.push(frame);
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  get queued(): number {
    return this.queue.length;
  }

  private nextFrame(): void {
    const f = this.queue.shift();
    if (f) {
      this.current = f;
      this.starved = 0;
    } else {
      this.starved++;
    }
    this.untilNextFrame += this.samplesPerFrame;
  }

  /** Render `length` mono samples into `out` starting at `offset`. */
  render(out: Float32Array, offset = 0, length = out.length - offset): void {
    const sr = this.sampleRate;
    for (let n = 0; n < length; n++) {
      if (this.untilNextFrame <= 0) this.nextFrame();
      this.untilNextFrame--;
      let mix = 0;
      if (this.starved < HOLD_FRAMES) {
        const f = this.current;
        for (let v = 0; v < VOICES; v++) {
          const vol = f[v * 3 + 2];
          const freq = f[v * 3 + 1];
          if (vol <= 0 || freq <= 0) continue;
          const wave = WAVEFORMS[f[v * 3] & 7];
          let p = this.phase[v] + (freq * WAVE_LEN) / sr;
          if (p >= WAVE_LEN) p -= WAVE_LEN * Math.floor(p / WAVE_LEN);
          this.phase[v] = p;
          mix += ((wave[p | 0] - 7.5) / 7.5) * (Math.min(15, vol) / 15);
        }
      }
      // Gentle one-pole low-pass (about 7 kHz) to take the edge off the 4-bit steps.
      this.lp += (mix / VOICES - this.lp) * 0.6;
      out[offset + n] = this.lp;
    }
  }
}
