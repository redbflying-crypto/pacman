/**
 * Ghost targeting and route choice. This is the documented Pac-Man AI:
 * one-tile-ahead decisions, squared Euclidean distance to a target tile,
 * up/left/down/right tie-break, the Pinky/Inky upward overflow quirks, the
 * four no-up-turn tiles and the Clyde eight-tile threshold.
 */
import { DOWN, LEFT, RIGHT, UP, type Dir } from './constants';
import { ghostWalkable, isNoUpTile, tileAt, Tile, type Layout } from './maze';
import { tileDist2, tileOfSubX, tileOfSubY } from './movement';
import type { GhostId, GhostState } from './types';

export interface TileRef {
  col: number;
  row: number;
}

/** Documented fixed scatter targets (may lie outside the maze; never clamped). */
export const SCATTER_TARGETS: Record<GhostId, TileRef> = {
  blinky: { col: 25, row: -3 },
  pinky: { col: 2, row: -3 },
  inky: { col: 27, row: 32 },
  clyde: { col: 0, row: 32 },
};

/** Eyes return to the tile above the left half of the ghost-house door. */
export const EYES_TILE: TileRef = { col: 13, row: 11 };

export interface ChaseInput {
  pacCol: number;
  pacRow: number;
  pacDir: Dir;
  blinky: TileRef;
  elroy: boolean;
}

/** Pinky's up quirk: four up AND four left (overflow bug preserved). */
export function pinkyTarget(pacCol: number, pacRow: number, pacDir: Dir): TileRef {
  switch (pacDir) {
    case UP:
      return { col: pacCol - 4, row: pacRow - 4 };
    case LEFT:
      return { col: pacCol - 4, row: pacRow };
    case DOWN:
      return { col: pacCol, row: pacRow + 4 };
    case RIGHT:
      return { col: pacCol + 4, row: pacRow };
  }
}

/** Inky: A = pac + 2 ahead (up quirk: 2 up AND 2 left), target = 2A - B. */
export function inkyTarget(pacCol: number, pacRow: number, pacDir: Dir, blinky: TileRef): TileRef {
  let ax: number;
  let ay: number;
  switch (pacDir) {
    case UP:
      ax = pacCol - 2;
      ay = pacRow - 2;
      break;
    case LEFT:
      ax = pacCol - 2;
      ay = pacRow;
      break;
    case DOWN:
      ax = pacCol;
      ay = pacRow + 2;
      break;
    case RIGHT:
      ax = pacCol + 2;
      ay = pacRow;
      break;
  }
  return { col: 2 * ax - blinky.col, row: 2 * ay - blinky.row };
}

/** Clyde: Pac-Man when squared distance >= 64, otherwise his scatter corner. */
export function clydeTarget(ghost: TileRef, pac: TileRef, scatter: TileRef): TileRef {
  return tileDist2(ghost.col, ghost.row, pac.col, pac.row) >= 64 ? pac : scatter;
}

export function chaseTarget(id: GhostId, g: TileRef, input: ChaseInput): TileRef {
  const pac = { col: input.pacCol, row: input.pacRow };
  switch (id) {
    case 'blinky':
      return pac;
    case 'pinky':
      return pinkyTarget(pac.col, pac.row, input.pacDir);
    case 'inky':
      return inkyTarget(pac.col, pac.row, input.pacDir, input.blinky);
    case 'clyde':
      return clydeTarget(g, pac, SCATTER_TARGETS.clyde);
  }
}

export interface ChooseOptions {
  /** ghost's current tile */
  col: number;
  row: number;
  dir: Dir;
  target: TileRef;
  allowDoor: boolean;
  allowHouse: boolean;
  /** scatter/chase restriction (not applied while frightened or as eyes) */
  applyNoUp: boolean;
  frightened: boolean;
  rng: () => number;
  /** playfield to navigate (defaults to the standard maze) */
  layout?: Layout;
}

const TURN_ORDER: readonly Dir[] = [UP, LEFT, DOWN, RIGHT];
const CLOCKWISE: readonly Dir[] = [UP, RIGHT, DOWN, LEFT];

/**
 * Choose the direction to take when the ghost is centred on (col,row).
 * Returns NONE-equivalent -1 when the ghost is boxed in (caller reverses).
 */
export function chooseDirection(opts: ChooseOptions): Dir | -1 {
  const { col, row, dir, target, allowDoor, allowHouse, applyNoUp, frightened, rng, layout } = opts;
  const back = (dir + 2) % 4;
  const legal: Dir[] = [];
  for (const d of TURN_ORDER) {
    if (d === back) continue;
    const [dx, dy] = d === UP ? [0, -1] : d === LEFT ? [-1, 0] : d === DOWN ? [0, 1] : [1, 0];
    const nc = col + dx;
    const nr = row + dy;
    if (!ghostWalkable(nc, nr, allowDoor, allowHouse, layout)) continue;
    if (applyNoUp && !frightened && d === UP && isNoUpTile(col, row)) continue;
    legal.push(d);
  }
  if (legal.length === 0) return -1;

  if (frightened) {
    // Pseudo-random first try, then clockwise until legal.
    const start = Math.floor(rng() * 4) % 4;
    for (let i = 0; i < 4; i++) {
      const d = CLOCKWISE[(start + i) % 4];
      if (legal.includes(d)) return d;
    }
    return legal[0];
  }

  let best: Dir = legal[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const d of legal) {
    const [dx, dy] = d === UP ? [0, -1] : d === LEFT ? [-1, 0] : d === DOWN ? [0, 1] : [1, 0];
    const score = tileDist2(col + dx, row + dy, target.col, target.row);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** True when the ghost's centre is inside the house footprint (cols 10..17, rows 12..16). */
export function insideHouse(col: number, row: number): boolean {
  return col >= 10 && col <= 17 && row >= 12 && row <= 16;
}

export function ghostTile(g: { x: number; y: number }): TileRef {
  return { col: tileOfSubX(g.x), row: tileOfSubY(g.y) };
}

export function tileOfGhost(g: GhostState): TileRef {
  return { col: tileOfSubX(g.x), row: tileOfSubY(g.y) };
}

export function isDoorOrHouse(col: number, row: number): boolean {
  const t = tileAt(col, row);
  return t === Tile.Door || t === Tile.House;
}