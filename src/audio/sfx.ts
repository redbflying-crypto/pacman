/**
 * Sound sequencer: turns game events into one register frame per simulation
 * tick for the wavetable synth (wsg.ts). Every effect is a small "frame
 * program" — a function of the frame number — in the way arcade sound drivers
 * update the chip once per video frame.
 *
 * All sounds and the start tune here are original designs for this project.
 *
 * Voices:
 *   0  music: start tune, death, extra life, game over
 *   1  background loop: siren (four urgency stages), frightened, eyes returning
 *   2  effects: chomp, ghost eaten, fruit
 * The death sound and the start tune take over the whole chip while they play.
 */
import { SILENT, VOICES, Wave, packFrame, type Frame, type VoiceRegs } from './wsg';

/** A frame program: registers for frame `i`, or null once finished. */
type Program = (i: number) => VoiceRegs | null;

export type LoopKind = 'off' | 'siren' | 'fright' | 'eyes';

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A sequence of notes, each `len` frames, with a short per-note decay. */
function notes(seq: readonly (number | null)[], len: number, wave: number, vol: number, decay = 0.5): Program {
  return (i) => {
    const k = Math.floor(i / len);
    if (k >= seq.length) return null;
    const n = seq[k];
    if (n === null) return SILENT;
    const t = (i % len) / len;
    return { wave, freq: midi(n), vol: Math.round(vol * (1 - decay * t)) };
  };
}

// ---------------------------------------------------------------- effects

/** Two alternating chomp shapes: a falling and a rising pulse blip (5 frames). */
const chompA: Program = (i) => (i >= 5 ? null : { wave: Wave.Pulse25, freq: lerp(620, 330, i / 4), vol: 12 - i });
const chompB: Program = (i) => (i >= 5 ? null : { wave: Wave.Pulse25, freq: lerp(330, 600, i / 4), vol: 12 - i });

/** Ghost eaten: a rising saw sweep lasting the half-second eat pause (30 frames). */
const ghostEaten: Program = (i) =>
  i >= 30 ? null : { wave: Wave.Saw, freq: 180 * 2 ** (i / 10), vol: i < 26 ? 13 : 13 - (i - 25) * 3 };

/** Fruit: a quick two-step upward chirp (12 frames). */
const fruit: Program = (i) =>
  i >= 12 ? null : { wave: Wave.Organ, freq: (i < 6 ? 700 : 1050) * (1 + (i % 6) * 0.04), vol: 13 - (i % 6) };

/** Extra life: four bright pings (32 frames). */
const extraLife: Program = (i) =>
  i >= 32 ? null : { wave: Wave.Sine, freq: 1320, vol: Math.max(0, 15 - (i % 8) * 2) };

/**
 * Death: six falling saw "drops", each starting lower than the last and
 * sliding down a fifth with a fast wobble, then two low pops (~1.5 s).
 */
const death: Program = (i) => {
  const DROP = 12;
  if (i < 6 * DROP) {
    const k = Math.floor(i / DROP);
    const t = (i % DROP) / DROP;
    const start = 880 * 2 ** (-k / 4);
    const wobble = 1 + 0.03 * Math.sin(i * 2.1);
    return { wave: Wave.Saw, freq: start * 2 ** (-0.58 * t) * wobble, vol: 13 - Math.floor(t * 4) };
  }
  const j = i - 6 * DROP;
  if (j < 18) {
    const inPop = j % 9 < 4;
    return inPop ? { wave: Wave.Square, freq: 110 - (j % 9) * 12, vol: 12 } : SILENT;
  }
  return null;
};

/** Game over: a slow falling four-note cadence (A4 F4 D4 A3, 48 frames). */
const gameOver: Program = notes([69, 65, 62, 57], 12, Wave.Square, 12, 0.7);

/**
 * Start tune (original): four bars of a minor-key arpeggio figure over a
 * bouncing octave bass, 16 steps of 7 frames (112 frames, inside the READY wait).
 */
const TUNE_MELODY = [76, 79, 81, 84, 83, 79, 76, 79, 81, 84, 86, 88, 86, 83, 81, null];
const TUNE_BASS = [45, 57, 45, 57, 43, 55, 43, 55, 41, 53, 41, 53, 40, 52, 40, 52];
const tuneMelody = notes(TUNE_MELODY, 7, Wave.Organ, 13, 0.35);
const tuneBass = notes(TUNE_BASS, 7, Wave.Triangle, 12, 0.5);
export const START_TUNE_FRAMES = TUNE_MELODY.length * 7;

// ------------------------------------------------------------------- loops

/** Siren: a sine sweeping up and down; higher and faster at each urgency stage. */
function siren(i: number, stage: number): VoiceRegs {
  const period = 32 - stage * 5;
  const lo = 360 + stage * 55;
  const hi = 560 + stage * 90;
  const p = (i % period) / period;
  const tri = p < 0.5 ? p * 2 : 2 - p * 2;
  return { wave: Wave.Sine, freq: lerp(lo, hi, tri), vol: 7 };
}

/** Frightened: a repeating rising saw chirp (8-frame cycle). */
const fright = (i: number): VoiceRegs => ({ wave: Wave.Saw, freq: lerp(280, 720, (i % 8) / 7), vol: 7 });

/** Eyes returning: a fast falling pulse chirp (6-frame cycle). */
const eyes = (i: number): VoiceRegs => ({ wave: Wave.Pulse12, freq: lerp(1500, 750, (i % 6) / 5), vol: 8 });

/** Siren urgency stage from the consumables already eaten this level (0..3). */
export function sirenStage(eaten: number): number {
  return eaten < 70 ? 0 : eaten < 140 ? 1 : eaten < 200 ? 2 : 3;
}

interface Running {
  program: Program;
  frame: number;
}

export class SoundSequencer {
  private music: Running | null = null;
  private bass: Running | null = null;
  private effect: Running | null = null;
  private exclusive = false;
  private chompFlip = false;
  private loop: LoopKind = 'off';
  private stage = 0;
  private loopFrame = 0;

  private play(program: Program): Running {
    return { program, frame: 0 };
  }

  chomp(): void {
    if (this.effect && this.effect.program !== chompA && this.effect.program !== chompB) return;
    this.chompFlip = !this.chompFlip;
    this.effect = this.play(this.chompFlip ? chompA : chompB);
  }

  eatGhost(): void {
    this.effect = this.play(ghostEaten);
  }

  eatFruit(): void {
    this.effect = this.play(fruit);
  }

  extraLife(): void {
    if (!this.exclusive) this.music = this.play(extraLife);
  }

  death(): void {
    this.music = this.play(death);
    this.bass = null;
    this.effect = null;
    this.exclusive = true;
    this.loop = 'off'; // the round is over; the game re-selects a loop when play resumes
  }

  gameOver(): void {
    this.music = this.play(gameOver);
    this.bass = null;
    this.effect = null;
    this.exclusive = true;
  }

  startTune(): void {
    this.music = this.play(tuneMelody);
    this.bass = this.play(tuneBass);
    this.effect = null;
    this.exclusive = true;
  }

  setLoop(kind: LoopKind, stage = 0): void {
    if (kind !== this.loop) this.loopFrame = 0;
    this.loop = kind;
    this.stage = stage;
  }

  /** Stop everything (restart, mute). */
  reset(): void {
    this.music = this.bass = this.effect = null;
    this.exclusive = false;
    this.loop = 'off';
  }

  private run(r: Running | null): [VoiceRegs, Running | null] {
    if (!r) return [SILENT, null];
    const regs = r.program(r.frame++);
    return regs ? [regs, r] : [SILENT, null];
  }

  /** Advance one tick and return the register frame for the synth. */
  tick(): Frame {
    const voices: VoiceRegs[] = [SILENT, SILENT, SILENT];
    [voices[0], this.music] = this.run(this.music);
    if (this.exclusive) {
      [voices[1], this.bass] = this.run(this.bass);
      if (!this.music && !this.bass) this.exclusive = false;
    } else {
      const i = this.loopFrame++;
      if (this.loop === 'siren') voices[1] = siren(i, this.stage);
      else if (this.loop === 'fright') voices[1] = fright(i);
      else if (this.loop === 'eyes') voices[1] = eyes(i);
      [voices[2], this.effect] = this.run(this.effect);
    }
    return packFrame(voices.slice(0, VOICES));
  }
}
