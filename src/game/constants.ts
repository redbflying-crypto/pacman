/**
 * Central timing, geometry and palette constants.
 *
 * Coordinate conventions (the single canonical system used everywhere):
 *  - "logical pixel": the 224x288 arcade screen, origin top-left, +x right, +y down.
 *  - "tile": 8x8 logical pixels. Full screen is 28x36 tiles. The maze is 28x31 tiles
 *    and is drawn at maze-local y=0, which is screen y = MAZE_OFFSET_Y (24).
 *  - "maze-local pixel": logical pixel minus the maze offset.
 *  - "sub": fixed point unit, SUB subpixels per logical pixel. All simulation
 *    positions and speeds are integers in sub units, so there is no float drift.
 *  - Three.js world coordinates: 1 unit = 1 logical pixel, origin at screen top-left
 *    (the orthographic camera is configured so that world (0,0) is screen (0,0)).
 */

export const SCREEN_W = 224;
export const SCREEN_H = 288;

export const TILE = 8;
export const MAZE_COLS = 28;
export const MAZE_ROWS = 31;
export const MAZE_W = MAZE_COLS * TILE; // 224
export const MAZE_H = MAZE_ROWS * TILE; // 248
export const MAZE_OFFSET_Y = 24; // maze-local y=0 sits at screen y=24
export const MAZE_OFFSET_X = 0;

/** Full-screen tile grid (28x36), used for the HUD and debug overlay. */
export const SCREEN_TILES_X = SCREEN_W / TILE; // 28
export const SCREEN_TILES_Y = SCREEN_H / TILE; // 36

/** Fixed point: 16 subpixels per logical pixel. */
export const SUB = 16;
export const SUB_PX = TILE * SUB; // 128 sub per tile

/** Hardware refresh: 60.606061 Hz (Pac-Man PCB). */
export const TICK_HZ = 60.606061;
export const TICK_MS = 1000 / TICK_HZ;
export const TICKS_PER_SECOND = TICK_HZ;

/**
 * Base speed: 100% = 75.75757625 logical px/s. At the hardware cadence that is
 * exactly 1.25 px per tick = 20 sub per tick, which is why SUB=16 keeps every
 * documented percentage an integer number of subpixels per tick.
 */
export const BASE_SPEED_PX_PER_SEC = 75.75757625;
export const BASE_SPEED_SUB_PER_TICK = 20; // 1.25 px * 16

export function pctToSub(pct: number): number {
  return Math.round((BASE_SPEED_SUB_PER_TICK * pct) / 100);
}

/**
 * Actors move in whole logical pixels. A speed is expressed as the number of
 * one-pixel steps taken per 16 ticks; because SUB = 16 this is numerically the
 * same as the sub-pixels-per-tick figure (100% = 20 px per 16 ticks = 1.25 px/tick).
 */
export const STEP_WINDOW = 16;
export const pctToStepsPer16 = pctToSub;

/** Directions. The numeric order is also the documented tie-break order. */
export const UP = 0;
export const LEFT = 1;
export const DOWN = 2;
export const RIGHT = 3;
export type Dir = 0 | 1 | 2 | 3;
export const NONE = -1;

export const DIR_VEC: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // up
  [-1, 0], // left
  [0, 1], // down
  [1, 0], // right
];
export const OPPOSITE: ReadonlyArray<Dir> = [DOWN, RIGHT, UP, LEFT];
export const DIR_NAMES = ['up', 'left', 'down', 'right'] as const;

export function isDir(d: number): d is Dir {
  return d === 0 || d === 1 || d === 2 || d === 3;
}

/** Convert a logical-pixel position to sub units. */
export const toSub = (px: number): number => Math.round(px * SUB);
export const toPx = (sub: number): number => sub / SUB;

/** Arcade palette (sRGB hex). */
export const COLORS = {
  black: 0x000000,
  blue: 0x2121ff, // maze walls
  wallFlash: 0xffffff,
  dot: 0xffb8ae, // peach pellets
  pacman: 0xffff00,
  blinky: 0xff0000,
  pinky: 0xffb8ff,
  inky: 0x00ffff,
  clyde: 0xffb852,
  frightened: 0x2121ff,
  frightenedFlash: 0xffffff,
  eyes: 0xffffff,
  pupil: 0x2121ff,
  door: 0xffb8de,
  text: 0xffffff,
} as const;

/** Player-facing strings. */
export const READY_TICKS = Math.round(2 * TICK_HZ); // "READY!" dwell
export const DEATH_TICKS = Math.round(1.6 * TICK_HZ);
export const LEVEL_FLASH_TICKS = Math.round(2.0 * TICK_HZ);
export const LIFE_LOSS_PAUSE_TICKS = Math.round(1.0 * TICK_HZ);
export const GHOST_EAT_PAUSE_TICKS = Math.round(0.5 * TICK_HZ);
export const FRUIT_POPUP_TICKS = Math.round(2.0 * TICK_HZ);
export const SCORE_POPUP_TICKS = Math.round(1.0 * TICK_HZ);

/** Movement rules. */
export const CORNER_WINDOW_PX = 4; // documented pre/post-turn window
export const WALL_STOP_MARGIN_PX = 3; // stop just inside the tile so the tile test stays stable
export const PACMAN_START = { x: 112, y: 188 }; // tile (13.5, 23)
export const HOUSE_CENTER = { x: 112, y: 116 }; // tile (13.5, 14)
export const HOUSE_DOOR_OUT = { x: 112, y: 92 }; // tile (13.5, 11)
/**
 * Ghost-house movement. The Dossier documents no speeds or bob amplitude inside
 * the pen, so these are our own values (kept from the earlier build).
 */
export const HOUSE_SPEED_PCT = 40; // bobbing and walking out of the pen
export const EYES_ENTER_SPEED_PCT = 60; // eyes descending to their slot
export const HOUSE_BOB_PX = 4; // waiting ghosts bob ±4 px about the slot centre
export const EYES_TARGET = { col: 13, row: 11 }; // above the left half of the door
export const FRUIT_POS = { x: 112, y: 140 }; // below the ghost house
export const TUNNEL_ROW = 14;
export const TUNNEL_MIN_COL = 6; // tunnel slowdown zone: col < 6 or col > 21
export const TUNNEL_MAX_COL = 21;
export const NO_UP_TILES: ReadonlyArray<readonly [number, number]> = [
  [12, 11],
  [15, 11],
  [12, 23],
  [15, 23],
];

/** Scoring. */
export const DOT_SCORE = 10;
export const ENERGIZER_SCORE = 50;
export const GHOST_SCORES = [200, 400, 800, 1600] as const;
export const EXTRA_LIFE_SCORE = 10000;
export const START_LIVES = 3;
export const FRUIT_TRIGGERS = [70, 170] as const;
export const TOTAL_CONSUMABLES = 244;