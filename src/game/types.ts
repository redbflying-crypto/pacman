import type { Dir } from './constants';

export type GhostId = 'blinky' | 'pinky' | 'inky' | 'clyde';
export const GHOST_IDS: readonly GhostId[] = ['blinky', 'pinky', 'inky', 'clyde'];

/** Lifecycle of a single ghost. Kept separate from the global scatter/chase mode. */
export type GhostLifecycle =
  | 'house' // waiting inside the pen
  | 'exiting' // scripted path to the door and out
  | 'out' // normal roaming (chase/scatter/frightened)
  | 'eaten' // eyes returning to the pen
  | 'entering' // scripted descent into the pen
  | 'bugged'; // Dossier Appendix B "ghost bug": revived ghost rising straight up through the walls

export type BehaviorMode = 'scatter' | 'chase';

export type GamePhase =
  | 'title'
  | 'ready'
  | 'playing'
  | 'dying'
  | 'levelclear'
  | 'intermission'
  | 'gameover';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PacState {
  /** sub-pixel position (maze-local) */
  x: number;
  y: number;
  dir: Dir;
  /** buffered requested direction, NONE when empty */
  want: Dir | -1;
  /** remaining movement-freeze ticks after eating */
  freeze: number;
  /** position in the 16-tick pixel-step pattern (see pixelSteps) */
  stepPhase: number;
  /** mouth animation tick */
  anim: number;
  alive: boolean;
}

export interface GhostState {
  id: GhostId;
  x: number;
  y: number;
  dir: Dir;
  /** direction decided one tile ahead (the original looks ahead before turning) */
  nextDir: Dir;
  lifecycle: GhostLifecycle;
  frightened: boolean;
  /** the ghost's pen slot (where it waits and bobs) */
  houseX: number;
  houseY: number;
  /** eaten while still exiting through the door: revives into the 'bugged' state */
  bugged: boolean;
  /** reversal requested by a mode change; consumed at the next tile centre */
  reversePending: boolean;
  /** personal dot counter (classic) */
  dotCounter: number;
  dotLimit: number;
  /** set when a release condition is met; consumed when the door is free */
  releaseRequested: boolean;
  /** global counter bookkeeping after a death */
  releaseAt: number;
  /** animation tick */
  anim: number;
  /** house exit side preference (left unless mode changed while inside) */
  exitRight: boolean;
  /** revive delay while inside after being eaten */
  reviveTimer: number;
  /** position in the 16-tick pixel-step pattern (see pixelSteps) */
  stepPhase: number;
}

export interface FruitState {
  type: number; // 0..7 (cherry, strawberry, orange, apple, melon, galaxian, bell, key)
  ticksLeft: number;
  totalTicks: number;
}

export interface Popup {
  x: number;
  y: number;
  text: string;
  ticks: number;
  totalTicks: number;
}

export interface SimSnapshot {
  phase: GamePhase;
  level: number;
  score: number;
  highScore: number;
  lives: number;
  pac: PacState;
  ghosts: GhostState[];
  dots: Uint8Array; // 1 = present
  energizers: Uint8Array; // 1 = present
  dotsEaten: number;
  totalDots: number;
  mode: BehaviorMode;
  modeTimer: number;
  frightTicks: number;
  frightTotal: number;
  ghostChain: number;
  fruit: FruitState | null;
  popups: Popup[];
  elroy: 0 | 1 | 2;
  readyTicks: number;
  deathTicks: number;
  flashTicks: number;
  tick: number;
  seed: number;
  paused: boolean;
  message: string;
}