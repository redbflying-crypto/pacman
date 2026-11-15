/**
 * Deterministic game simulation. No DOM, no Three.js, no wall-clock time:
 * step() advances exactly one hardware tick (1/60.606061 s) and all state is
 * integer fixed point. Rendering reads a snapshot; it never writes back.
 */
import {
  DEATH_TICKS,
  DIR_VEC,
  DOT_SCORE,
  ENERGIZER_SCORE,
  EXTRA_LIFE_SCORE,
  FRUIT_POPUP_TICKS,
  FRUIT_TRIGGERS,
  GHOST_EAT_PAUSE_TICKS,
  GHOST_SCORES,
  LEFT,
  LEVEL_FLASH_TICKS,
  NONE,
  OPPOSITE,
  PACMAN_START,
  READY_TICKS,
  RIGHT,
  SCORE_POPUP_TICKS,
  START_LIVES,
  SUB,

  TICK_HZ,
  TOTAL_CONSUMABLES,
  UP,
  DOWN,
  TUNNEL_ROW,
  EYES_ENTER_SPEED_PCT,
  HOUSE_BOB_PX,
  HOUSE_SPEED_PCT,
  MAZE_ROWS,
  TILE,
  pctToStepsPer16,
  type Dir,
} from './constants';
import { FRUITS, getLevelConfig, getSchedule, type LevelConfig, type SchedulePhase } from './levels';
import { MAZE, idx, type Layout } from './maze';
import { SPLIT_LAYOUT, SPLIT_LEVEL, restoreRightHalfDots } from './splitScreen';
import { CUTSCENES, intermissionAfter } from './cutscenes';
import {
  ghostCanEnter,
  nextCenterAhead,
  pacCanEnter,
  atTileCentre,
  pacLaneOffset,
  pacTurnTileOf,
  pixelSteps,
  tileOfSubX,
  tileOfSubY,
  wrapX,
} from './movement';
import { EYES_TILE, SCATTER_TARGETS, chooseDirection, chaseTarget, type TileRef } from './ghostAI';
import { FRIGHTENED_SEED, FRUIT_SEED, Rng } from './rng';
import type {
  BehaviorMode,
  FruitState,
  GamePhase,
  GhostId,
  GhostLifecycle,
  GhostState,
  PacState,
  Popup,
  SimSnapshot,
} from './types';
import { GHOST_IDS } from './types';

const HOUSE_X = 112 * SUB;
const HOUSE_Y = 116 * SUB;
const DOOR_OUT_Y = 92 * SUB;
const PAC_START_X = PACMAN_START.x * SUB;
const PAC_START_Y = PACMAN_START.y * SUB;

const GHOST_HOME: Record<GhostId, { x: number; y: number; lifecycle: GhostLifecycle }> = {
  blinky: { x: HOUSE_X, y: DOOR_OUT_Y, lifecycle: 'out' },
  pinky: { x: HOUSE_X, y: HOUSE_Y, lifecycle: 'house' },
  inky: { x: 96 * SUB, y: HOUSE_Y, lifecycle: 'house' },
  clyde: { x: 128 * SUB, y: HOUSE_Y, lifecycle: 'house' },
};

export interface SimOptions {
  seed?: number;
  /** starting level (1..256); also used by startNewGame() */
  level?: number;
  score?: number;
  highScore?: number;
  lives?: number;
  frozen?: boolean;
}

export class Simulation {
  phase: GamePhase = 'title';
  level = 1;
  score = 0;
  highScore = 0;
  lives = START_LIVES;
  extraLifeAwarded = false;

  pac: PacState;
  ghosts: GhostState[];

  /** the playfield for the current level (level 256 uses the split-screen layout) */
  layout: Layout = MAZE;
  dots: Uint8Array;
  energizers: Uint8Array;
  dotsEaten = 0;

  /** intermission being played (index into CUTSCENES) and its tick */
  intermission = -1;
  intermissionTick = 0;
  /** level a new game starts on (1 normally) */
  startLevel: number;

  mode: BehaviorMode = 'scatter';
  modeIndex = 0;
  modeTicksLeft = 0;
  schedule: SchedulePhase[] = [];

  frightTicks = 0;
  frightTotal = 0;
  ghostChain = 0;

  fruit: FruitState | null = null;
  fruitSpawned: [boolean, boolean] = [false, false];
  popups: Popup[] = [];

  elroy: 0 | 1 | 2 = 0;
  elroySuspended = false;

  readyTicks = 0;
  deathTicks = 0;
  flashTicks = 0;
  ghostEatPause = 0;

  tick = 0;
  /**
   * Ticks since the machine was switched on: never reset by a new game, a new
   * level or a death, and it also runs on the title screen. Only the fruit
   * lifetime reads it, which is what keeps that lifetime unpredictable even
   * when the player repeats a pattern (Dossier).
   */
  powerOnTicks = 0;
  seed: number;
  paused = false;
  frozen: boolean;
  /** bumped whenever the consumable map changes, so the renderer can cache the dot texture */
  revision = 0;

  cfg: LevelConfig;
  frightenedRng: Rng;

  globalCounterActive = false;
  globalDotCounter = 0;
  idleTimer = 0;
  modeChangedWhileInside = false;

  highScoreDirty = false;
  message = '';

  constructor(opts: SimOptions = {}) {
    this.seed = opts.seed ?? 0x9e3779b9;
    this.frozen = opts.frozen ?? false;
    this.startLevel = clampLevel(opts.level ?? 1);
    this.level = this.startLevel;
    this.layout = layoutFor(this.level);
    this.score = opts.score ?? 0;
    this.highScore = opts.highScore ?? 0;
    this.lives = opts.lives ?? START_LIVES;
    this.cfg = getLevelConfig(this.level);
    this.schedule = getSchedule(this.level);
    this.frightenedRng = new Rng(FRIGHTENED_SEED);
    this.dots = new Uint8Array(this.layout.dots);
    this.energizers = new Uint8Array(this.layout.energizers);
    this.pac = this.freshPac();
    this.ghosts = this.freshGhosts();
    this.initGhostDecisions();
    this.resetMode();
  }

  // ---------------------------------------------------------------- factories

  private freshPac(): PacState {
    return {
      x: PAC_START_X,
      y: PAC_START_Y,
      dir: LEFT,
      want: NONE,
      freeze: 0,
      stepPhase: 0,
      anim: 0,
      alive: true,
    };
  }

  private freshGhosts(): GhostState[] {
    return GHOST_IDS.map((id) => {
      const home = GHOST_HOME[id];
      return {
        id,
        x: home.x,
        y: home.y,
        dir: id === 'blinky' ? LEFT : UP,
        nextDir: id === 'blinky' ? LEFT : UP,
        lifecycle: home.lifecycle,
        frightened: false,
        houseX: home.x,
        houseY: HOUSE_Y,
        bugged: false,
        reversePending: false,
        dotCounter: 0,
        dotLimit: this.cfg.houseLimits[Math.max(0, GHOST_IDS.indexOf(id) - 1)],
        releaseRequested: false,
        releaseAt: 0,
        anim: 0,
        exitRight: false,
        reviveTimer: 0,
        stepPhase: 0,
      };
    });
  }

  private initGhostDecisions(): void {
    for (const g of this.ghosts) {
      if (g.lifecycle === 'out') g.nextDir = this.decideAhead(g);
      else g.nextDir = g.dir;
    }
  }

  private resetMode(): void {
    this.schedule = getSchedule(this.level);
    this.modeIndex = 0;
    this.mode = this.schedule[0].mode;
    this.modeTicksLeft = this.schedule[0].ticks;
  }

  // ------------------------------------------------------------------ controls

  startNewGame(): void {
    this.level = this.startLevel;
    this.score = 0;
    this.lives = START_LIVES;
    this.extraLifeAwarded = false;
    this.cfg = getLevelConfig(this.level);
    this.resetLevelState();
    this.initGhostDecisions();
    this.phase = 'ready';
    this.readyTicks = READY_TICKS;
    this.tick = 0;
  }

  setDirection(dir: Dir): void {
    if (this.phase === 'playing' || this.phase === 'ready') this.pac.want = dir;
  }

  togglePause(): void {
    if (this.phase === 'playing' || this.phase === 'ready') this.paused = !this.paused;
  }

  private resetLevelState(): void {
    this.revision++;
    this.layout = layoutFor(this.level);
    this.dots = new Uint8Array(this.layout.dots);
    this.energizers = new Uint8Array(this.layout.energizers);
    this.dotsEaten = 0;
    this.fruit = null;
    this.fruitSpawned = [false, false];
    this.popups = [];
    this.pac = this.freshPac();
    this.ghosts = this.freshGhosts();
    this.frightTicks = 0;
    this.frightTotal = 0;
    this.ghostChain = 0;
    this.ghostEatPause = 0;
    this.elroy = 0;
    this.elroySuspended = false;
    this.globalCounterActive = false;
    this.globalDotCounter = 0;
    this.idleTimer = 0;
    this.modeChangedWhileInside = false;
    this.frightenedRng = new Rng(FRIGHTENED_SEED);
    this.resetMode();
    this.initGhostDecisions();
    this.message = '';
  }

  // --------------------------------------------------------------------- step

  step(): void {
    if (this.frozen) return;
    if (this.paused) return;
    this.powerOnTicks++;
    this.tick++;
    switch (this.phase) {
      case 'ready':
        if (this.readyTicks > 0) this.readyTicks--;
        if (this.readyTicks <= 0) this.phase = 'playing';
        return;
      case 'dying':
        if (this.deathTicks > 0) this.deathTicks--;
        if (this.deathTicks <= 0) this.finishDeath();
        return;
      case 'levelclear':
        if (this.flashTicks > 0) this.flashTicks--;
        if (this.flashTicks <= 0) {
          const scene = intermissionAfter(this.level);
          if (scene >= 0) {
            this.phase = 'intermission';
            this.intermission = scene;
            this.intermissionTick = 0;
            this.message = 'intermission';
          } else {
            this.advanceLevel();
          }
        }
        return;
      case 'intermission':
        this.intermissionTick++;
        if (this.intermissionTick >= CUTSCENES[this.intermission].duration) {
          this.intermission = -1;
          this.advanceLevel();
        }
        return;
      case 'playing':
        this.stepPlaying();
        return;
      case 'title':
      case 'gameover':
        return;
    }
  }

  private stepPlaying(): void {
    if (this.ghostEatPause > 0) {
      this.ghostEatPause--;
      this.updatePopups();
      return;
    }

    if (this.frightTicks > 0) {
      this.frightTicks--;
      if (this.frightTicks === 0) this.endFrightened();
    } else {
      this.advanceMode();
    }

    this.updateElroy();
    this.stepPac();
    if (this.phase !== 'playing') return;
    for (const g of this.ghosts) this.stepGhost(g);
    this.updateHouse();
    this.updateFruit();
    this.updatePopups();
    this.checkCollisions();
    this.checkLevelClear();
  }

  stepTicks(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  // --------------------------------------------------------------------- mode

  private advanceMode(): void {
    if (!Number.isFinite(this.modeTicksLeft)) return;
    this.modeTicksLeft--;
    if (this.modeTicksLeft > 0) return;
    this.modeIndex++;
    const next = this.schedule[Math.min(this.modeIndex, this.schedule.length - 1)];
    if (next.mode !== this.mode) {
      this.mode = next.mode;
      this.requestReversal();
    }
    this.modeTicksLeft = next.ticks;
  }

  private requestReversal(): void {
    for (const g of this.ghosts) {
      if (g.lifecycle === 'out') g.reversePending = true;
      else if (g.lifecycle === 'house') this.modeChangedWhileInside = true;
    }
  }

  // ----------------------------------------------------------------- frightened

  private startFrightened(): void {
    this.ghostChain = 0;
    if (this.cfg.frightTicks <= 0) {
      // Still reverse, but ghosts never turn blue.
      this.requestReversal();
      return;
    }
    this.frightTotal = this.cfg.frightTicks;
    this.frightTicks = this.cfg.frightTicks;
    for (const g of this.ghosts) {
      if (g.lifecycle === 'out') {
        g.reversePending = true;
        g.frightened = true;
      } else if (g.lifecycle === 'house') {
        g.frightened = true;
        this.modeChangedWhileInside = true;
      } else if (g.lifecycle === 'exiting') {
        g.frightened = true;
      }
    }
  }

  private endFrightened(): void {
    this.frightTicks = 0;
    this.frightTotal = 0;
    this.ghostChain = 0;
    for (const g of this.ghosts) g.frightened = false;
  }

  // ------------------------------------------------------------------- pac-man

  private pacStepsPer16(): number {
    return pctToStepsPer16(this.frightTicks > 0 ? this.cfg.pacFrightSpeed : this.cfg.pacSpeed);
  }

  private stepPac(): void {
    const pac = this.pac;
    pac.anim++;
    if (pac.freeze > 0) {
      pac.freeze--;
      return;
    }
    const steps = pixelSteps(this.pacStepsPer16(), pac.stepPhase++);
    for (let i = 0; i < steps; i++) {
      if (!this.pacPixelStep()) break;
      // Eating stops Pac-Man at once: the rest of this tick's movement is lost
      // and the freeze set by eatAtPacTile covers the documented 1 / 3 frames.
      if (this.eatAtPacTile()) break;
    }
  }

  /**
   * One pixel of Pac-Man movement. Returns false when he is stopped by a wall.
   *
   * Cornering (Dossier): a requested turn is accepted anywhere inside the turning
   * tile (see pacTurnTileOf) if the tile beyond it in the new direction is open.
   * Each step then moves one pixel in the new direction AND one pixel toward the
   * new lane's centreline on the old axis — the 45° pre-/post-turn, which covers
   * ground twice as fast until he is back on the centreline.
   */
  private pacPixelStep(): boolean {
    const pac = this.pac;
    let col = pacTurnTileOf(pac.x);
    let row = pacTurnTileOf(pac.y);

    if (pac.want !== NONE && pac.want !== pac.dir) {
      if (pac.want === OPPOSITE[pac.dir]) {
        pac.dir = pac.want;
      } else {
        const [wx, wy] = DIR_VEC[pac.want];
        if (pacCanEnter(col + wx, row + wy, this.layout)) pac.dir = pac.want;
      }
    }

    const [dx, dy] = DIR_VEC[pac.dir];
    if (!pacCanEnter(col + dx, row + dy, this.layout)) {
      // Facing a wall: advance to the tile centre and stop there. (The Dossier
      // does not say where he stops; the centre keeps his sprite clear of the
      // wall line and matches how the arcade looks.)
      const along = dx !== 0 ? pacLaneOffset(pac.x) * dx : pacLaneOffset(pac.y) * dy;
      if (along >= 0) {
        this.alignPacToLane(dx !== 0);
        return false;
      }
    }

    pac.x += dx * SUB;
    pac.y += dy * SUB;
    this.alignPacToLane(dx !== 0);
    if (row === TUNNEL_ROW || tileOfSubY(pac.y) === TUNNEL_ROW) pac.x = wrapX(pac.x);
    return true;
  }

  /** Close one pixel of offset on the axis perpendicular to travel. */
  private alignPacToLane(horizontal: boolean): void {
    const pac = this.pac;
    if (horizontal) {
      const off = pacLaneOffset(pac.y);
      if (off !== 0) pac.y -= Math.sign(off) * SUB;
    } else {
      const off = pacLaneOffset(pac.x);
      if (off !== 0) pac.x -= Math.sign(off) * SUB;
    }
  }

  /** Eat whatever is on Pac-Man's tile. Returns true when something was eaten. */
  private eatAtPacTile(): boolean {
    const pac = this.pac;
    const col = tileOfSubX(pac.x);
    const row = tileOfSubY(pac.y);
    if (col < 0 || col >= 28 || row < 0 || row >= 31) return false;
    const i = idx(col, row);
    if (this.dots[i]) {
      this.dots[i] = 0;
      this.dotsEaten++;
      this.revision++;
      pac.freeze = 1;
      this.addScore(DOT_SCORE);
      this.onConsumableEaten();
      return true;
    }
    if (this.energizers[i]) {
      this.energizers[i] = 0;
      this.dotsEaten++;
      this.revision++;
      pac.freeze = 3;
      this.addScore(ENERGIZER_SCORE);
      this.startFrightened();
      this.onConsumableEaten();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------- ghosts

  /** Ghost speed as one-pixel steps per 16 ticks. */
  private ghostStepsPer16(g: GhostState): number {
    if (g.lifecycle === 'eaten' || g.lifecycle === 'entering') return pctToStepsPer16(100);
    let pct = this.cfg.ghostSpeed;
    if (g.frightened) pct = this.cfg.ghostFrightSpeed;
    if (g.id === 'blinky' && this.elroy === 1) pct = this.cfg.elroy1Speed;
    if (g.id === 'blinky' && this.elroy === 2) pct = this.cfg.elroy2Speed;
    const row = tileOfSubY(g.y);
    const col = tileOfSubX(g.x);
    if (row === TUNNEL_ROW && (col <= 5 || col >= 22)) pct = Math.min(pct, this.cfg.ghostTunnelSpeed);
    return pctToStepsPer16(pct);
  }

  /** Whole-pixel distance (in sub units) a ghost covers this tick at `pct` inside the house. */
  private houseStep(g: GhostState, pct: number): number {
    return pixelSteps(pctToStepsPer16(pct), g.stepPhase++) * SUB;
  }

  private stepGhost(g: GhostState): void {
    switch (g.lifecycle) {
      case 'house':
        g.anim++;
        if (g.reviveTimer > 0) g.reviveTimer--;
        this.stepBob(g);
        return;
      case 'exiting':
        g.anim++;
        this.stepExit(g);
        return;
      case 'entering':
        g.anim++;
        this.stepEnter(g);
        return;
      case 'bugged':
        g.anim++;
        this.stepBugged(g);
        return;
      default:
        break;
    }

    g.anim++;
    const steps = pixelSteps(this.ghostStepsPer16(g), g.stepPhase++);
    for (let i = 0; i < steps; i++) {
      const [dx, dy] = DIR_VEC[g.dir];
      g.x += dx * SUB;
      g.y += dy * SUB;
      if (tileOfSubY(g.y) === TUNNEL_ROW) g.x = wrapX(g.x);

      // Ghosts never cut corners: every decision happens exactly on a tile centre.
      if (!atTileCentre(dx !== 0 ? g.x : g.y)) continue;

      const col = tileOfSubX(g.x);
      const row = tileOfSubY(g.y);
      if (g.reversePending) {
        g.dir = OPPOSITE[g.dir];
        g.reversePending = false;
      } else {
        g.dir = g.nextDir;
      }
      const [ndx, ndy] = DIR_VEC[g.dir];
      g.nextDir = this.chooseNextDir(g, col + ndx, row + ndy);

      if (g.lifecycle === 'eaten' && col === EYES_TILE.col && row === EYES_TILE.row) {
        g.lifecycle = 'entering';
        g.frightened = false;
        return;
      }
    }
  }

  /**
   * Decide the next turn for a ghost that has just left (or is between) tile
   * centres: look up the centre it will reach next along its current direction.
   */
  private decideAhead(g: GhostState): Dir {
    const [dx, dy] = DIR_VEC[g.dir];
    const ax = dx !== 0 ? nextCenterAhead(g.x, g.dir) : g.x;
    const ay = dy !== 0 ? nextCenterAhead(g.y, g.dir) : g.y;
    return this.chooseNextDir(g, tileOfSubX(ax), tileOfSubY(ay));
  }

  /**
   * Direction the ghost will take on arriving at tile (nextCol, nextRow), the
   * centre it is currently heading for (one-tile-ahead decision).
   */
  private chooseNextDir(g: GhostState, nextCol: number, nextRow: number): Dir {
    const eyes = g.lifecycle === 'eaten';

    if (!ghostCanEnter(nextCol, nextRow, eyes, eyes, this.layout)) {
      return OPPOSITE[g.dir];
    }

    const target = this.ghostTarget(g);
    const dir = chooseDirection({
      col: nextCol,
      row: nextRow,
      dir: g.dir,
      target,
      allowDoor: eyes,
      allowHouse: eyes,
      applyNoUp: g.lifecycle === 'out',
      frightened: g.frightened && g.lifecycle === 'out',
      rng: () => this.frightenedRng.next(),
      layout: this.layout,
    });
    if (dir === -1) return OPPOSITE[g.dir];
    return dir;
  }

  private ghostTarget(g: GhostState): TileRef {
    if (g.lifecycle === 'eaten') return EYES_TILE;
    if (this.mode === 'scatter' && !(g.id === 'blinky' && this.elroy > 0)) {
      return SCATTER_TARGETS[g.id];
    }
    const pacCol = tileOfSubX(this.pac.x);
    const pacRow = tileOfSubY(this.pac.y);
    const blinky = this.ghosts[0];
    const blinkyTile = { col: tileOfSubX(blinky.x), row: tileOfSubY(blinky.y) };
    return chaseTarget(g.id, { col: tileOfSubX(g.x), row: tileOfSubY(g.y) }, {
      pacCol,
      pacRow,
      pacDir: this.pac.dir,
      blinky: blinkyTile,
      elroy: this.elroy > 0,
    });
  }

  // -------------------------------------------------------------- ghost house

  private updateHouse(): void {
    // inactivity timeout: request the preferred ghost still inside
    this.idleTimer++;
    if (this.idleTimer >= this.cfg.idleLimitTicks) {
      this.idleTimer = 0;
      const preferred = this.preferredGhostInHouse();
      if (preferred) preferred.releaseRequested = true;
    }

    // Blinky is never governed by the dot counters or the inactivity timer
    // (both only consider Pinky, Inky and Clyde), so once his eyes have been
    // revived in the house he leaves at once — including while the post-death
    // global counter is active, which otherwise has no rule that frees him.
    const blinky = this.ghosts[0];
    if (blinky.lifecycle === 'house' && blinky.reviveTimer <= 0) blinky.releaseRequested = true;

    if (!this.globalCounterActive) {
      for (const g of this.ghosts) {
        if (g.lifecycle === 'house' && g.reviveTimer <= 0 && g.dotCounter >= g.dotLimit) {
          g.releaseRequested = true;
        }
      }
    }

    // Release every ghost whose request is due. Exits are independent, so
    // several ghosts can be walking out at once (e.g. level 3+, where all the
    // dot limits are zero, or the timer firing while another ghost leaves).
    for (const g of this.ghosts) {
      if (g.lifecycle === 'house' && g.reviveTimer <= 0 && g.releaseRequested) this.startExit(g);
    }
  }

  private preferredGhostInHouse(): GhostState | null {
    for (const id of ['pinky', 'inky', 'clyde'] as GhostId[]) {
      const g = this.ghosts.find((x) => x.id === id);
      if (g && g.lifecycle === 'house' && g.reviveTimer <= 0) return g;
    }
    return null;
  }

  private releasePreferred(): void {
    const g = this.preferredGhostInHouse();
    if (g) g.releaseRequested = true;
  }

  private startExit(g: GhostState): void {
    if (g.lifecycle !== 'house') return;
    g.releaseRequested = false;
    g.lifecycle = 'exiting';
    g.exitRight = this.modeChangedWhileInside;
    g.frightened = g.frightened && this.frightTicks > 0;
  }

  /** Waiting ghosts bob up and down about their slot centre, reversing at the limits. */
  private stepBob(g: GhostState): void {
    const speed = this.houseStep(g, HOUSE_SPEED_PCT);
    if (speed === 0) return;
    const top = HOUSE_Y - HOUSE_BOB_PX * SUB;
    const bottom = HOUSE_Y + HOUSE_BOB_PX * SUB;
    if (g.dir !== UP && g.dir !== DOWN) g.dir = UP;
    if (g.dir === UP) {
      g.y = Math.max(top, g.y - speed);
      if (g.y === top) g.dir = DOWN;
    } else {
      g.y = Math.min(bottom, g.y + speed);
      if (g.y === bottom) g.dir = UP;
    }
  }

  /**
   * Walk out of the pen from wherever the bob left the ghost: a side ghost
   * first levels off on the slot centreline, then slides to the door column;
   * a centre ghost goes straight up. Then up through the door into the maze.
   */
  private stepExit(g: GhostState): void {
    const speed = this.houseStep(g, HOUSE_SPEED_PCT);
    const tx = HOUSE_X;
    if (g.x !== tx) {
      if (g.y !== HOUSE_Y) {
        const dy = Math.sign(HOUSE_Y - g.y);
        g.y += dy * Math.min(speed, Math.abs(HOUSE_Y - g.y));
        g.dir = dy < 0 ? UP : DOWN;
        return;
      }
      this.slideX(g, tx, speed);
      return;
    }
    const ty = DOOR_OUT_Y;
    if (g.y > ty) {
      g.y -= Math.min(speed, g.y - ty);
      g.dir = UP;
      if (g.y <= ty) {
        g.y = ty;
        g.lifecycle = 'out';
        g.dir = g.exitRight ? RIGHT : LEFT;
        g.reversePending = false;
        // The door column sits between tiles 13 and 14; decide for whichever
        // centre is actually reached first in the exit direction.
        g.nextDir = this.decideAhead(g);
      }
    }
  }

  private stepEnter(g: GhostState): void {
    const speed = this.houseStep(g, EYES_ENTER_SPEED_PCT);
    // Eyes revive in the ghost's own pen slot: Blinky and Pinky in the centre,
    // Inky on the left, Clyde on the right. Ghost-bug eyes drop straight down
    // the door column and revive there.
    const slotX = g.id === 'blinky' || g.bugged ? HOUSE_X : GHOST_HOME[g.id].x;
    if (g.y < HOUSE_Y) {
      // align to the door column, then descend into the pen
      if (g.x !== HOUSE_X) {
        this.slideX(g, HOUSE_X, speed);
        return;
      }
      g.y += Math.min(speed, HOUSE_Y - g.y);
      g.dir = DOWN;
      if (g.y < HOUSE_Y) return;
      g.y = HOUSE_Y;
    }
    if (g.x !== slotX) {
      this.slideX(g, slotX, speed);
      if (g.x !== slotX) return;
    }
    g.frightened = false;
    g.houseX = slotX;
    g.houseY = HOUSE_Y;
    g.dir = UP;
    if (g.bugged) {
      // Appendix B: the regenerated ghost immediately heads straight up.
      g.lifecycle = 'bugged';
      return;
    }
    g.lifecycle = 'house';
    g.reviveTimer = 20;
  }

  /**
   * Dossier Appendix B ("ghost bug"): a ghost eaten while its lower edge is
   * still in the door revives and moves straight up through the maze walls,
   * wraps from the top of the maze to the bottom, and carries on upward until
   * it is back in the pen; then it behaves normally again. The Dossier gives no
   * speed for this, so it uses the level's normal ghost speed.
   */
  private stepBugged(g: GhostState): void {
    const steps = pixelSteps(pctToStepsPer16(this.cfg.ghostSpeed), g.stepPhase++);
    for (let i = 0; i < steps; i++) {
      const wasBelowPen = g.y > HOUSE_Y;
      g.y -= SUB;
      if (g.y < 0) g.y += MAZE_ROWS * TILE * SUB;
      if (wasBelowPen && g.y === HOUSE_Y) {
        g.bugged = false;
        g.lifecycle = 'house';
        g.dir = UP;
        return;
      }
    }
  }

  /** Move horizontally toward `tx` by at most `speed`, facing the travel direction. */
  private slideX(g: GhostState, tx: number, speed: number): void {
    const dir = Math.sign(tx - g.x);
    g.x += dir * Math.min(speed, Math.abs(tx - g.x));
    g.dir = dir < 0 ? LEFT : RIGHT;
  }

  private onConsumableEaten(): void {
    this.idleTimer = 0;
    if (this.globalCounterActive) {
      this.globalDotCounter++;
      const clyde = this.ghosts.find((g) => g.id === 'clyde');
      if (this.globalDotCounter === 7) {
        const pinky = this.ghosts.find((g) => g.id === 'pinky');
        if (pinky && pinky.lifecycle === 'house') pinky.releaseRequested = true;
      } else if (this.globalDotCounter === 17) {
        const inky = this.ghosts.find((g) => g.id === 'inky');
        if (inky && inky.lifecycle === 'house') inky.releaseRequested = true;
      } else if (this.globalDotCounter >= 32 && clyde && clyde.lifecycle === 'house') {
        this.globalDotCounter = 0;
        this.globalCounterActive = false;
        this.releasePreferred();
      }
    } else {
      const g = this.preferredGhostInHouse();
      if (g) {
        g.dotCounter++;
        if (g.dotCounter >= g.dotLimit) g.releaseRequested = true;
      }
    }
    this.checkFruitTrigger();
  }

  // --------------------------------------------------------------------- elroy

  private updateElroy(): void {
    // Post-death suspension lasts until Clyde starts leaving the house.
    if (this.elroySuspended) {
      const clyde = this.ghosts.find((g) => g.id === 'clyde');
      if (clyde && (clyde.lifecycle === 'exiting' || clyde.lifecycle === 'out')) {
        this.elroySuspended = false;
      }
    }
    const remaining = TOTAL_CONSUMABLES - this.dotsEaten;
    let e: 0 | 1 | 2 = 0;
    if (remaining <= this.cfg.elroy2Dots) e = 2;
    else if (remaining <= this.cfg.elroy1Dots) e = 1;
    if (this.elroySuspended) e = 0;
    this.elroy = e;
  }

  // --------------------------------------------------------------------- fruit

  private checkFruitTrigger(): void {
    for (let i = 0; i < FRUIT_TRIGGERS.length; i++) {
      if (!this.fruitSpawned[i] && this.dotsEaten >= FRUIT_TRIGGERS[i]) {
        this.fruitSpawned[i] = true;
        const total = this.fruitLifetimeTicks();
        this.fruit = { type: this.cfg.fruit, ticksLeft: total, totalTicks: total };
        this.message = `fruit:${this.cfg.fruit}`;
      }
    }
  }

  /**
   * Dossier: the bonus symbol stays "between nine and ten seconds", and the
   * exact time does not become predictable with patterns. The Dossier does not
   * say what drives it, so we hash the power-on tick counter (which includes
   * time spent on the title screen) with the seed: deterministic for a replay
   * that includes the title wait, but not something a pattern can control.
   */
  private fruitLifetimeTicks(): number {
    const f = new Rng((this.seed ^ FRUIT_SEED ^ Math.imul(this.powerOnTicks, 0x9e3779b1)) >>> 0).next();
    return Math.round(9 * TICK_HZ) + Math.floor(f * (Math.round(10 * TICK_HZ) - Math.round(9 * TICK_HZ) + 1));
  }

  private updateFruit(): void {
    if (!this.fruit) return;
    this.fruit.ticksLeft--;
    if (this.fruit.ticksLeft <= 0) {
      this.fruit = null;
      return;
    }
    const pac = this.pac;
    if (Math.abs(pac.x - 112 * SUB) <= 8 * SUB && Math.abs(pac.y - 140 * SUB) <= 8 * SUB) {
      this.addScore(this.cfg.fruitScore);
      this.popups.push({
        x: 112,
        y: 140,
        text: String(this.cfg.fruitScore),
        ticks: FRUIT_POPUP_TICKS,
        totalTicks: FRUIT_POPUP_TICKS,
      });
      this.fruit = null;
    }
  }

  // ------------------------------------------------------------------- scoring

  addScore(points: number): void {
    this.score += points;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.highScoreDirty = true;
    }
    if (!this.extraLifeAwarded && this.score >= EXTRA_LIFE_SCORE) {
      this.extraLifeAwarded = true;
      this.lives++;
    }
  }

  private updatePopups(): void {
    for (const p of this.popups) p.ticks--;
    this.popups = this.popups.filter((p) => p.ticks > 0);
  }

  // ---------------------------------------------------------------- collisions

  private checkCollisions(): void {
    const pc = tileOfSubX(this.pac.x);
    const pr = tileOfSubY(this.pac.y);
    for (const g of this.ghosts) {
      // Ghosts in the pen can never share Pac-Man's tile, so testing 'exiting'
      // only matters in the doorway (row 11) — which is how the ghost bug starts.
      // A 'bugged' ghost rising through the walls is not tested: the Dossier does
      // not say whether it can touch Pac-Man, so we let it pass through.
      if (g.lifecycle !== 'out' && g.lifecycle !== 'exiting') continue;
      const gc = tileOfSubX(g.x);
      const gr = tileOfSubY(g.y);
      if (gc !== pc || gr !== pr) continue;
      if (g.frightened && this.frightTicks > 0) {
        const points = GHOST_SCORES[Math.min(this.ghostChain, GHOST_SCORES.length - 1)];
        this.ghostChain++;
        this.addScore(points);
        this.popups.push({
          x: pc * 8 + 4,
          y: pr * 8 + 4,
          text: String(points),
          ticks: SCORE_POPUP_TICKS,
          totalTicks: SCORE_POPUP_TICKS,
        });
        if (g.lifecycle === 'exiting') {
          // Caught in the door: the eyes go straight back into the pen (Appendix B).
          g.bugged = true;
          g.lifecycle = 'entering';
        } else {
          g.lifecycle = 'eaten';
        }
        g.frightened = false;
        g.reversePending = false;
        this.ghostEatPause = GHOST_EAT_PAUSE_TICKS;
        return;
      }
      this.startDeath();
      return;
    }
  }

  private startDeath(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'dying';
    this.deathTicks = DEATH_TICKS;
    this.pac.alive = false;
    this.message = 'death';
  }

  private finishDeath(): void {
    this.lives--;
    if (this.lives <= 0) {
      this.phase = 'gameover';
      this.highScoreDirty = true;
      this.message = 'gameover';
      return;
    }
    if (this.layout.kind === 'split' && restoreRightHalfDots(this.dots, this.layout) > 0) this.revision++;
    this.pac = this.freshPac();
    this.ghosts = this.freshGhosts();
    this.frightTicks = 0;
    this.frightTotal = 0;
    this.ghostChain = 0;
    this.ghostEatPause = 0;
    this.fruit = null;
    this.popups = [];
    this.resetMode();
    this.globalCounterActive = true;
    this.globalDotCounter = 0;
    this.idleTimer = 0;
    this.elroySuspended = true;
    this.modeChangedWhileInside = false;
    this.frightenedRng = new Rng(FRIGHTENED_SEED);
    this.initGhostDecisions();
    this.phase = 'ready';
    this.readyTicks = READY_TICKS;
    this.message = 'ready';
  }

  private checkLevelClear(): void {
    if (this.dotsEaten < TOTAL_CONSUMABLES) return;
    this.phase = 'levelclear';
    this.flashTicks = LEVEL_FLASH_TICKS;
    this.fruit = null;
    this.message = 'levelclear';
  }

  private advanceLevel(): void {
    this.level = clampLevel(this.level + 1);
    this.cfg = getLevelConfig(this.level);
    this.resetLevelState();
    this.phase = 'ready';
    this.readyTicks = READY_TICKS;
    this.message = 'ready';
  }

  // ------------------------------------------------------------------ snapshot

  snapshot(): SimSnapshot {
    return {
      phase: this.phase,
      level: this.level,
      score: this.score,
      highScore: this.highScore,
      lives: this.lives,
      pac: this.pac,
      ghosts: this.ghosts,
      dots: this.dots,
      energizers: this.energizers,
      dotsEaten: this.dotsEaten,
      totalDots: TOTAL_CONSUMABLES,
      mode: this.mode,
      modeTimer: this.modeTicksLeft,
      frightTicks: this.frightTicks,
      frightTotal: this.frightTotal,
      ghostChain: this.ghostChain,
      fruit: this.fruit,
      popups: this.popups,
      elroy: this.elroy,
      readyTicks: this.readyTicks,
      deathTicks: this.deathTicks,
      flashTicks: this.flashTicks,
      tick: this.tick,
      seed: this.seed,
      paused: this.paused,
      message: this.message,
    };
  }

  // ------------------------------------------------------------------ debugging

  ghostById(id: GhostId): GhostState {
    const g = this.ghosts.find((x) => x.id === id);
    if (!g) throw new Error(`no ghost ${id}`);
    return g;
  }

  pacTile(): TileRef {
    return { col: tileOfSubX(this.pac.x), row: tileOfSubY(this.pac.y) };
  }

  ghostTile(id: GhostId): TileRef {
    const g = this.ghostById(id);
    return { col: tileOfSubX(g.x), row: tileOfSubY(g.y) };
  }

  remainingDots(): number {
    let n = 0;
    for (let i = 0; i < this.dots.length; i++) n += this.dots[i] + this.energizers[i];
    return n;
  }

  /** Debug overlay helper: the tile each ghost is currently pathing toward. */
  debugGhostTargets(): TileRef[] {
    return this.ghosts.map((g) => this.ghostTarget(g));
  }

  debugHouseCounters(): Array<{ id: GhostId; counter: number; limit: number; state: GhostLifecycle }> {
    return this.ghosts.map((g) => ({ id: g.id, counter: g.dotCounter, limit: g.dotLimit, state: g.lifecycle }));
  }

  debugGlobalCounter(): { active: boolean; value: number; idle: number } {
    return { active: this.globalCounterActive, value: this.globalDotCounter, idle: this.idleTimer };
  }
}

export const FRUIT_INFO = FRUITS;

/** Levels run 1..256: the 8-bit level counter makes 256 the last (split-screen) level. */
export function clampLevel(level: number): number {
  return Math.min(SPLIT_LEVEL, Math.max(1, Math.floor(level)));
}

function layoutFor(level: number): Layout {
  return level === SPLIT_LEVEL ? SPLIT_LAYOUT : MAZE;
}