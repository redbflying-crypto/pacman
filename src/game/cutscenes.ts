/**
 * Intermissions. The arcade plays a short cutscene after levels 2, 5 and 9,
 * repeating the third after 13 and 17 (widely documented schedule; the Dossier
 * does not cover intermissions). The three scenes below are original to this
 * project — only the schedule follows the arcade.
 *
 * Scenes are pure data: frame(t) lists the actors to draw at tick t, in screen
 * pixels. The simulation only times them; the renderer draws them.
 */
import { DOWN, LEFT, RIGHT, type Dir } from './constants';
import type { GhostId } from './types';

export interface CutsceneActor {
  sprite: 'pac' | 'ghost';
  ghost?: GhostId;
  /** centre, screen pixels */
  x: number;
  y: number;
  dir: Dir;
  /** true while walking (animates mouth / feet) */
  moving: boolean;
}

export interface Cutscene {
  readonly name: string;
  readonly duration: number;
  frame(t: number): CutsceneActor[];
}

/** One leg of a horizontal path: from x0 at t0 to x1 at t1, facing dir. */
type Leg = readonly [t0: number, t1: number, x0: number, x1: number, dir: Dir];

function along(legs: readonly Leg[], t: number): { x: number; dir: Dir; moving: boolean } {
  if (t < legs[0][0]) return { x: legs[0][2], dir: legs[0][4], moving: false };
  for (const [t0, t1, x0, x1, dir] of legs) {
    if (t >= t0 && t < t1) return { x: x0 + ((x1 - x0) * (t - t0)) / (t1 - t0), dir, moving: x0 !== x1 };
  }
  const last = legs[legs.length - 1];
  return { x: last[3], dir: last[4], moving: false };
}

const Y = 150; // the lane under the pen, mid-screen
const GHOSTS: readonly GhostId[] = ['blinky', 'pinky', 'inky', 'clyde'];
const run = (t0: number, x0: number, x1: number, speed: number, dir: Dir): Leg => [
  t0,
  t0 + Math.abs(x1 - x0) / speed,
  x0,
  x1,
  dir,
];

/** 1. Conga: a ghost parade with Pac-Man at the back, until Clyde looks round. */
const conga: Cutscene = {
  name: 'conga',
  duration: 420,
  frame(t) {
    const actors: CutsceneActor[] = [];
    GHOSTS.forEach((id, k) => {
      const start = -16 - 18 * k;
      const legs: Leg[] =
        id === 'clyde'
          ? [[0, 200, start, start + 200, RIGHT], [200, 260, start + 200, start + 200, LEFT], run(260, start + 200, -24, 1.1, LEFT)]
          : [run(0, start, 260, 1, RIGHT)];
      actors.push({ sprite: 'ghost', ghost: id, y: Y, ...along(legs, t) });
    });
    const pacStart = -16 - 18 * 4 - 10;
    const pac = along(
      [[0, 200, pacStart, pacStart + 200, RIGHT], [200, 240, pacStart + 200, pacStart + 200, RIGHT], run(240, pacStart + 200, -24, 1.25, LEFT)],
      t,
    );
    actors.push({ sprite: 'pac', y: Y, ...pac });
    return actors;
  },
};

/** 2. Wave: the ghosts line up, do a stadium wave, and watch Pac-Man stroll by. */
const wave: Cutscene = {
  name: 'wave',
  duration: 520,
  frame(t) {
    const pac = along([run(300, 240, -24, 1.25, LEFT)], t);
    const actors: CutsceneActor[] = GHOSTS.map((id, k) => {
      const spot = 64 + 32 * k;
      const walk = along([run(0, 240 + 32 * k, spot, 1, LEFT)], t);
      let dir: Dir = walk.moving ? LEFT : DOWN;
      if (t >= 300 && pac.x > -16) dir = pac.x < spot ? LEFT : RIGHT;
      let hop = 0;
      for (const start of [200, 250]) {
        const p = (t - (start + 12 * k)) / 16;
        if (p >= 0 && p < 1) hop = Math.round(-5 * Math.sin(Math.PI * p));
      }
      return { sprite: 'ghost', ghost: id, x: walk.x, y: Y + hop, dir, moving: walk.moving };
    });
    actors.push({ sprite: 'pac', y: Y, ...pac });
    return actors;
  },
};

/** 3. Tag: face to face, both retreat, then they come back and pass straight through each other. */
const tag: Cutscene = {
  name: 'tag',
  duration: 500,
  frame(t) {
    const meet = 102;
    const pac = along(
      [
        run(0, -16, -16 + 1.25 * meet, 1.25, RIGHT),
        [meet, 150, -16 + 1.25 * meet, -16 + 1.25 * meet, RIGHT],
        run(150, -16 + 1.25 * meet, -24, 1.25, LEFT),
        [251, 280, 240, 240, LEFT],
        run(280, 240, -24, 1.25, LEFT),
      ],
      t,
    );
    const blinky = along(
      [
        run(0, 240, 240 - 1.25 * meet, 1.25, LEFT),
        [meet, 150, 240 - 1.25 * meet, 240 - 1.25 * meet, LEFT],
        run(150, 240 - 1.25 * meet, 248, 1.25, RIGHT),
        [261, 280, -16, -16, RIGHT],
        run(280, -16, 248, 1.25, RIGHT),
      ],
      t,
    );
    return [
      { sprite: 'ghost', ghost: 'blinky', y: Y, ...blinky },
      { sprite: 'pac', y: Y, ...pac },
    ];
  },
};

export const CUTSCENES: readonly Cutscene[] = [conga, wave, tag];

/** Cutscene to play after clearing `level`, or -1 for none. */
export function intermissionAfter(level: number): number {
  if (level === 2) return 0;
  if (level === 5) return 1;
  if (level === 9 || level === 13 || level === 17) return 2;
  return -1;
}
