import { describe, expect, it } from 'vitest';
import { READY_TICKS, TICK_HZ, DEATH_TICKS } from '../src/game/constants';
import { SoundSequencer, START_TUNE_FRAMES, sirenStage } from '../src/audio/sfx';
import { HOLD_FRAMES, WAVEFORMS, WAVE_COUNT, WAVE_LEN, WsgSynth, packFrame, type Frame } from '../src/audio/wsg';

const SR = 48000;
const samplesPerTick = SR / TICK_HZ;
const vol = (f: Frame, v: number): number => f[v * 3 + 2];
const freq = (f: Frame, v: number): number => f[v * 3 + 1];

function zeroCrossings(buf: Float32Array): number {
  let n = 0;
  for (let i = 1; i < buf.length; i++) if (buf[i - 1] < 0 !== buf[i] < 0) n++;
  return n;
}

describe('wavetable synth', () => {
  it('has eight 32-sample 4-bit waveforms', () => {
    expect(WAVEFORMS).toHaveLength(WAVE_COUNT);
    for (const w of WAVEFORMS) {
      expect(w).toHaveLength(WAVE_LEN);
      for (const s of w) expect(Number.isInteger(s) && s >= 0 && s <= 15).toBe(true);
    }
  });

  it('plays the requested pitch', () => {
    const synth = new WsgSynth(SR, TICK_HZ);
    const frame = packFrame([{ wave: 3, freq: 500, vol: 15 }]);
    for (let i = 0; i < 4; i++) synth.push(frame);
    const out = new Float32Array(Math.floor(samplesPerTick * 3)); // stay inside the pushed frames
    synth.render(out);
    const seconds = out.length / SR;
    expect(zeroCrossings(out) / 2 / seconds).toBeGreaterThan(480);
    expect(zeroCrossings(out) / 2 / seconds).toBeLessThan(520);
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('consumes exactly one frame per tick of audio time, whatever the arrival pattern', () => {
    const synth = new WsgSynth(SR, TICK_HZ);
    for (let i = 0; i < 5; i++) synth.push(packFrame([{ wave: 0, freq: 440, vol: 10 }])); // a burst
    synth.render(new Float32Array(Math.floor(samplesPerTick * 2)));
    expect(synth.queued).toBe(3); // two ticks of audio time consume exactly two frames
    synth.render(new Float32Array(Math.ceil(samplesPerTick)));
    expect(synth.queued).toBe(2);
  });

  it('goes silent by itself when ticks stop arriving', () => {
    const synth = new WsgSynth(SR, TICK_HZ);
    synth.push(packFrame([{ wave: 3, freq: 300, vol: 15 }]));
    const out = new Float32Array(Math.ceil(samplesPerTick * (HOLD_FRAMES + 3)));
    synth.render(out);
    const tail = out.subarray(Math.ceil(samplesPerTick * (HOLD_FRAMES + 1.5)));
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(1e-3);
    expect(Math.max(...out.subarray(0, 200).map(Math.abs))).toBeGreaterThan(0.1);
  });
});

describe('sound sequencer', () => {
  const run = (seq: SoundSequencer, n: number): Frame[] => Array.from({ length: n }, () => seq.tick());

  it('alternates two chomp shapes', () => {
    const seq = new SoundSequencer();
    seq.chomp();
    const a = seq.tick();
    run(seq, 6);
    seq.chomp();
    const b = seq.tick();
    expect(freq(a, 2)).toBeGreaterThan(freq(b, 2));
  });

  it('plays ghost-eaten for the 30-tick eat pause and does not let a chomp cut it off', () => {
    const seq = new SoundSequencer();
    seq.eatGhost();
    const first = seq.tick();
    seq.chomp();
    const frames = [first, ...run(seq, 29)];
    expect(frames.every((f) => vol(f, 2) > 0)).toBe(true);
    expect(freq(frames[29], 2)).toBeGreaterThan(freq(frames[0], 2) * 4); // rising sweep
    expect(vol(seq.tick(), 2)).toBe(0);
  });

  it('picks the loop by priority and speeds the siren up by stage', () => {
    const seq = new SoundSequencer();
    seq.setLoop('siren', 0);
    const s0 = run(seq, 64).map((f) => freq(f, 1));
    seq.setLoop('siren', 3);
    const s3 = run(seq, 64).map((f) => freq(f, 1));
    expect(Math.max(...s3)).toBeGreaterThan(Math.max(...s0));
    const peaks = (xs: number[]) => xs.filter((x, i) => i > 0 && i < xs.length - 1 && x > xs[i - 1] && x >= xs[i + 1]).length;
    expect(peaks(s3)).toBeGreaterThan(peaks(s0));
    expect([0, 69, 70, 139, 140, 199, 200, 243].map(sirenStage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('death takes the whole chip, fits the death animation, then ends', () => {
    const seq = new SoundSequencer();
    seq.setLoop('siren');
    seq.chomp();
    seq.death();
    const frames = run(seq, DEATH_TICKS);
    expect(frames.every((f) => vol(f, 1) === 0 && vol(f, 2) === 0)).toBe(true);
    const lastSound = frames.map((f) => vol(f, 0) > 0).lastIndexOf(true);
    expect(lastSound).toBeGreaterThan(60);
    expect(lastSound).toBeLessThan(DEATH_TICKS);
  });

  it('fits the start tune inside the READY wait', () => {
    expect(START_TUNE_FRAMES).toBeLessThanOrEqual(READY_TICKS);
    const seq = new SoundSequencer();
    seq.startTune();
    const frames = run(seq, START_TUNE_FRAMES + 2);
    expect(frames.slice(0, 10).every((f) => vol(f, 0) > 0 && vol(f, 1) > 0)).toBe(true);
    expect(frames.slice(-2).every((f) => vol(f, 0) === 0 && vol(f, 1) === 0)).toBe(true);
  });

  it('leaves no stuck notes: every one-shot ends', () => {
    const seq = new SoundSequencer();
    for (const fx of ['chomp', 'eatGhost', 'eatFruit', 'extraLife', 'gameOver', 'startTune'] as const) {
      seq[fx]();
      run(seq, 400);
      expect(packFrame([])).toEqual(seq.tick());
    }
  });
});
