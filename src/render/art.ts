/**
 * Procedural pixel art: maze walls, Pac-Man, ghosts, fruit, energizers and the
 * bitmap font. Everything is generated into PixelBuffers at startup, then
 * uploaded as nearest-filtered DataTextures.
 */
import { COLORS, DIR_VEC, LEFT, RIGHT, type Dir } from '../game/constants';
import { MAZE_COLS, MAZE_ROWS, Tile, tileAt } from '../game/maze';
import { PixelBuffer, hexToRgb, type RGB } from './pixel';

const W = 224;
const H = 248;

/* ------------------------------------------------------------------ maze art */

/** How far (in pixels) the wall line sits inside the wall mass, measured from open space. */
export const WALL_INSET = 4;

/**
 * Maze wall art (our own design, generated from the collision map):
 *  - "solid" = wall tiles plus the dead space outside the maze, so the outer
 *    frame and the side boxes get a single line along the playfield side only;
 *  - a chamfer distance field measures how deep each solid pixel lies from open
 *    space (corridors, tunnel, pen interior and door count as open; the screen
 *    edges do not);
 *  - the line is the 1-pixel boundary of the region at least WALL_INSET deep,
 *    which keeps a 14 px clear lane around every 8 px corridor and rounds every
 *    convex corner with a radius of about WALL_INSET.
 * The pen's 8 px walls are open on both sides, so their line is the 2 px core.
 */
export function buildMazePixels(): PixelBuffer {
  const buf = new PixelBuffer(W, H);
  const dist = mazeDistanceField();
  const inner = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inner[i] = dist[i] >= WALL_INSET ? 1 : 0;

  const white: RGB = [255, 255, 255];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!inner[i]) continue;
      // Off-screen neighbours count as inner, so no line is drawn along the screen edges.
      const edge =
        (x > 0 && !inner[i - 1]) ||
        (x < W - 1 && !inner[i + 1]) ||
        (y > 0 && !inner[i - W]) ||
        (y < H - 1 && !inner[i + W]);
      if (edge) buf.set(x, y, white, 255);
    }
  }

  // Ghost-house door: pale pink bar across the two door tiles, level with the pen walls.
  const door = hexToRgb(COLORS.door);
  for (let x = 13 * 8; x < 15 * 8; x++) {
    buf.set(x, 12 * 8 + 3, door, 255);
    buf.set(x, 12 * 8 + 4, door, 255);
  }
  return buf;
}

/** Chamfer (1, √2) distance of every solid pixel from the nearest open pixel; 0 for open pixels. */
export function mazeDistanceField(): Float32Array {
  const solid = new Uint8Array(W * H);
  for (let row = 0; row < MAZE_ROWS; row++) {
    for (let col = 0; col < MAZE_COLS; col++) {
      const t = tileAt(col, row);
      if (t !== Tile.Wall && t !== Tile.Void) continue;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) solid[(row * 8 + y) * W + col * 8 + x] = 1;
      }
    }
  }
  const INF = 1e6;
  const D = Math.SQRT2;
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = solid[i] ? INF : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!solid[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - W] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - W - 1] + D);
      if (x < W - 1 && y > 0) d = Math.min(d, dist[i - W + 1] + D);
      dist[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!solid[i]) continue;
      let d = dist[i];
      if (x < W - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < H - 1) d = Math.min(d, dist[i + W] + 1);
      if (x < W - 1 && y < H - 1) d = Math.min(d, dist[i + W + 1] + D);
      if (x > 0 && y < H - 1) d = Math.min(d, dist[i + W - 1] + D);
      dist[i] = d;
    }
  }
  return dist;
}

/* ------------------------------------------------------------------- sprites */

export const ATLAS_COLS = 8;
export const ATLAS_W = ATLAS_COLS * 16; // 128
export const ATLAS_H = 256;

export interface Atlas {
  pixels: PixelBuffer;
  width: number;
  height: number;
  /** frame index helpers */
  pacFrame(dir: Dir, mouth: number): number;
  /** body + eyes looking in `dir` (pupils follow the travel direction) */
  ghostFrame(color: number, frame: number, dir?: Dir): number;
  frightenedFrame(frame: number, flash: boolean): number;
  eyesFrame(dir: Dir): number;
  fruitFrame(type: number): number;
  energizerFrame(): number;
  deathFrame(stage: number): number;
  fontGlyph(ch: string): { index: number } | null;
}

const PAC_FRAMES = 16; // 4 dirs * 4 mouth frames
const GHOST_BASE = PAC_FRAMES; // 16
const GHOST_COUNT = 8; // 4 colours * 2
const FRIGHT_BASE = GHOST_BASE + GHOST_COUNT; // 24
const EYES_BASE = FRIGHT_BASE + 4; // 28
const FRUIT_BASE = EYES_BASE + 4; // 32
const FRUIT_FRAMES = 8;
const ENERGIZER_INDEX = 40;
const DEATH_FRAME_BASE = 41;
const FONT_INDEX_BASE = 48; // 16x16 cells, 16 per row -> index 48.. (row 3+)
/** Directional ghost frames: 4 colours × 4 directions × 2 foot frames = cells 96..127. */
const DIR_GHOST_BASE = 96;

const FONT: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/**
 * HUD glyphs are 7×7 in 8×8 cells (one blank column), so text sits on the 8 px
 * tile grid. Each is derived from the 5×7 design above by doubling the outer
 * columns, which gives bold 2-pixel side strokes.
 */
export const GLYPH_W = 7;
export const GLYPH_H = 7;
export const GLYPH_ADVANCE = 8;
const widen = (row: string): string => row[0] + row[0] + row.slice(1, 4) + row[4] + row[4];
const GLYPHS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(FONT).map(([ch, rows]) => [ch, rows.map(widen)]),
);

const FONT_ORDER = Object.keys(FONT);
const FONT_INDEX = new Map<string, number>();
FONT_ORDER.forEach((ch, i) => FONT_INDEX.set(ch, FONT_INDEX_BASE + i));

function circle(buf: PixelBuffer, cx: number, cy: number, r: number, color: RGB, ox = 0, oy = 0): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) buf.set(ox + x, oy + y, color, 255);
    }
  }
}

function drawPacmanMouth(buf: PixelBuffer, ox: number, oy: number, dir: Dir, half: number): void {
  const yellow = hexToRgb(COLORS.pacman);
  const facing = [0, Math.PI, -Math.PI / 2, Math.PI / 2][dir];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      if (dx * dx + dy * dy > 7.3 * 7.3) continue;
      let diff = Math.atan2(dy, dx) - facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < half) continue;
      buf.set(ox + x, oy + y, yellow, 255);
    }
  }
}

function drawPacman(buf: PixelBuffer, ox: number, oy: number, dir: Dir, mouth: number): void {
  const half = [0.02, 0.15, 0.3, 0.15][mouth] * Math.PI;
  drawPacmanMouth(buf, ox, oy, dir, half);
}

function drawGhost(
  buf: PixelBuffer,
  ox: number,
  oy: number,
  body: RGB,
  frame: number,
  mode: 'normal' | 'fright' | 'flash' | 'eyes',
  dir: Dir,
): void {
  const white = hexToRgb(COLORS.eyes);
  const pupil = hexToRgb(COLORS.pupil);
  const red = hexToRgb(COLORS.blinky);
  const [pdx, pdy] = DIR_VEC[dir];

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      let inside = false;
      if (dy <= 0.5) inside = dx * dx + dy * dy <= 7.2 * 7.2;
      else if (y <= 13) inside = Math.abs(dx) <= 7.2;
      else if (y === 14) inside = Math.abs(dx) <= 7.2 && (x + frame * 2) % 5 < 4;
      else if (y === 15) inside = Math.abs(dx) <= 7.2 && (x + frame * 2) % 5 < 2;
      if (!inside) continue;
      if (mode === 'eyes') continue;
      buf.set(ox + x, oy + y, body, 255);
    }
  }

  if (mode === 'eyes') {
    // only the eyes, with pupils looking in the travel direction
    for (const ex of [5, 10]) {
      circle(buf, ex, 6, 2.7, white, ox, oy);
      circle(buf, ex + pdx * 1.2, 6 + pdy * 1.2, 1.35, pupil, ox, oy);
    }
    return;
  }

  if (mode === 'fright' || mode === 'flash') {
    const face = mode === 'flash' ? red : white;
    // square eyes
    for (const ex of [4, 9]) {
      buf.fillRect(ox + ex, oy + 4, 3, 3, face, 255);
    }
    // wavy mouth
    for (let x = 3; x <= 12; x++) {
      const y = 11 + ((x >> 1) & 1);
      buf.set(ox + x, oy + y, face, 255);
      buf.set(ox + x, oy + y + 1, face, 255);
    }
    return;
  }

  for (const ex of [5, 10]) {
    circle(buf, ex, 6, 2.7, white, ox, oy);
    circle(buf, ex + pdx * 1.2, 6 + pdy * 1.2, 1.35, pupil, ox, oy);
  }
}

function drawFruit(buf: PixelBuffer, ox: number, oy: number, type: number): void {
  const red = hexToRgb(COLORS.blinky);
  const green = [0, 200, 60] as RGB;
  const orange = [255, 170, 40] as RGB;
  const yellow = [250, 220, 60] as RGB;
  const gray = [210, 210, 220] as RGB;
  const dark = [120, 20, 30] as RGB;

  switch (type) {
    case 0: {
      // cherries
      circle(buf, 4, 11, 3.4, red, ox, oy);
      circle(buf, 11, 11, 3.4, red, ox, oy);
      buf.fillRect(ox + 4, oy + 3, 1, 6, green, 255);
      buf.fillRect(ox + 11, oy + 3, 1, 6, green, 255);
      buf.fillRect(ox + 5, oy + 2, 6, 1, green, 255);
      break;
    }
    case 1: {
      // strawberry
      for (let y = 4; y < 14; y++) {
        const w = Math.max(1, 6 - Math.floor((y - 4) / 2));
        buf.fillRect(ox + 8 - w, oy + y, w * 2, 1, red, 255);
      }
      buf.fillRect(ox + 5, oy + 2, 6, 2, green, 255);
      buf.set(ox + 6, oy + 8, [255, 255, 255], 255);
      buf.set(ox + 9, oy + 10, [255, 255, 255], 255);
      break;
    }
    case 2: {
      // peach / orange
      circle(buf, 8, 9, 5.4, orange, ox, oy);
      buf.fillRect(ox + 8, oy + 2, 1, 3, green, 255);
      buf.fillRect(ox + 9, oy + 2, 3, 1, green, 255);
      break;
    }
    case 3: {
      // apple
      circle(buf, 8, 9, 5.4, red, ox, oy);
      buf.fillRect(ox + 8, oy + 2, 1, 4, [110, 70, 30], 255);
      buf.fillRect(ox + 9, oy + 2, 3, 1, green, 255);
      break;
    }
    case 4: {
      // melon
      circle(buf, 8, 9, 5.4, [80, 200, 90], ox, oy);
      for (let x = 4; x < 13; x += 3) buf.fillRect(ox + x, oy + 5, 1, 8, [30, 120, 50], 255);
      break;
    }
    case 5: {
      // galaxian flagship
      buf.fillRect(ox + 7, oy + 3, 2, 9, [230, 230, 255], 255);
      buf.fillRect(ox + 4, oy + 6, 8, 2, [230, 230, 255], 255);
      buf.fillRect(ox + 3, oy + 9, 10, 2, red, 255);
      buf.fillRect(ox + 2, oy + 11, 3, 2, [80, 120, 255], 255);
      buf.fillRect(ox + 11, oy + 11, 3, 2, [80, 120, 255], 255);
      break;
    }
    case 6: {
      // bell
      for (let y = 4; y < 12; y++) {
        const w = Math.min(6, 1 + (y - 4));
        buf.fillRect(ox + 8 - w, oy + y, w * 2, 1, yellow, 255);
      }
      buf.fillRect(ox + 3, oy + 12, 10, 2, yellow, 255);
      buf.fillRect(ox + 7, oy + 14, 2, 1, yellow, 255);
      break;
    }
    default: {
      // key
      circle(buf, 5, 6, 3.2, gray, ox, oy);
      circle(buf, 5, 6, 1.4, [0, 0, 0], ox, oy);
      buf.fillRect(ox + 7, oy + 6, 7, 2, gray, 255);
      buf.fillRect(ox + 11, oy + 8, 2, 2, gray, 255);
      buf.fillRect(ox + 8, oy + 8, 2, 2, gray, 255);
      break;
    }
  }
  void dark;
}

export function buildAtlas(): Atlas {
  const buf = new PixelBuffer(ATLAS_W, ATLAS_H);
  const cell = (index: number): [number, number] => [(index % ATLAS_COLS) * 16, Math.floor(index / ATLAS_COLS) * 16];

  for (let dir = 0; dir < 4; dir++) {
    for (let mouth = 0; mouth < 4; mouth++) {
      const [ox, oy] = cell(PAC_FRAMES * 0 + dir * 4 + mouth);
      drawPacman(buf, ox, oy, dir as Dir, mouth);
    }
  }

  const ghostColors = [
    hexToRgb(COLORS.blinky),
    hexToRgb(COLORS.pinky),
    hexToRgb(COLORS.inky),
    hexToRgb(COLORS.clyde),
  ];
  ghostColors.forEach((color, ci) => {
    for (let f = 0; f < 2; f++) {
      const [ox, oy] = cell(GHOST_BASE + ci * 2 + f);
      drawGhost(buf, ox, oy, color, f, 'normal', LEFT);
      for (let dir = 0; dir < 4; dir++) {
        const [dx, dy] = cell(DIR_GHOST_BASE + (ci * 4 + dir) * 2 + f);
        drawGhost(buf, dx, dy, color, f, 'normal', dir as Dir);
      }
    }
  });

  const blue = hexToRgb(COLORS.frightened);
  const white = hexToRgb(COLORS.frightenedFlash);
  for (let f = 0; f < 2; f++) {
    const [ox, oy] = cell(FRIGHT_BASE + f);
    drawGhost(buf, ox, oy, blue, f, 'fright', LEFT);
    const [wx, wy] = cell(FRIGHT_BASE + 2 + f);
    drawGhost(buf, wx, wy, white, f, 'flash', LEFT);
  }

  for (let dir = 0; dir < 4; dir++) {
    const [ox, oy] = cell(EYES_BASE + dir);
    drawGhost(buf, ox, oy, [0, 0, 0], 0, 'eyes', dir as Dir);
  }

  for (let i = 0; i < FRUIT_FRAMES; i++) {
    const [ox, oy] = cell(FRUIT_BASE + i);
    drawFruit(buf, ox, oy, i);
  }

  {
    const [ox, oy] = cell(ENERGIZER_INDEX);
    circle(buf, 8, 8, 3.6, hexToRgb(COLORS.dot), ox, oy);
  }

  // Pac-Man death: mouth opens progressively until the sprite vanishes.
  for (let i = 0; i < 4; i++) {
    const [ox, oy] = cell(DEATH_FRAME_BASE + i);
    drawPacmanMouth(buf, ox, oy, RIGHT, [0.32, 0.55, 0.8, 1.05][i] * Math.PI);
  }

  FONT_ORDER.forEach((ch, i) => {
    const [ox, oy] = cell(FONT_INDEX_BASE + i);
    const glyph = GLYPHS[ch];
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        if (glyph[y][x] === '1') buf.set(ox + 1 + x, oy + 1 + y, [255, 255, 255], 255);
      }
    }
  });

  return {
    pixels: buf,
    width: ATLAS_W,
    height: ATLAS_H,
    pacFrame: (dir, mouth) => dir * 4 + mouth,
    ghostFrame: (color, frame, dir = LEFT) => DIR_GHOST_BASE + (color * 4 + dir) * 2 + frame,
    frightenedFrame: (frame, flash) => FRIGHT_BASE + (flash ? 2 : 0) + frame,
    eyesFrame: (dir) => EYES_BASE + dir,
    fruitFrame: (type) => FRUIT_BASE + type,
    energizerFrame: () => ENERGIZER_INDEX,
    deathFrame: (stage) => DEATH_FRAME_BASE + Math.max(0, Math.min(3, stage)),
    fontGlyph: (ch) => {
      const idx = FONT_INDEX.get(ch.toUpperCase());
      return idx === undefined ? null : { index: idx };
    },
  };
}

/* --------------------------------------------------------------------- font */

/** 'hud' = the 7×7-in-8 game font; 'debug' = the compact 5×7 design with a 6 px advance. */
export type FontKind = 'hud' | 'debug';

export function drawText(
  buf: PixelBuffer,
  text: string,
  x: number,
  y: number,
  color: RGB,
  scale = 1,
  font: FontKind = 'hud',
): void {
  const table = font === 'hud' ? GLYPHS : FONT;
  const w = font === 'hud' ? GLYPH_W : 5;
  let cx = x;
  for (const raw of text) {
    const ch = raw.toUpperCase();
    const glyph = table[ch] ?? table[' '];
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < w; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            buf.set(cx + gx * scale + sx, y + gy * scale + sy, color, 255);
          }
        }
      }
    }
    cx += advanceOf(font) * scale;
  }
}

const advanceOf = (font: FontKind): number => (font === 'hud' ? GLYPH_ADVANCE : 6);

export function textWidth(text: string, scale = 1, font: FontKind = 'hud'): number {
  return text.length * advanceOf(font) * scale;
}

/** Copy a 16x16 atlas cell into another buffer (used for HUD fruit/life icons). */
export function blitAtlasSprite(buf: PixelBuffer, atlas: Atlas, index: number, x: number, y: number): void {
  const ox = (index % ATLAS_COLS) * 16;
  const oy = Math.floor(index / ATLAS_COLS) * 16;
  for (let yy = 0; yy < 16; yy++) {
    for (let xx = 0; xx < 16; xx++) {
      const i = ((oy + yy) * atlas.width + (ox + xx)) * 4;
      const a = atlas.pixels.data[i + 3];
      if (!a) continue;
      buf.blend(x + xx, y + yy, [atlas.pixels.data[i], atlas.pixels.data[i + 1], atlas.pixels.data[i + 2]], a);
    }
  }
}

/** Small Pac-Man life icon (12x12) drawn procedurally. */
export function drawLifeIcon(buf: PixelBuffer, x: number, y: number): void {
  const yellow = hexToRgb(COLORS.pacman);
  for (let yy = 0; yy < 12; yy++) {
    for (let xx = 0; xx < 12; xx++) {
      const dx = xx - 5.5;
      const dy = yy - 5.5;
      if (dx * dx + dy * dy > 5.4 * 5.4) continue;
      if (Math.abs(Math.atan2(dy, dx)) < 0.28 * Math.PI) continue;
      buf.set(x + xx, y + yy, yellow, 255);
    }
  }
}

/* ------------------------------------------------------------------ dot map */

export function buildDotPixels(
  dots: Uint8Array,
  energizers: Uint8Array,
  target?: PixelBuffer,
  hidden?: Uint8Array,
): PixelBuffer {
  const buf = target ?? new PixelBuffer(W, H);
  buf.clear();
  const dot = hexToRgb(COLORS.dot);
  for (let row = 0; row < MAZE_ROWS; row++) {
    for (let col = 0; col < MAZE_COLS; col++) {
      const i = row * MAZE_COLS + col;
      if (!dots[i] && !energizers[i]) continue;
      if (hidden && hidden[i]) continue; // level 256: present and edible, but not drawn
      const cx = col * 8 + 4;
      const cy = row * 8 + 4;
      if (energizers[i]) {
        circle(buf, cx, cy, 3.6, dot);
      } else {
        buf.fillRect(cx - 1, cy - 1, 2, 2, dot, 255);
      }
    }
  }
  return buf;
}

export const MAZE_PIXELS = { width: W, height: H };

/** Palette the level-256 scramble picks its colours from. */
const SCRAMBLE_COLORS: readonly number[] = [
  COLORS.blue, COLORS.blinky, COLORS.pinky, COLORS.inky, COLORS.clyde, COLORS.pacman, COLORS.dot, COLORS.text,
];
const SCRAMBLE_CHARS = Object.keys(FONT).filter((c) => c !== ' ');

/**
 * Draw one 8×8 cell of level-256 scramble: a random glyph of our font in a
 * random palette colour, or nothing. Our own pattern, seeded per cell.
 */
export function drawScrambleCell(buf: PixelBuffer, x: number, y: number, seed: number): void {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  if (h % 10 < 2) return;
  const ch = SCRAMBLE_CHARS[(h >>> 4) % SCRAMBLE_CHARS.length];
  const color = hexToRgb(SCRAMBLE_COLORS[(h >>> 12) % SCRAMBLE_COLORS.length]);
  drawText(buf, ch, x, y, color);
}

/**
 * Level 256 maze art, in explicit colours (the renderer draws it untinted):
 * the left half is the normal blue maze, the right half is scramble.
 */
export function buildSplitMazePixels(splitCol: number): PixelBuffer {
  const normal = buildMazePixels();
  const buf = new PixelBuffer(W, H);
  const blue = hexToRgb(COLORS.blue);
  const splitX = splitCol * 8;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < splitX; x++) {
      const i = (y * W + x) * 4;
      if (!normal.data[i + 3]) continue;
      const isWhite = normal.data[i] === 255 && normal.data[i + 1] === 255 && normal.data[i + 2] === 255;
      buf.set(x, y, isWhite ? blue : [normal.data[i], normal.data[i + 1], normal.data[i + 2]], 255);
    }
  }
  for (let row = 0; row < MAZE_ROWS; row++) {
    for (let col = splitCol; col < MAZE_COLS; col++) drawScrambleCell(buf, col * 8, row * 8, row * 64 + col);
  }
  return buf;
}