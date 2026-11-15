import { describe, expect, it } from 'vitest';
import { MAZE_COLS, MAZE_ROWS, Tile, tileAt } from '../src/game/maze';
import { WALL_INSET, buildMazePixels, drawText, textWidth } from '../src/render/art';
import { PixelBuffer } from '../src/render/pixel';

const W = MAZE_COLS * 8;
const H = MAZE_ROWS * 8;
const maze = buildMazePixels();
const lit = (x: number, y: number): boolean => maze.data[(y * W + x) * 4 + 3] > 0;
const tileOfPx = (x: number, y: number): number => tileAt(Math.floor(x / 8), Math.floor(y / 8));
const isDoorRow = (x: number, y: number): boolean => tileOfPx(x, y) === Tile.Door;
const isOpen = (t: number): boolean => t !== Tile.Wall && t !== Tile.Void;

describe('maze wall art', () => {
  it('draws wall lines only inside wall tiles (the door bar aside)', () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!lit(x, y) || isDoorRow(x, y)) continue;
        expect(tileOfPx(x, y), `pixel ${x},${y}`).toBe(Tile.Wall);
      }
    }
  });

  it('keeps every wall line clear of the lanes by the inset', () => {
    const R = WALL_INSET;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!lit(x, y) || isDoorRow(x, y)) continue;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (!isOpen(tileOfPx(nx, ny))) continue;
            expect(Math.hypot(dx, dy), `line ${x},${y} near open ${nx},${ny}`).toBeGreaterThanOrEqual(3.5);
          }
        }
      }
    }
  });

  it('outlines every wall tile that faces a corridor', () => {
    for (let row = 0; row < MAZE_ROWS; row++) {
      for (let col = 0; col < MAZE_COLS; col++) {
        if (tileAt(col, row) !== Tile.Wall) continue;
        const facesLane = [
          [0, -1],
          [-1, 0],
          [0, 1],
          [1, 0],
        ].some(([dx, dy]) => {
          const t = tileAt(col + dx, row + dy);
          return t === Tile.Dot || t === Tile.Energizer || t === Tile.Empty || t === Tile.Tunnel;
        });
        if (!facesLane) continue;
        let any = false;
        for (let y = 0; y < 8 && !any; y++) for (let x = 0; x < 8 && !any; x++) any = lit(col * 8 + x, row * 8 + y);
        expect(any, `wall tile ${col},${row}`).toBe(true);
      }
    }
  });

  it('leaves a 14 px clear lane around an 8 px corridor', () => {
    // Column x=40 crosses the row-5 corridor between the walls on rows 4 and 6.
    let up = 44;
    while (!lit(40, up)) up--;
    let down = 44;
    while (!lit(40, down)) down++;
    expect([up, down]).toEqual([36, 51]);
    expect(down - up - 1).toBe(14);
  });

  it('never runs a line along the screen edges (horizontal walls may cross them)', () => {
    const crossings: number[] = [];
    for (let y = 0; y < H; y++) {
      for (const x of [0, W - 1]) {
        if (!lit(x, y)) continue;
        expect(lit(x, y + 1), `vertical run at ${x},${y}`).toBe(false);
        expect(lit(x === 0 ? 1 : W - 2, y), `isolated pixel at ${x},${y}`).toBe(true);
        if (x === 0) crossings.push(y);
      }
    }
    // Only the two tunnel walls (rows 13 and 15) run off-screen; the others turn into the frame.
    expect(crossings).toEqual([108, 123]);
    for (let x = 0; x < W; x++) {
      expect(lit(x, 0)).toBe(false);
      expect(lit(x, H - 1)).toBe(false);
    }
  });
});

describe('HUD font', () => {
  it('uses 8 px cells, so text sits on the arcade tile grid', () => {
    expect(textWidth('HIGH SCORE')).toBe(80);
    const buf = new PixelBuffer(16, 8);
    drawText(buf, 'M', 0, 0, [255, 255, 255]);
    const row = (y: number) =>
      Array.from({ length: 8 }, (_, x) => (buf.data[(y * 16 + x) * 4 + 3] ? '1' : '0')).join('');
    // 7-pixel glyph with doubled outer strokes, one blank column of spacing.
    expect(row(0)).toBe('11000110');
    expect(row(1)).toBe('11101110');
  });
});
