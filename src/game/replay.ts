/**
 * Game replays. Because the simulation is deterministic, a whole game is fully
 * described by how it started (seed, starting level, power-on tick) and the
 * direction inputs with the tick each arrived on. A replay also stores a hash of
 * the final state, so a playback can prove it reproduced the original game.
 *
 * Pure TypeScript: recording and verification run in tests and in Node too.
 */
import type { Dir } from './constants';
import { Simulation } from './sim';

export const REPLAY_FORMAT = 'pacman-replay';
export const REPLAY_VERSION = 1;

export interface ReplayFinal {
  tick: number;
  score: number;
  lives: number;
  level: number;
  phase: string;
  hash: string;
}

export interface Replay {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  seed: number;
  startLevel: number;
  /** the power-on tick counter when the game started (it drives the fruit lifetime) */
  powerOnTicks: number;
  /** [sim tick when the input arrived, direction] in arrival order */
  inputs: Array<[number, Dir]>;
  final: ReplayFinal;
}

/** FNV-1a hash of everything that matters about the game state. */
export function stateHash(sim: Simulation): string {
  const parts = [
    sim.tick,
    sim.phase,
    sim.level,
    sim.score,
    sim.lives,
    sim.dotsEaten,
    sim.pac.x,
    sim.pac.y,
    sim.pac.dir,
    ...sim.ghosts.flatMap((g) => [g.x, g.y, g.dir, g.lifecycle]),
    Array.from(sim.dots).join(''),
    Array.from(sim.energizers).join(''),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) h = Math.imul(h ^ parts.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function finalOf(sim: Simulation): ReplayFinal {
  return {
    tick: sim.tick,
    score: sim.score,
    lives: sim.lives,
    level: sim.level,
    phase: sim.phase,
    hash: stateHash(sim),
  };
}

/** Records the inputs of one game. Call begin() right after startNewGame(). */
export class ReplayRecorder {
  private seed = 0;
  private startLevel = 1;
  private powerOnTicks = 0;
  private inputs: Array<[number, Dir]> = [];
  private active = false;

  begin(sim: Simulation): void {
    this.seed = sim.seed;
    this.startLevel = sim.level;
    this.powerOnTicks = sim.powerOnTicks;
    this.inputs = [];
    this.active = true;
  }

  get recording(): boolean {
    return this.active;
  }

  /** Record a direction about to be passed to sim.setDirection(). */
  record(sim: Simulation, dir: Dir): void {
    if (!this.active) return;
    const last = this.inputs[this.inputs.length - 1];
    if (last && last[0] === sim.tick && last[1] === dir) return; // exact duplicate
    this.inputs.push([sim.tick, dir]);
  }

  /** Snapshot of the game so far (or the whole game, once it is over). */
  snapshot(sim: Simulation): Replay | null {
    if (!this.active) return null;
    return {
      format: REPLAY_FORMAT,
      version: REPLAY_VERSION,
      seed: this.seed,
      startLevel: this.startLevel,
      powerOnTicks: this.powerOnTicks,
      inputs: this.inputs.slice(),
      final: finalOf(sim),
    };
  }
}

/** Steps a fresh simulation through a replay, one tick at a time. */
export class ReplayPlayer {
  readonly sim: Simulation;
  private next = 0;

  constructor(readonly replay: Replay) {
    this.sim = new Simulation({ seed: replay.seed, level: replay.startLevel });
    // Reproduce the power-on counter (only the fruit lifetime depends on it).
    this.sim.powerOnTicks = replay.powerOnTicks;
    this.sim.startNewGame();
  }

  get done(): boolean {
    return this.sim.tick >= this.replay.final.tick;
  }

  step(): void {
    if (this.done) return;
    const inputs = this.replay.inputs;
    while (this.next < inputs.length && inputs[this.next][0] === this.sim.tick) {
      this.sim.setDirection(inputs[this.next][1]);
      this.next++;
    }
    this.sim.step();
  }

  /** Did the playback end exactly where the recording did? */
  matches(): boolean {
    return this.done && stateHash(this.sim) === this.replay.final.hash;
  }
}

/** Play a replay headlessly to the end and check it reproduces the recorded final state. */
export function verifyReplay(replay: Replay): boolean {
  const player = new ReplayPlayer(replay);
  const limit = replay.final.tick + 1;
  for (let i = 0; i < limit && !player.done; i++) player.step();
  return player.matches();
}

/** Parse and validate replay JSON; throws a readable Error for anything malformed. */
export function parseReplay(text: string): Replay {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  const r = data as Partial<Replay> | null;
  if (!r || r.format !== REPLAY_FORMAT) throw new Error('not a Pac-Man replay');
  if (r.version !== REPLAY_VERSION) throw new Error(`unsupported replay version ${String(r.version)}`);
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!int(r.seed) || !int(r.startLevel) || !int(r.powerOnTicks)) throw new Error('bad replay header');
  if (!Array.isArray(r.inputs)) throw new Error('bad replay inputs');
  let prev = -1;
  for (const e of r.inputs) {
    if (!Array.isArray(e) || e.length !== 2 || !int(e[0]) || ![0, 1, 2, 3].includes(e[1] as number)) {
      throw new Error('bad replay input entry');
    }
    if ((e[0] as number) < prev) throw new Error('replay inputs out of order');
    prev = e[0] as number;
  }
  const f = r.final;
  if (!f || !int(f.tick) || typeof f.hash !== 'string') throw new Error('bad replay final state');
  return r as Replay;
}
