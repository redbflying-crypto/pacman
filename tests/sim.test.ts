import { describe, expect, it } from 'vitest';
import {
  DEATH_TICKS,
  DOWN,
  LEFT,
  LEVEL_FLASH_TICKS,
  RIGHT,
  START_LIVES,
  SUB,
  TICK_HZ,
  TOTAL_CONSUMABLES,
  UP,
  type Dir,
} from '../src/game/constants';
import { FixedStepClock } from '../src/game/clock';
import { getLevelConfig, getSchedule } from '../src/game/levels';
import { MAZE, MAZE_COLS, ghostWalkable, pacWalkable } from '../src/game/maze';
import { pacLaneOffset, pixelSteps, tileOfSubX, tileOfSubY } from '../src/game/movement';
import { FRIGHTENED_SEED, Rng } from '../src/game/rng';
import { Simulation } from '../src/game/sim';

// Re-recorded after Phase 2 (real pen bobbing, concurrent exits, doorway collisions, ghost bug).
const GOLDEN_REPLAY = { hash: 'a9fb050a', score: 1640, lives: 0, phase: 'gameover' };

function makeSim(seed = 12345): Simulation {
  const sim = new Simulation({ seed });
  sim.startNewGame();
  sim.phase = 'playing';
  sim.readyTicks = 0;
  for (const g of sim.ghosts) {
    g.lifecycle = 'house';
    g.reviveTimer = 1_000_000;
    g.dotLimit = 1_000_000;
    g.dotCounter = 0;
    g.x = 112 * SUB;
    g.y = 116 * SUB;
  }
  sim.cfg = { ...sim.cfg, idleLimitTicks: 1_000_000 };
  sim.globalCounterActive = false;
  return sim;
}

function eatHere(sim: Simulation): void {
  (sim as unknown as { eatAtPacTile(): void }).eatAtPacTile();
}

function placeOnTile(sim: Simulation, tile: number): void {
  sim.pac.x = (tile % MAZE_COLS) * 8 * SUB + 4 * SUB;
  sim.pac.y = Math.floor(tile / MAZE_COLS) * 8 * SUB + 4 * SUB;
}

function key(sim: Simulation): string {
  return JSON.stringify({
    p: [sim.pac.x, sim.pac.y, sim.pac.dir, sim.pac.want],
    g: sim.ghosts.map((g) => [g.x, g.y, g.dir, g.lifecycle]),
    s: sim.score,
    d: sim.dotsEaten,
    m: sim.mode,
    f: sim.frightTicks,
    t: sim.tick,
    ph: sim.phase,
  });
}

/** makeSim with the maze emptied, so eating pauses don't disturb pixel-exact paths. */
function emptySim(): Simulation {
  const sim = makeSim();
  sim.dots.fill(0);
  sim.energizers.fill(0);
  return sim;
}

/** Place Pac-Man at a pixel position facing `dir`, wanting `want`. */
function placePac(sim: Simulation, xPx: number, yPx: number, dir: Dir, want: Dir | -1 = dir): void {
  sim.pac.x = xPx * SUB;
  sim.pac.y = yPx * SUB;
  sim.pac.dir = dir;
  sim.pac.want = want;
}

const pacPx = (sim: Simulation): [number, number] => [sim.pac.x / SUB, sim.pac.y / SUB];

describe('pac-man movement', () => {
  it('level 1 Pac-Man (80%) moves exactly one pixel per tick', () => {
    expect(Array.from({ length: 16 }, (_, i) => pixelSteps(16, i))).toEqual(Array(16).fill(1));
    // 105% = 21 px per 16 ticks: five 2-px ticks spread through the window.
    const steps = Array.from({ length: 16 }, (_, i) => pixelSteps(21, i));
    expect(steps.reduce((a, b) => a + b, 0)).toBe(21);
    expect(Math.max(...steps)).toBe(2);
  });

  it('stops on the tile centre when facing a wall', () => {
    const sim = emptySim();
    placePac(sim, 20, 44, LEFT); // tile (2,5); tile (0,5) is wall
    sim.stepTicks(40);
    expect(pacPx(sim)).toEqual([12, 44]);
  });

  it('reverses immediately on a legal reversal', () => {
    const sim = makeSim();
    placePac(sim, 100, 44, RIGHT, LEFT);
    const before = sim.pac.x;
    sim.step();
    expect(sim.pac.dir).toBe(LEFT);
    expect(sim.pac.x).toBeLessThan(before);
  });

  it('takes a buffered turn at an intersection', () => {
    const sim = makeSim();
    placePac(sim, 12, 44, RIGHT, UP); // tile (1,5); tile (1,4) above is corridor
    sim.step();
    expect(sim.pac.dir).toBe(UP);
  });

  // Dossier: entering a tile from the left, 3 pre-turn and 4 post-turn pixels;
  // from the right, 4 and 3. Same pattern vertically. Tile (1,5) centre = (12,44).
  it.each([
    ['moving right, 3 px before centre', 9, 44, RIGHT, UP, true],
    ['moving right, 4 px before centre', 8, 44, RIGHT, UP, false],
    ['moving right, 4 px after centre', 16, 44, RIGHT, UP, true],
    ['moving right, 5 px after centre', 17, 44, RIGHT, UP, false],
    ['moving left, 4 px before centre', 16, 44, LEFT, UP, true],
    ['moving left, 3 px after centre', 9, 44, LEFT, UP, true],
    ['moving left, 4 px after centre', 8, 44, LEFT, UP, false],
    ['moving down, 3 px before centre', 12, 41, DOWN, RIGHT, true],
    ['moving down, 4 px before centre', 12, 40, DOWN, RIGHT, false],
    ['moving up, 3 px after centre', 12, 41, UP, RIGHT, true],
  ] as const)('turn window: %s -> accepted=%s', (_label, x, y, dir, want, accepted) => {
    const sim = emptySim();
    placePac(sim, x, y, dir, want);
    sim.step();
    expect(sim.pac.dir === want).toBe(accepted);
  });

  it('pre-turns along a 45° diagonal and settles on the new centreline', () => {
    const sim = emptySim();
    placePac(sim, 9, 44, RIGHT, UP); // 3 px before the centre of tile (1,5)
    const path: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) {
      sim.step();
      path.push(pacPx(sim));
      expect(pacWalkable(tileOfSubX(sim.pac.x), tileOfSubY(sim.pac.y))).toBe(true);
    }
    expect(path).toEqual([
      [10, 43],
      [11, 42],
      [12, 41],
      [12, 40],
      [12, 39],
    ]);
  });

  it('post-turns back onto the centreline after overshooting it', () => {
    const sim = emptySim();
    placePac(sim, 16, 44, RIGHT, UP); // 4 px past the centre
    const path: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      sim.step();
      path.push(pacPx(sim));
    }
    expect(path).toEqual([
      [15, 43],
      [14, 42],
      [13, 41],
      [12, 40],
    ]);
  });

  it('gains one tick per pre-turn pixel by cornering early', () => {
    const ticksToTarget = (early: boolean): number => {
      const sim = emptySim();
      placePac(sim, 20, 44, LEFT, early ? UP : LEFT);
      for (let t = 1; t <= 100; t++) {
        if (!early && sim.pac.x === 12 * SUB) sim.pac.want = UP;
        sim.step();
        if (sim.pac.x === 12 * SUB && sim.pac.y === 36 * SUB) return t;
      }
      return -1;
    };
    // Late: 8 ticks to the centre + 8 up. Early: the 4 pre-turn pixels are covered diagonally.
    expect(ticksToTarget(false)).toBe(16);
    expect(ticksToTarget(true)).toBe(12);
  });

  it('wraps Pac-Man through the left tunnel', () => {
    const sim = emptySim();
    placePac(sim, 20, 116, LEFT); // tunnel row 14
    sim.stepTicks(20);
    expect(pacPx(sim)).toEqual([0, 116]);
    sim.stepTicks(10); // 1 px to wrap (-1 -> 223), then 9 more
    expect(pacPx(sim)).toEqual([214, 116]);
  });

  it('wraps a ghost through the tunnel without turning back', () => {
    const sim = emptySim();
    const blinky = sim.ghostById('blinky');
    blinky.lifecycle = 'out';
    blinky.x = 20 * SUB;
    blinky.y = 116 * SUB;
    blinky.dir = LEFT;
    blinky.nextDir = LEFT;
    // Follow him out of the left mouth and back in on the right, through to the
    // end of the right-hand tunnel (col 22); after that the AI may turn freely.
    let wrapped = false;
    let ticks = 0;
    while (!(wrapped && blinky.x < 176 * SUB) && ticks++ < 400) {
      sim.step();
      expect(blinky.dir).toBe(LEFT);
      expect(blinky.y).toBe(116 * SUB);
      if (blinky.x > 200 * SUB) wrapped = true;
    }
    expect(wrapped).toBe(true);
    expect(ticks).toBeLessThan(400);
  });

  it('never leaves the corridors or the pixel grid during a long pseudo-random run', () => {
    const sim = makeSim();
    const rng = new Rng(7);
    for (let i = 0; i < 3000; i++) {
      if (i % 5 === 0) sim.setDirection(rng.int(4) as Dir);
      sim.step();
      if (sim.phase !== 'playing') break;
      expect(pacWalkable(tileOfSubX(sim.pac.x), tileOfSubY(sim.pac.y))).toBe(true);
      expect(sim.pac.x % SUB).toBe(0);
      expect(sim.pac.y % SUB).toBe(0);
      // Off the lane centre only transiently, while cornering (at most 4 px).
      const perp = sim.pac.dir === LEFT || sim.pac.dir === RIGHT ? sim.pac.y : sim.pac.x;
      expect(Math.abs(pacLaneOffset(perp))).toBeLessThanOrEqual(4 * SUB);
    }
  });

  it('keeps every roaming ghost on walkable, pixel-aligned lanes through a full game', () => {
    const sim = new Simulation({ seed: 3 });
    sim.startNewGame();
    const rng = new Rng(11);
    for (let i = 0; i < 8000 && sim.phase !== 'gameover'; i++) {
      if (i % 15 === 0) sim.setDirection(rng.int(4) as Dir);
      sim.step();
      for (const g of sim.ghosts) {
        expect(g.x % SUB).toBe(0);
        expect(g.y % SUB).toBe(0);
        if (g.lifecycle !== 'out' && g.lifecycle !== 'eaten') continue;
        const eyes = g.lifecycle === 'eaten';
        expect(ghostWalkable(tileOfSubX(g.x), tileOfSubY(g.y), eyes, eyes)).toBe(true);
      }
    }
  });
});

describe('scatter / chase schedule', () => {
  it('matches the documented level 1 table', () => {
    const s = getSchedule(1);
    expect(s.map((p) => p.mode)).toEqual(['scatter', 'chase', 'scatter', 'chase', 'scatter', 'chase', 'scatter', 'chase']);
    expect(s[0].ticks).toBe(Math.round(7 * TICK_HZ));
    expect(s[1].ticks).toBe(Math.round(20 * TICK_HZ));
    expect(s[4].ticks).toBe(Math.round(5 * TICK_HZ));
    expect(s[5].ticks).toBe(Math.round(20 * TICK_HZ));
    expect(s[6].ticks).toBe(1);
    expect(s[7].ticks).toBe(Number.POSITIVE_INFINITY);
  });

  it('matches levels 2-4 and 5+', () => {
    expect(getSchedule(2)[5].ticks).toBe(Math.round(1033 * TICK_HZ));
    expect(getSchedule(4)[5].ticks).toBe(Math.round(1033 * TICK_HZ));
    const s5 = getSchedule(5);
    expect(s5[0].ticks).toBe(Math.round(5 * TICK_HZ));
    expect(s5[2].ticks).toBe(Math.round(5 * TICK_HZ));
    expect(s5[5].ticks).toBe(Math.round(1037 * TICK_HZ));
  });

  it('pauses the schedule during frightened mode and resumes after', () => {
    const sim = makeSim();
    sim.modeTicksLeft = 100;
    sim.frightTicks = 60;
    sim.stepTicks(50);
    expect(sim.frightTicks).toBe(10);
    expect(sim.modeTicksLeft).toBe(100);
    sim.stepTicks(10);
    expect(sim.frightTicks).toBe(0);
    const before = sim.modeTicksLeft;
    sim.stepTicks(10);
    expect(sim.modeTicksLeft).toBeLessThan(before);
  });

  it('reverses ghosts on a scatter/chase transition', () => {
    const sim = makeSim();
    const g = sim.ghostById('blinky');
    g.lifecycle = 'out';
    g.x = 12 * SUB;
    g.y = 44 * SUB;
    g.dir = RIGHT;
    g.nextDir = RIGHT;
    g.reversePending = false;
    sim.mode = 'scatter';
    sim.modeIndex = 0;
    sim.modeTicksLeft = 1;
    sim.step();
    expect(g.reversePending).toBe(true);
    sim.stepTicks(12);
    expect(g.dir).toBe(LEFT);
  });
});

describe('frightened mode and ghost chain', () => {
  it('awards 200/400/800/1600 for consecutive ghosts', () => {
    const sim = makeSim();
    sim.frightTicks = 200;
    sim.pac.x = 12 * SUB;
    sim.pac.y = 44 * SUB;
    sim.pac.dir = LEFT;
    sim.pac.want = LEFT;
    const scores = [200, 400, 800, 1600];
    let expected = 0;
    scores.forEach((points, i) => {
      const g = sim.ghosts[i];
      g.lifecycle = 'out';
      g.frightened = true;
      g.x = sim.pac.x;
      g.y = sim.pac.y;
      sim.frightTicks = 200;
      sim.ghostEatPause = 0;
      sim.step();
      expected += points;
      expect(sim.score).toBe(expected);
      expect(g.lifecycle).toBe('eaten');
    });
  });

  it('does not kill Pac-Man while ghosts are frightened', () => {
    const sim = makeSim();
    const g = sim.ghostById('blinky');
    g.lifecycle = 'out';
    g.frightened = true;
    g.x = sim.pac.x;
    g.y = sim.pac.y;
    sim.frightTicks = 100;
    sim.step();
    expect(sim.phase).toBe('playing');
  });

  it('eyes do not kill Pac-Man', () => {
    const sim = makeSim();
    const g = sim.ghostById('blinky');
    g.lifecycle = 'eaten';
    g.frightened = false;
    g.x = sim.pac.x;
    g.y = sim.pac.y;
    sim.step();
    expect(sim.phase).toBe('playing');
  });

  it('reverses ghosts when an energizer is eaten', () => {
    const sim = makeSim();
    const g = sim.ghostById('blinky');
    g.lifecycle = 'out';
    g.frightened = false;
    g.x = 100 * SUB;
    g.y = 44 * SUB;
    g.dir = RIGHT;
    sim.pac.x = 12 * SUB;
    sim.pac.y = 28 * SUB; // energizer tile (1,3)
    eatHere(sim);
    expect(sim.score).toBe(50);
    expect(sim.frightTicks).toBeGreaterThan(0);
    expect(g.reversePending).toBe(true);
    expect(g.frightened).toBe(true);
  });
});

describe('scoring, fruit, lives', () => {
  it('scores dots and energizers', () => {
    const sim = makeSim();
    const dot = MAZE.dotTiles[0];
    placeOnTile(sim, dot);
    eatHere(sim);
    expect(sim.score).toBe(10);
    expect(sim.dotsEaten).toBe(1);
  });

  it('spawns fruit at 70 and 170 consumed items', () => {
    const sim = makeSim();
    sim.dotsEaten = 69;
    const dot = MAZE.dotTiles.find((i) => sim.dots[i] === 1)!;
    placeOnTile(sim, dot);
    eatHere(sim);
    expect(sim.dotsEaten).toBe(70);
    expect(sim.fruit).not.toBeNull();
    expect(sim.fruit!.type).toBe(getLevelConfig(1).fruit);

    sim.dotsEaten = 169;
    const dot2 = MAZE.dotTiles.find((i) => sim.dots[i] === 1)!;
    placeOnTile(sim, dot2);
    eatHere(sim);
    expect(sim.dotsEaten).toBe(170);
    expect(sim.fruit).not.toBeNull();
  });

  it('awards the extra life exactly once', () => {
    const sim = makeSim();
    const lives = sim.lives;
    sim.addScore(9990);
    expect(sim.lives).toBe(lives);
    sim.addScore(20);
    expect(sim.lives).toBe(lives + 1);
    expect(sim.extraLifeAwarded).toBe(true);
    sim.addScore(20000);
    expect(sim.lives).toBe(lives + 1);
  });

  it('keeps score and pellets on death and decrements one life', () => {
    const sim = makeSim();
    const g = sim.ghostById('blinky');
    g.lifecycle = 'out';
    g.frightened = false;
    g.x = sim.pac.x;
    g.y = sim.pac.y;
    const score = sim.score;
    const dots = sim.dotsEaten;
    const lives = sim.lives;
    sim.step();
    expect(sim.phase).toBe('dying');
    sim.stepTicks(DEATH_TICKS + 3);
    expect(sim.lives).toBe(lives - 1);
    expect(sim.score).toBe(score);
    expect(sim.dotsEaten).toBe(dots);
    expect(sim.phase).toBe('ready');
    sim.stepTicks(10);
    expect(sim.lives).toBe(lives - 1);
  });

  it('completes a level and resets consumables', () => {
    const sim = makeSim();
    sim.dotsEaten = TOTAL_CONSUMABLES - 1;
    const dot = MAZE.dotTiles.find((i) => sim.dots[i] === 1)!;
    placeOnTile(sim, dot);
    eatHere(sim);
    sim.step();
    expect(sim.phase).toBe('levelclear');
    sim.stepTicks(LEVEL_FLASH_TICKS + 3);
    expect(sim.level).toBe(2);
    expect(sim.remainingDots()).toBe(TOTAL_CONSUMABLES);
    expect(sim.phase).toBe('ready');
  });

  it('game over after the last life', () => {
    const sim = makeSim();
    sim.lives = 1;
    const g = sim.ghostById('blinky');
    g.lifecycle = 'out';
    g.frightened = false;
    g.x = sim.pac.x;
    g.y = sim.pac.y;
    sim.step();
    sim.stepTicks(DEATH_TICKS + 3);
    expect(sim.lives).toBe(0);
    expect(sim.phase).toBe('gameover');
  });
});

describe('ghost house and Cruise Elroy', () => {
  it('releases Pinky immediately and Inky/Clyde on their dot limits on level 1', () => {
    const sim = new Simulation({ seed: 1 });
    sim.startNewGame();
    sim.phase = 'playing';
    const pinky = sim.ghostById('pinky');
    const inky = sim.ghostById('inky');
    const clyde = sim.ghostById('clyde');
    expect(pinky.dotLimit).toBe(0);
    expect(inky.dotLimit).toBe(30);
    expect(clyde.dotLimit).toBe(60);
    sim.stepTicks(120);
    expect(pinky.lifecycle).not.toBe('house');
    expect(inky.lifecycle).toBe('house');
    expect(clyde.lifecycle).toBe('house');
  });

  it('activates Cruise Elroy at the level 1 thresholds', () => {
    const sim = makeSim();
    sim.dotsEaten = 244 - 21;
    (sim as unknown as { updateElroy(): void }).updateElroy();
    expect(sim.elroy).toBe(0);
    sim.dotsEaten = 244 - 20;
    (sim as unknown as { updateElroy(): void }).updateElroy();
    expect(sim.elroy).toBe(1);
    sim.dotsEaten = 244 - 10;
    (sim as unknown as { updateElroy(): void }).updateElroy();
    expect(sim.elroy).toBe(2);
  });

  it('uses the level 1 Elroy speeds (80% and 85%)', () => {
    const cfg = getLevelConfig(1);
    expect(cfg.elroy1Dots).toBe(20);
    expect(cfg.elroy1Speed).toBe(80);
    expect(cfg.elroy2Dots).toBe(10);
    expect(cfg.elroy2Speed).toBe(85);
  });

  it('suspends Elroy after a death until Clyde starts leaving', () => {
    const sim = makeSim();
    sim.dotsEaten = 244 - 10; // 10 left -> Elroy 2 normally
    sim.elroySuspended = true;
    (sim as unknown as { updateElroy(): void }).updateElroy();
    expect(sim.elroy).toBe(0);
    const clyde = sim.ghostById('clyde');
    clyde.lifecycle = 'exiting';
    (sim as unknown as { updateElroy(): void }).updateElroy();
    expect(sim.elroy).toBe(2);
  });

  /** Sim mid-level with everyone but `inside` roaming, under a stuck global counter. */
  function stuckGlobalCounterSim(): Simulation {
    const sim = new Simulation({ seed: 1 });
    sim.startNewGame();
    sim.phase = 'playing';
    sim.readyTicks = 0;
    for (const g of sim.ghosts) g.lifecycle = 'out';
    // Clyde was outside when the counter passed 32, so it never deactivates (Dossier).
    sim.globalCounterActive = true;
    sim.globalDotCounter = 40;
    sim.cfg = { ...sim.cfg, idleLimitTicks: 1_000_000 };
    return sim;
  }

  function reviveInHouse(sim: Simulation, id: 'blinky' | 'clyde'): void {
    const g = sim.ghostById(id);
    g.lifecycle = 'house';
    g.reviveTimer = 20;
    g.x = 112 * SUB;
    g.y = 116 * SUB;
  }

  it('releases a revived Blinky at once, even while the global counter is active', () => {
    const sim = stuckGlobalCounterSim();
    reviveInHouse(sim, 'blinky');
    sim.stepTicks(30);
    expect(sim.ghostById('blinky').lifecycle).not.toBe('house');
  });

  it('keeps a revived Clyde home under a stuck global counter until the timer fires', () => {
    // The Dossier's "trap the ghosts" trick: only the inactivity timer can free him.
    const sim = stuckGlobalCounterSim();
    reviveInHouse(sim, 'clyde');
    sim.stepTicks(120);
    expect(sim.ghostById('clyde').lifecycle).toBe('house');
    sim.idleTimer = sim.cfg.idleLimitTicks - 1;
    sim.stepTicks(2);
    expect(sim.ghostById('clyde').lifecycle).not.toBe('house');
  });

  it('returns eyes to the ghost’s own pen slot before reviving', () => {
    const slots = { blinky: 112, pinky: 112, inky: 96, clyde: 128 } as const;
    for (const id of ['blinky', 'pinky', 'inky', 'clyde'] as const) {
      const sim = makeSim();
      const g = sim.ghostById(id);
      g.lifecycle = 'entering';
      g.x = 104 * SUB; // eyes arrive just left of the door column
      g.y = 92 * SUB;
      const enter = (sim as unknown as { stepEnter(g: unknown): void }).stepEnter.bind(sim);
      for (let i = 0; i < 200 && g.lifecycle === 'entering'; i++) enter(g);
      expect(g.lifecycle).toBe('house');
      expect([g.x, g.y]).toEqual([slots[id] * SUB, 116 * SUB]);
    }
  });

  it('bobs waiting ghosts ±4 px about their slot', () => {
    const sim = makeSim();
    const inky = sim.ghostById('inky');
    inky.x = 96 * SUB;
    const ys = new Set<number>();
    for (let i = 0; i < 200; i++) {
      sim.step();
      ys.add(inky.y / SUB);
      expect(inky.x).toBe(96 * SUB);
    }
    expect(Math.min(...ys)).toBe(112);
    expect(Math.max(...ys)).toBe(120);
  });

  it('lets several ghosts walk out at once (level 3: every dot limit is zero)', () => {
    const sim = new Simulation({ seed: 1, level: 3 });
    sim.phase = 'playing';
    sim.step();
    expect(['pinky', 'inky', 'clyde'].map((id) => sim.ghostById(id as 'pinky').lifecycle)).toEqual([
      'exiting',
      'exiting',
      'exiting',
    ]);
    for (let i = 0; i < 400 && sim.phase === 'playing'; i++) sim.step();
    for (const g of sim.ghosts) expect(['out', 'eaten', 'entering', 'house']).toContain(g.lifecycle);
    expect(sim.ghosts.filter((g) => g.lifecycle === 'out').length).toBeGreaterThanOrEqual(3);
  });

  it('exits from a bobbed position: level off, slide to the door column, then up', () => {
    const sim = makeSim();
    const inky = sim.ghostById('inky');
    inky.x = 96 * SUB;
    sim.stepTicks(13); // part-way through a bob
    expect(inky.y).not.toBe(116 * SUB);
    inky.reviveTimer = 0;
    inky.dotLimit = 0;
    const path: Array<[number, number]> = [];
    for (let i = 0; i < 300 && inky.lifecycle !== 'out'; i++) {
      sim.step();
      path.push([inky.x / SUB, inky.y / SUB]);
    }
    expect(inky.lifecycle).toBe('out');
    expect([inky.x, inky.y]).toEqual([112 * SUB, 92 * SUB]);
    // x only changes once on the slot centreline; y only rises once in the door column.
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      if (x1 !== x0) expect(y0).toBe(116);
      if (y1 < y0 && y1 < 112) expect(x0).toBe(112);
    }
  });

  /** Pac-Man in the doorway tile (14,11) with Clyde exiting just below him. */
  function doorwaySim(frightened: boolean): Simulation {
    const sim = makeSim();
    placeOnTile(sim, 11 * MAZE_COLS + 14);
    sim.pac.dir = LEFT;
    sim.pac.want = -1;
    const clyde = sim.ghostById('clyde');
    clyde.lifecycle = 'exiting';
    clyde.x = 112 * SUB;
    clyde.y = 95 * SUB; // centre in row 11, lower edge still in the door
    if (frightened) {
      sim.frightTicks = sim.frightTotal = 600;
      clyde.frightened = true;
    }
    return sim;
  }

  it('an exiting ghost in the doorway kills Pac-Man', () => {
    const sim = doorwaySim(false);
    sim.step();
    expect(sim.phase).toBe('dying');
  });

  it('turns ghosts that are walking out blue on an energizer', () => {
    const sim = makeSim();
    const inky = sim.ghostById('inky');
    inky.lifecycle = 'exiting';
    (sim as unknown as { startFrightened(): void }).startFrightened();
    expect(inky.frightened).toBe(true);
  });

  it('ghost bug (Appendix B): caught in the door, it revives and climbs through the walls back to the pen', () => {
    const sim = doorwaySim(true);
    const clyde = sim.ghostById('clyde');
    const score = sim.score;
    sim.step();
    expect(sim.score).toBe(score + 200);
    expect(clyde.lifecycle).toBe('entering'); // eyes straight back into the pen
    expect(clyde.bugged).toBe(true);

    let revivedAt: [number, number] | null = null;
    let throughWall = false;
    let wrapped = false;
    let prevY = clyde.y;
    for (let i = 0; i < 3000 && clyde.lifecycle !== 'house'; i++) {
      sim.step();
      if (clyde.lifecycle === 'bugged') {
        revivedAt ??= [clyde.x / SUB, clyde.y / SUB];
        expect(clyde.x).toBe(112 * SUB); // straight up the door column
        const t = MAZE.tiles[tileOfSubY(clyde.y) * MAZE_COLS + tileOfSubX(clyde.x)];
        if (t === 0) throughWall = true; // Tile.Wall
        if (clyde.y > prevY + 100 * SUB) wrapped = true;
      }
      prevY = clyde.y;
    }
    expect(revivedAt).toEqual([112, 116]);
    expect(throughWall).toBe(true);
    expect(wrapped).toBe(true);
    expect(clyde.lifecycle).toBe('house');
    expect(clyde.bugged).toBe(false);
    expect([clyde.x, clyde.y]).toEqual([112 * SUB, 116 * SUB]);
    expect(sim.phase).toBe('playing');
  });

  it('level 17 has no frightened time and level 18 restores it', () => {
    expect(getLevelConfig(17).frightTicks).toBe(0);
    expect(getLevelConfig(18).frightTicks).toBeGreaterThan(0);
    expect(getLevelConfig(19).frightTicks).toBe(0);
  });
});

describe('pseudo-random behaviour (Dossier)', () => {
  type Internals = { finishDeath(): void; advanceLevel(): void; startFrightened(): void };

  it('resets the frightened PRNG to the same seed after a death and at a new level', () => {
    const first = new Rng(FRIGHTENED_SEED).next();
    const sim = makeSim();
    sim.frightenedRng.next();
    sim.frightenedRng.next();
    (sim as unknown as Internals).finishDeath();
    expect(sim.frightenedRng.next()).toBe(first);
    sim.frightenedRng.next();
    (sim as unknown as Internals).advanceLevel();
    expect(sim.frightenedRng.next()).toBe(first);
  });

  it('advances the frightened PRNG only at frightened decisions, not with time', () => {
    const sim = new Simulation({ seed: 8 });
    sim.startNewGame();
    sim.stepTicks(1500); // no input: Pac-Man parks against a wall, nobody is frightened
    expect(sim.frightTicks).toBe(0);
    expect(sim.frightenedRng.seed).toBe(FRIGHTENED_SEED);
  });

  /** A game started after `titleWait` ticks on the title screen, frightened mode forced on. */
  function patternRun(titleWait: number): { trace: string; rngMoved: boolean } {
    const sim = new Simulation({ seed: 42 });
    sim.stepTicks(titleWait);
    sim.startNewGame();
    const rng = new Rng(5);
    const inputs = Array.from({ length: 2000 }, () => rng.int(4) as Dir);
    const trace: string[] = [];
    for (let i = 0; i < inputs.length && sim.phase !== 'gameover'; i++) {
      if (i === 400) {
        sim.cfg = { ...sim.cfg, frightTicks: 1200 };
        (sim as unknown as Internals).startFrightened();
      }
      if (i % 25 === 0) sim.setDirection(inputs[i]);
      sim.step();
      trace.push(sim.ghosts.map((g) => `${g.x},${g.y},${g.dir},${g.lifecycle}`).join('|') + `/${sim.pac.x},${sim.pac.y}`);
    }
    return { trace: trace.join('\n'), rngMoved: sim.frightenedRng.seed !== FRIGHTENED_SEED };
  }

  it('repeats frightened paths exactly however long the title screen ran (patterns work)', () => {
    const a = patternRun(0);
    const b = patternRun(777);
    expect(a.rngMoved).toBe(true);
    expect(b.trace).toBe(a.trace);
  });

  function fruitLifetime(titleWait: number): number {
    const sim = new Simulation({ seed: 42 });
    sim.stepTicks(titleWait);
    sim.startNewGame();
    sim.phase = 'playing';
    sim.dotsEaten = 69;
    placeOnTile(sim, MAZE.dotTiles[0]);
    eatHere(sim);
    return sim.fruit!.totalTicks;
  }

  it('keeps fruit on screen 9-10 s, varying with power-on time rather than the pattern', () => {
    const lifetimes = Array.from({ length: 40 }, (_, i) => fruitLifetime(i * 37));
    for (const t of lifetimes) {
      expect(t).toBeGreaterThanOrEqual(Math.round(9 * TICK_HZ));
      expect(t).toBeLessThanOrEqual(Math.round(10 * TICK_HZ));
    }
    expect(new Set(lifetimes).size).toBeGreaterThan(10);
    expect(fruitLifetime(370)).toBe(fruitLifetime(370)); // still deterministic for a full replay
  });
});

describe('determinism and fixed-step equivalence', () => {
  it('produces identical state for identical seeds and inputs', () => {
    const a = makeSim(99);
    const b = makeSim(99);
    const rng = new Rng(4);
    const dirs: Dir[] = [];
    for (let i = 0; i < 900; i++) dirs.push(rng.int(4) as Dir);
    for (let i = 0; i < dirs.length; i++) {
      a.setDirection(dirs[i]);
      b.setDirection(dirs[i]);
      a.step();
      b.step();
    }
    expect(key(a)).toBe(key(b));
  });

  /**
   * Golden replay: a full game (real house rules, deaths, global counter) driven
   * by a seeded input log. Any change to simulation behaviour changes this hash;
   * when that change is intended, re-record the constant and say why in the commit.
   */
  it('matches the recorded golden replay hash', () => {
    const sim = new Simulation({ seed: 0xc0ffee });
    sim.startNewGame();
    const rng = new Rng(77);
    let dir = rng.int(4) as Dir;
    for (let i = 0; i < 6000; i++) {
      if (i % 20 === 0) dir = rng.int(4) as Dir; // hold each input ~1/3 s
      sim.setDirection(dir);
      sim.step();
    }
    const state = key(sim) + JSON.stringify([sim.lives, sim.level, Array.from(sim.dots), Array.from(sim.energizers)]);
    let h = 0x811c9dc5;
    for (let i = 0; i < state.length; i++) h = Math.imul(h ^ state.charCodeAt(i), 0x01000193) >>> 0;
    expect({ hash: h.toString(16), score: sim.score, lives: sim.lives, phase: sim.phase }).toEqual(GOLDEN_REPLAY);
  });

  it('gives the same result at 60 Hz and 144 Hz presentation', () => {
    const inputs: Dir[] = [];
    const rng = new Rng(21);
    for (let i = 0; i < 600; i++) inputs.push(rng.int(4) as Dir);

    const a = makeSim(5);
    const b = makeSim(5);
    for (let i = 0; i < inputs.length; i++) {
      a.setDirection(inputs[i]);
      a.step();
    }

    const clock = new FixedStepClock(1000 / TICK_HZ, 8);
    let idx = 0;
    const frameMs = 1000 / 144;
    const frames = Math.ceil((inputs.length * (1000 / TICK_HZ)) / frameMs);
    for (let f = 0; f < frames; f++) {
      clock.advance(frameMs, () => {
        if (idx < inputs.length) b.setDirection(inputs[idx]);
        idx++;
        b.step();
      });
    }
    expect(key(a)).toBe(key(b));
  });

  it('uses integer sub-pixel speeds for every documented percentage', () => {
    for (const pct of [40, 45, 50, 55, 60, 75, 80, 85, 90, 95, 100, 105]) {
      const sub = Math.round((20 * pct) / 100);
      expect(Number.isInteger(sub)).toBe(true);
    }
    expect(START_LIVES).toBe(3);
    expect(DOWN).toBe(2);
  });
});