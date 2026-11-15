/**
 * Pure movement helpers. No Three.js, no DOM: everything here is integer
 * fixed point so a simulation can be stepped identically in tests and in the
 * browser.
 */
import { DIR_VEC, MAZE_OFFSET_X, MAZE_OFFSET_Y, SCREEN_W, STEP_WINDOW, SUB, SUB_PX, TILE, type Dir } from './constants';
import { MAZE, pacWalkable, tileAt, Tile, type Layout } from './maze';

export interface SubPos {
  x: number;
  y: number;
}

export const sub = (px: number): number => Math.round(px * SUB);
export const px = (s: number): number => s / SUB;

export const tileCenterSub = (col: number, row: number): SubPos => ({
  x: (col * TILE + TILE / 2) * SUB,
  y: (row * TILE + TILE / 2) * SUB,
});

export const tileOfSubX = (x: number): number => Math.floor(x / SUB_PX);
export const tileOfSubY = (y: number): number => Math.floor(y / SUB_PX);

/** Maze-local sub pixel -> screen pixel (for rendering). */
export const mazeToScreenX = (xSub: number): number => px(xSub) + MAZE_OFFSET_X;
export const mazeToScreenY = (ySub: number): number => px(ySub) + MAZE_OFFSET_Y;

/** Horizontal tunnel wrap in sub units. */
export function wrapX(x: number): number {
  const max = SCREEN_W * SUB;
  if (x < 0) return x + max;
  if (x >= max) return x - max;
  return x;
}

export function isWrapRow(row: number): boolean {
  return row === 14;
}

/** Wrap only applies on the tunnel row; other rows clamp (never happens in practice). */
export function wrapActor(x: number, y: number): SubPos {
  const row = tileOfSubY(y);
  if (row === 14) return { x: wrapX(x), y };
  return { x, y };
}

/**
 * Number of one-pixel steps to take on tick `phase` for a speed of
 * `stepsPer16` pixels per 16 ticks. Steps are spread evenly (Bresenham), so any
 * 16 consecutive ticks take exactly `stepsPer16` steps. The Dossier gives only
 * the average percentages, not the ROM's per-frame patterns, so the even
 * distribution is our own choice. Rounding up means an actor slower than
 * 1 px/tick still moves on the first tick of the window rather than stalling.
 */
export function pixelSteps(stepsPer16: number, phase: number): number {
  const p = phase & (STEP_WINDOW - 1);
  return Math.ceil(((p + 1) * stepsPer16) / STEP_WINDOW) - Math.ceil((p * stepsPer16) / STEP_WINDOW);
}

/**
 * Pac-Man's turning tile along one axis. Per the Dossier, moving right/down he
 * may turn up to 3 px before a tile centre and 4 px after it; moving left/up,
 * 4 before and 3 after. Both cases are the window [centre-3, centre+4], i.e.
 * the arcade's tile centre sits one pixel lower than ours (offset 3, not 4).
 */
export const pacTurnTileOf = (v: number): number => Math.floor((v - SUB) / SUB_PX);

/** Signed offset (sub units) of `v` from the centre of its turning tile. */
export const pacLaneOffset = (v: number): number => v - (pacTurnTileOf(v) * TILE + TILE / 2) * SUB;

/** True when `v` is exactly on a tile centre (8k+4 px), including off-screen tunnel tiles. */
export const atTileCentre = (v: number): boolean => (((v - 4 * SUB) % SUB_PX) + SUB_PX) % SUB_PX === 0;

export function pacCanEnter(col: number, row: number, layout: Layout = MAZE): boolean {
  return pacWalkable(col, row, layout);
}

export function ghostCanEnter(
  col: number,
  row: number,
  allowDoor: boolean,
  allowHouse: boolean,
  layout: Layout = MAZE,
): boolean {
  const t = tileAt(col, row, layout);
  if (t === Tile.Door) return allowDoor;
  if (t === Tile.House) return allowHouse;
  if (t === Tile.Wall || t === Tile.Void) return false;
  return true;
}

/**
 * Next tile centre along an axis, in sub units, strictly ahead of `v`.
 * Centres are at 8k+4 px, i.e. (8k+4)*SUB.
 */
export function nextCenterAhead(v: number, dir: Dir): number {
  const sign = dir === 0 || dir === 1 ? -1 : 1;
  if (sign > 0) {
    const k = Math.floor((v - 4 * SUB) / (8 * SUB)) + 1;
    return (8 * k + 4) * SUB;
  }
  const k = Math.ceil((v - 4 * SUB) / (8 * SUB)) - 1;
  return (8 * k + 4) * SUB;
}

export function dirVec(dir: Dir): readonly [number, number] {
  return DIR_VEC[dir];
}

/** Distance (in sub units) from v to the next centre along dir. */
export function distanceToNextCenter(v: number, dir: Dir): number {
  const target = nextCenterAhead(v, dir);
  return Math.abs(target - v);
}

/** Move `amount` sub units along dir, stopping at `limit` (exclusive). */
export function stepToward(from: number, target: number, amount: number): { value: number; reached: boolean } {
  const diff = target - from;
  if (Math.abs(diff) <= amount) return { value: target, reached: true };
  return { value: from + Math.sign(diff) * amount, reached: false };
}

/** Squared Euclidean tile distance. */
export function tileDist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}