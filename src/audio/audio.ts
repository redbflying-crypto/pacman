/**
 * Game audio: a three-voice wavetable synth (wsg.ts) driven one register frame
 * per simulation tick by the sound sequencer (sfx.ts). All sounds are original
 * designs; nothing is sampled or transcribed from the arcade.
 *
 * Exactly one audio node is created for the lifetime of the page (an
 * AudioWorkletNode, or a ScriptProcessorNode where AudioWorklet is unavailable,
 * e.g. on a non-secure origin), so nothing accumulates across restarts.
 * Call tick() once per simulation step; when ticks stop (pause, hidden tab) the
 * synth holds briefly and then goes silent by itself.
 */
import { TICK_HZ } from '../game/constants';
import { SoundSequencer, type LoopKind } from './sfx';
import { WsgSynth, type Frame } from './wsg';
import workletUrl from './wsg.worklet.ts?worker&url';

export type { LoopKind };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private send: ((frame: Frame) => void) | null = null;
  private readonly seq = new SoundSequencer();
  private muted = false;
  private readonly volume = 0.35;

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    void this.connectSynth(ctx, this.master);
  }

  private async connectSynth(ctx: AudioContext, master: GainNode): Promise<void> {
    if (ctx.audioWorklet) {
      try {
        await ctx.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(ctx, 'wsg', {
          numberOfInputs: 0,
          outputChannelCount: [1],
          processorOptions: { tickHz: TICK_HZ },
        });
        node.connect(master);
        this.send = (frame) => node.port.postMessage(frame);
        return;
      } catch (err) {
        console.warn('AudioWorklet unavailable, using ScriptProcessor fallback', err);
      }
    }
    // Fallback: same synth on the main thread.
    const synth = new WsgSynth(ctx.sampleRate, TICK_HZ);
    const node = ctx.createScriptProcessor(1024, 0, 1);
    node.onaudioprocess = (e) => synth.render(e.outputBuffer.getChannelData(0));
    node.connect(master);
    this.send = (frame) => synth.push(frame);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Advance the sequencer by one simulation tick and send the frame to the synth. */
  tick(): void {
    const frame = this.seq.tick();
    this.send?.(frame);
  }

  chomp(): void {
    this.seq.chomp();
  }
  eatGhost(): void {
    this.seq.eatGhost();
  }
  eatFruit(): void {
    this.seq.eatFruit();
  }
  extraLife(): void {
    this.seq.extraLife();
  }
  death(): void {
    this.seq.death();
  }
  gameOver(): void {
    this.seq.gameOver();
  }
  startJingle(): void {
    this.seq.startTune();
  }
  setLoop(kind: LoopKind, stage = 0): void {
    this.seq.setLoop(kind, stage);
  }
  /** Silence everything immediately (restart). */
  reset(): void {
    this.seq.reset();
  }

  dispose(): void {
    this.seq.reset();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.send = null;
  }
}
