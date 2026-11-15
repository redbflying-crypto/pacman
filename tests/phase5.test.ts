import { describe, expect, it } from 'vitest';
import { LEVEL_FLASH_TICKS, MAZE_COLS, TOTAL_CONSUMABLES, type Dir } from '../src/game/constants';
import { CUTSCENES, intermissionAfter } from '../src/game/cutscenes';
import { autopilot } from '../src/game/autopilot';
import { MAZE, idx, pacWalkable, reachableFromPacman } from '../src/game/maze';
import { Simulation, clampLevel } from '../src/game/sim';
import { SPLIT_COL, SPLIT_HIDDEN_DOTS, SPLIT_LAYOUT, SPLIT_RIGHT_DOTS } from '../src/game/splitScreen';
import { tileOfSubX, tileOfSubY } from '../src/game/movement';
import { buildAtlas } from '../src/render/art';

/** Finish `level` instantly: eat the last consumable and let the flash run out. */
function clearLevel(level: number): Simulation {
  const sim = new Simulation({ seed: 1, level });
  sim.startNewGame();
  sim.phase = 'playing';
  sim.dotsEaten = TOTAL_CONSUMABLES;
  sim.step(); // detects the clear
  expect(sim.phase).toBe('levelclear');
  sim.stepTicks(LEVEL_FLASH_TICKS);
  return sim;
}

const count = (a: Uint8Array, from = 0, to = MAZE_COLS): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && i % MAZE_COLS >= from && i % MAZE_COLS < to) n++;
  return n;
};

describe('intermissions', () => {
  it('play after levels 2, 5, 9, 13 and 17 (the third scene repeating)', () => {
    const schedule = Array.from({ length: 21 }, (_, i) => intermissionAfter(i + 1));
    expect(schedule.map((s, i) => (s >= 0 ? `${i + 1}:${s}` : '')).filter(Boolean)).toEqual([
      '2:0',
      '5:1',
      '9:2',
      '13:2',
      '17:2',
    ]);
  });

  it('runs the cutscene between the level flash and the next READY', () => {
    const sim = clearLevel(2);
    expect(sim.phase).toBe('intermission');
    expect(sim.intermission).toBe(0);
    sim.stepTicks(CUTSCENES[0].duration - 1);
    expect(sim.phase).toBe('intermission');
    sim.step();
    expect(sim.phase).toBe('ready');
    expect(sim.level).toBe(3);
  });

  it('goes straight to the next level when no intermission is scheduled', () => {
    const sim = clearLevel(3);
    expect(sim.phase).toBe('ready');
    expect(sim.level).toBe(4);
  });

  it('keeps every cutscene actor near the screen and moving sensibly', () => {
    for (const scene of CUTSCENES) {
      expect(scene.duration).toBeGreaterThan(200);
      for (let t = 0; t <= scene.duration; t++) {
        for (const a of scene.frame(t)) {
          expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
          expect(a.x).toBeGreaterThan(-120);
          expect(a.x).toBeLessThan(360);
        }
      }
      // Something is on screen for a good part of the scene.
      const visible = Array.from({ length: scene.duration }, (_, t) =>
        scene.frame(t).some((a) => a.x > 8 && a.x < 216),
      ).filter(Boolean).length;
      expect(visible).toBeGreaterThan(scene.duration / 2);
    }
  });

  it('ends the tag scene with Pac-Man and Blinky passing through each other', () => {
    const tag = CUTSCENES[2];
    let crossed = false;
    for (let t = 280; t < tag.duration; t++) {
      const [blinky, pac] = tag.frame(t);
      if (Math.abs(blinky.x - pac.x) < 2) crossed = true;
    }
    expect(crossed).toBe(true);
  });
});

describe('level 256 split screen', () => {
  it('caps levels at 256 and uses the split layout there', () => {
    expect(clampLevel(300)).toBe(256);
    expect(clampLevel(0)).toBe(1);
    const sim = new Simulation({ level: 256 });
    sim.startNewGame();
    expect(sim.level).toBe(256);
    expect(sim.layout.kind).toBe('split');
    expect(new Simulation({ level: 255 }).layout.kind).toBe('standard');
  });

  it('keeps the left half intact and leaves nine right-half dots, four hidden, all reachable', () => {
    expect(count(SPLIT_LAYOUT.dots, 0, SPLIT_COL)).toBe(count(MAZE.dots, 0, SPLIT_COL));
    expect(count(SPLIT_LAYOUT.energizers, SPLIT_COL)).toBe(0);
    expect(count(SPLIT_LAYOUT.dots, SPLIT_COL)).toBe(SPLIT_RIGHT_DOTS);
    expect(count(SPLIT_LAYOUT.hiddenDots!)).toBe(SPLIT_HIDDEN_DOTS);
    const reach = reachableFromPacman(SPLIT_LAYOUT);
    for (let i = 0; i < SPLIT_LAYOUT.dots.length; i++) if (SPLIT_LAYOUT.dots[i]) expect(reach[i]).toBe(1);
    // The right half really is scrambled.
    let changed = 0;
    for (let i = 0; i < MAZE.tiles.length; i++) if (SPLIT_LAYOUT.tiles[i] !== MAZE.tiles[i]) changed++;
    expect(changed).toBeGreaterThan(80);
  });

  it('can never be cleared, even eating everything on every life', () => {
    const sim = new Simulation({ seed: 1, level: 256 });
    sim.startNewGame();
    sim.phase = 'playing';
    const eatAll = () => {
      for (let i = 0; i < sim.dots.length; i++) {
        if (sim.dots[i] || sim.energizers[i]) {
          sim.dots[i] = sim.energizers[i] = 0;
          sim.dotsEaten++;
        }
      }
    };
    for (let life = 0; life < 6; life++) {
      eatAll();
      (sim as unknown as { finishDeath(): void }).finishDeath();
      sim.lives = 3; // keep going
      // the right-half dots came back
      expect(count(sim.dots, SPLIT_COL)).toBe(SPLIT_RIGHT_DOTS);
    }
    eatAll();
    expect(sim.dotsEaten).toBeLessThan(TOTAL_CONSUMABLES);
    sim.phase = 'playing';
    sim.step();
    expect(sim.phase).not.toBe('levelclear');
  });

  it('plays level 256 under the autopilot with everyone on walkable ground', () => {
    const sim = new Simulation({ seed: 4, level: 256 });
    sim.startNewGame();
    for (let t = 0; t < 3000 && sim.phase !== 'gameover'; t++) {
      sim.setDirection(autopilot(sim));
      sim.step();
      expect(pacWalkable(tileOfSubX(sim.pac.x), tileOfSubY(sim.pac.y), sim.layout)).toBe(true);
    }
    expect(sim.dotsEaten).toBeGreaterThan(30);
  });
});

describe('attract-mode autopilot', () => {
  function demo(): { ticks: number; eaten: number; trace: number[] } {
    const sim = new Simulation({ seed: 0xde300 });
    sim.startNewGame();
    const trace: number[] = [];
    let t = 0;
    for (; t < 1820 && sim.phase !== 'dying'; t++) {
      const d: Dir = autopilot(sim);
      trace.push(d);
      sim.setDirection(d);
      sim.step();
    }
    return { ticks: t, eaten: sim.dotsEaten, trace };
  }

  it('plays a convincing 30-second demo', () => {
    const r = demo();
    expect(r.ticks).toBe(1820); // still alive at the 30 s demo limit
    expect(r.eaten).toBeGreaterThan(100);
  });

  it('is deterministic, so the demo is the same every time', () => {
    expect(demo().trace).toEqual(demo().trace);
  });
});

describe('ghost sprites', () => {
  it('have pupils that follow the travel direction', () => {
    const atlas = buildAtlas();
    for (let ci = 0; ci < 4; ci++) {
      const frames = [0, 1, 2, 3].map((d) => atlas.ghostFrame(ci, 0, d as Dir));
      expect(new Set(frames).size).toBe(4);
      for (const f of frames) expect(f).toBeLessThan((atlas.width / 16) * (atlas.height / 16));
      // the cells really differ (pupils move)
      const cell = (index: number) => {
        const cols = atlas.width / 16;
        const ox = (index % cols) * 16;
        const oy = Math.floor(index / cols) * 16;
        const out: number[] = [];
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const p = ((oy + y) * atlas.width + ox + x) * 4;
            out.push(atlas.pixels.data[p], atlas.pixels.data[p + 1], atlas.pixels.data[p + 2]);
          }
        }
        return out.join(',');
      };
      expect(new Set(frames.map(cell)).size).toBe(4);
    }
    expect(idx(0, 0)).toBe(0);
  });
});
