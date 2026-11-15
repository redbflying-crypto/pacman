/**
 * Level 256 "split screen" (Dossier): the routine that draws the bonus-symbol
 * counter lets the 8-bit level counter overflow and draws 256 symbols, writing
 * past its table and scrambling the right half of the screen. The left half
 * plays normally; the right half's walls no longer apply as drawn, it holds only
 * nine dots (four of them invisible) which come back after each lost life, and
 * the level can never be cleared because 244 dots can never be eaten.
 *
 * We cannot reproduce the actual corrupted memory, so the right half here is our
 * own deterministic scramble with the same properties: an unpredictable mix of
 * open and blocked tiles, nine reachable dots of which four are hidden, and the
 * pen, the tunnel and Pac-Man's start lane kept usable.
 */
import { MAZE_COLS, MAZE_ROWS, TUNNEL_ROW } from './constants';
import { MAZE, Tile, idx, reachableFromPacman, type Layout } from './maze';
import { Rng } from './rng';

export const SPLIT_LEVEL = 256;
/** First scrambled column (the right half of the 28-column screen). */
export const SPLIT_COL = 14;
export const SPLIT_RIGHT_DOTS = 9;
export const SPLIT_HIDDEN_DOTS = 4;
const SCRAMBLE_SEED = 0x00000100;

/** Tiles of the right half we keep intact so the pen, door and tunnel still work. */
function preserved(col: number, row: number): boolean {
  if (row === 0 || row === MAZE_ROWS - 1) return true; // keep the playfield closed top and bottom
  if (col <= 17 && row >= 10 && row <= 18) return true; // right half of the pen and its lanes
  if (row === TUNNEL_ROW) return true; // the right-hand tunnel
  if (col === 14 && row === 23) return true; // Pac-Man's start lane
  return false;
}

export function buildSplitLayout(): Layout {
  const tiles = new Uint8Array(MAZE.tiles);
  const dots = new Uint8Array(MAZE.dots);
  const energizers = new Uint8Array(MAZE.energizers);
  const hiddenDots = new Uint8Array(MAZE.tiles.length);
  const rng = new Rng(SCRAMBLE_SEED);

  for (let row = 0; row < MAZE_ROWS; row++) {
    for (let col = SPLIT_COL; col < MAZE_COLS; col++) {
      const i = idx(col, row);
      dots[i] = 0;
      energizers[i] = 0;
      if (preserved(col, row)) continue;
      tiles[i] = rng.next() < 0.55 ? Tile.Empty : Tile.Wall;
    }
  }

  // Scatter the nine right-half dots over tiles Pac-Man can actually reach.
  const reachable = reachableFromPacman({ kind: 'split', tiles, dots, energizers });
  const candidates: number[] = [];
  for (let row = 1; row < MAZE_ROWS - 1; row++) {
    for (let col = SPLIT_COL; col < MAZE_COLS; col++) {
      const i = idx(col, row);
      if (reachable[i] && tiles[i] === Tile.Empty && !preserved(col, row)) candidates.push(i);
    }
  }
  for (let k = 0; k < SPLIT_RIGHT_DOTS && candidates.length > 0; k++) {
    const i = candidates.splice(rng.int(candidates.length), 1)[0];
    dots[i] = 1;
    if (k < SPLIT_HIDDEN_DOTS) hiddenDots[i] = 1;
  }
  return { kind: 'split', tiles, dots, energizers, hiddenDots };
}

export const SPLIT_LAYOUT: Layout = buildSplitLayout();

/** Restore the right-half dots (the Dossier: they come back whenever a life is lost). */
export function restoreRightHalfDots(dots: Uint8Array, layout: Layout): number {
  let restored = 0;
  for (let row = 0; row < MAZE_ROWS; row++) {
    for (let col = SPLIT_COL; col < MAZE_COLS; col++) {
      const i = idx(col, row);
      if (layout.dots[i] && !dots[i]) {
        dots[i] = 1;
        restored++;
      }
    }
  }
  return restored;
}
