/**
 * AudioWorklet host for the wavetable synth. Bundled separately by Vite
 * (imported with `?worker&url`) and loaded with audioWorklet.addModule().
 * Register frames arrive over the port, one per simulation tick.
 */
import { WsgSynth, type Frame } from './wsg';

// Minimal AudioWorkletGlobalScope typings (not part of the DOM lib).
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions?: unknown }) => unknown): void;

class WsgProcessor extends AudioWorkletProcessor {
  private readonly synth: WsgSynth;

  constructor(options: { processorOptions?: unknown }) {
    super();
    const tickHz = (options.processorOptions as { tickHz?: number } | undefined)?.tickHz ?? 60;
    this.synth = new WsgSynth(sampleRate, tickHz);
    this.port.onmessage = (e: MessageEvent<Frame>) => this.synth.push(e.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out && out[0]) {
      this.synth.render(out[0]);
      for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    }
    return true;
  }
}

registerProcessor('wsg', WsgProcessor);
