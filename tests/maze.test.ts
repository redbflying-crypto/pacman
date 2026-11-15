import { describe, expect, it } from 'vitest';
import {
  MAZE,
  MAZE_ASCII,
  MAZE_COLS,
  MAZE_ROWS,
  Tile,
  idx,
  pacWalkable,
  reachableFromPacman,
  tileAt,
  validateMaze,
} from '../src/game/maze';
import { MAZE_H, MAZE_OFFSET_Y, MAZE_W, SCREEN_H, SCREEN_W, TILE } from '../src/game/constants';
import { tileCenterSub, tileOfSubX, tileOfSubY } from '../src/game/movement';

describe('maze data', () => {
  it('has the documented dimensions', () => {
    expect(MAZE_ASCII).toHaveLength(MAZE_ROWS);
    for (const row of MAZE_ASCII) expect(row).toHaveLength(MAZE_COLS);
    expect(MAZE_COLS).toBe(28);
    expect(MAZE_ROWS).toBe(31);
    expect(MAZE_W).toBe(224);
    expect(MAZE_H).toBe(248);
  });

  it('contains exactly 240 dots and 4 energizers', () => {
    const v = validateMaze();
    expect(v.dots).toBe(240);
    expect(v.energizers).toBe(4);
    expect(v.dots + v.energizers).toBe(244);
  });

  it('has every consumable reachable by Pac-Man', () => {
    const v = validateMaze();
    expect(v.unreachable).toEqual([]);
  });

  it('places the energizers on rows 3 and 23', () => {
    const rows = MAZE.energizerTiles.map((i) => Math.floor(i / MAZE_COLS));
    expect(rows.sort((a, b) => a - b)).toEqual([3, 3, 23, 23]);
  });

  it('keeps Pac-Man out of the ghost house and door', () => {
    for (let row = 12; row <= 16; row++) {
      for (let col = 10; col <= 17; col++) {
        const t = tileAt(col, row);
        if (t === Tile.Door || t === Tile.House) expect(pacWalkable(col, row)).toBe(false);
      }
    }
  });

  it('has a tunnel row that is walkable at both edges', () => {
    expect(pacWalkable(0, 14)).toBe(true);
    expect(pacWalkable(27, 14)).toBe(true);
    expect(tileAt(0, 14)).toBe(Tile.Tunnel);
    expect(tileAt(27, 14)).toBe(Tile.Tunnel);
  });

  it('connects every corridor tile (no isolated pockets)', () => {
    const seen = reachableFromPacman();
    let reachable = 0;
    for (let i = 0; i < seen.length; i++) if (seen[i]) reachable++;
    const walkable = MAZE.tiles.reduce(
      (n, _t, i) => n + (pacWalkable(i % MAZE_COLS, Math.floor(i / MAZE_COLS)) ? 1 : 0),
      0,
    );
    expect(reachable).toBe(walkable);
  });

  it('converts between tiles and sub-pixels', () => {
    const c = tileCenterSub(13, 23);
    expect(c.x).toBe(108 * 16);
    expect(c.y).toBe(188 * 16);
    expect(tileOfSubX(c.x)).toBe(13);
    expect(tileOfSubY(c.y)).toBe(23);
    expect(idx(3, 4)).toBe(4 * 28 + 3);
  });

  it('documents the screen vs maze offsets', () => {
    expect(MAZE_OFFSET_Y).toBe(24);
    expect(SCREEN_W).toBe(224);
    expect(SCREEN_H).toBe(288);
    expect(TILE).toBe(8);
    expect(MAZE_OFFSET_Y + MAZE_H).toBe(272);
  });
});