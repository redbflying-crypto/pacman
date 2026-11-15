/**
 * Static maze data and coordinate conversion.
 *
 * The layout below is the original 28x31 Pac-Man maze (the one described in
 * The Pac-Man Dossier). Legend:
 *   #  wall
 *   .  corridor with an ordinary dot
 *   o  corridor with an energizer
 *   ' ' corridor with nothing
 *   =  ghost-house door (ghosts only)
 *   _  ghost-house interior (ghosts only)
 *   -  tunnel mouth (walkable; wraps at the screen edge)
 *   ~  dead space outside the maze (not walkable, not drawn)
 *
 * Verified: exactly 240 dots and 4 energizers, all consumables reachable by Pac-Man.
 */
import { MAZE_COLS, MAZE_ROWS, NO_UP_TILES, TUNNEL_ROW } from './constants';

export { MAZE_COLS, MAZE_ROWS };

export const MAZE_ASCII: readonly string[] = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '~~~~~#.##### ## #####.#~~~~~',
  '~~~~~#.##          ##.#~~~~~',
  '~~~~~#.## ###==### ##.#~~~~~',
  '######.## #______# ##.######',
  '-     .   #______#   .     -',
  '######.## #______# ##.######',
  '~~~~~#.## ######## ##.#~~~~~',
  '~~~~~#.##          ##.#~~~~~',
  '~~~~~#.## ######## ##.#~~~~~',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

export const Tile = {
  Wall: 0,
  Dot: 1,
  Energizer: 2,
  Empty: 3,
  Door: 4,
  House: 5,
  Tunnel: 6,
  Void: 7,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

const TILE_GLYPHS: Record<string, Tile> = {
  '#': Tile.Wall,
  '.': Tile.Dot,
  o: Tile.Energizer,
  ' ': Tile.Empty,
  '=': Tile.Door,
  _: Tile.House,
  '-': Tile.Tunnel,
  '~': Tile.Void,
};

/**
 * A playfield the simulation runs on: navigation tiles plus the initial
 * consumables. The standard maze is MAZE; level 256 uses a split-screen layout.
 */
export interface Layout {
  readonly kind: 'standard' | 'split';
  /** row-major, MAZE_COLS*MAZE_ROWS */
  readonly tiles: Uint8Array;
  readonly dots: Uint8Array;
  readonly energizers: Uint8Array;
  /** dots that exist (and can be eaten) but are not drawn */
  readonly hiddenDots?: Uint8Array;
}

export interface MazeData extends Layout {
  /** row-major, MAZE_COLS*MAZE_ROWS */
  tiles: Uint8Array;
  /** initial dot mask (1 = dot) */
  dots: Uint8Array;
  /** initial energizer mask (1 = energizer) */
  energizers: Uint8Array;
  dotTiles: ReadonlyArray<number>;
  energizerTiles: ReadonlyArray<number>;
}

export const idx = (col: number, row: number): number => row * MAZE_COLS + col;
export const colOfIndex = (i: number): number => i % MAZE_COLS;
export const rowOfIndex = (i: number): number => (i / MAZE_COLS) | 0;

function build(): MazeData {
  const tiles = new Uint8Array(MAZE_COLS * MAZE_ROWS);
  const dots = new Uint8Array(MAZE_COLS * MAZE_ROWS);
  const energizers = new Uint8Array(MAZE_COLS * MAZE_ROWS);
  const dotTiles: number[] = [];
  const energizerTiles: number[] = [];
  for (let row = 0; row < MAZE_ROWS; row++) {
    const line = MAZE_ASCII[row];
    if (line.length !== MAZE_COLS) {
      throw new Error(`maze row ${row} has ${line.length} columns, expected ${MAZE_COLS}`);
    }
    for (let col = 0; col < MAZE_COLS; col++) {
      const t = TILE_GLYPHS[line[col]];
      if (t === undefined) throw new Error(`bad maze glyph "${line[col]}" at ${col},${row}`);
      const i = idx(col, row);
      tiles[i] = t;
      if (t === Tile.Dot) {
        dots[i] = 1;
        dotTiles.push(i);
      } else if (t === Tile.Energizer) {
        energizers[i] = 1;
        energizerTiles.push(i);
      }
    }
  }
  return { kind: 'standard', tiles, dots, energizers, dotTiles, energizerTiles };
}

export const MAZE: MazeData = build();

export function tileAt(col: number, row: number, layout: Layout = MAZE): Tile {
  // The tunnel continues past both screen edges (actors wrap at x < 0 / x >= 224),
  // so the two tiles beyond each mouth are walkable tunnel, not dead space.
  if (row === TUNNEL_ROW && col >= -2 && col < MAZE_COLS + 2 && (col < 0 || col >= MAZE_COLS)) {
    return Tile.Tunnel;
  }
  if (col < 0 || col >= MAZE_COLS || row < 0 || row >= MAZE_ROWS) return Tile.Void;
  return layout.tiles[idx(col, row)] as Tile;
}

/** Pac-Man may not enter the house, its door, walls or dead space. */
export function pacWalkable(col: number, row: number, layout: Layout = MAZE): boolean {
  const t = tileAt(col, row, layout);
  return t === Tile.Dot || t === Tile.Energizer || t === Tile.Empty || t === Tile.Tunnel;
}

/** Ghosts may use corridors and the tunnel; door/house only under their state rules. */
export function ghostWalkable(
  col: number,
  row: number,
  allowDoor: boolean,
  allowHouse: boolean,
  layout: Layout = MAZE,
): boolean {
  const t = tileAt(col, row, layout);
  if (t === Tile.Dot || t === Tile.Energizer || t === Tile.Empty || t === Tile.Tunnel) return true;
  if (allowDoor && t === Tile.Door) return true;
  if (allowHouse && t === Tile.House) return true;
  return false;
}

export function isTunnelTile(col: number, row: number): boolean {
  return row === 14 && (col <= 5 || col >= 22);
}

export function isNoUpTile(col: number, row: number): boolean {
  for (const [c, r] of NO_UP_TILES) if (c === col && r === row) return true;
  return false;
}

/** Flood fill of Pac-Man-reachable tiles from the Pac-Man start tile. */
export function reachableFromPacman(layout: Layout = MAZE): Uint8Array {
  const seen = new Uint8Array(MAZE_COLS * MAZE_ROWS);
  const startCol = Math.floor(112 / 8);
  const startRow = Math.floor(188 / 8);
  const start = idx(startCol, startRow);
  const queue: number[] = [start];
  seen[start] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const col = colOfIndex(i);
    const row = rowOfIndex(i);
    const neighbours = [
      [col, row - 1],
      [col - 1, row],
      [col, row + 1],
      [col + 1, row],
    ];
    for (const [c, r] of neighbours) {
      if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS) continue;
      const ni = idx(c, r);
      if (seen[ni]) continue;
      if (!pacWalkable(c, r, layout)) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

export function validateMaze(): { dots: number; energizers: number; unreachable: number[] } {
  const seen = reachableFromPacman();
  const unreachable: number[] = [];
  for (const i of MAZE.dotTiles) if (!seen[i]) unreachable.push(i);
  for (const i of MAZE.energizerTiles) if (!seen[i]) unreachable.push(i);
  return { dots: MAZE.dotTiles.length, energizers: MAZE.energizerTiles.length, unreachable };
}

/** Tile <-> maze-local pixel helpers (positions are kept in sub units elsewhere). */
export const tileCenterX = (col: number): number => col * 8 + 4;
export const tileCenterY = (row: number): number => row * 8 + 4;
export const colOf = (xPx: number): number => Math.floor(xPx / 8);
export const rowOf = (yPx: number): number => Math.floor(yPx / 8);