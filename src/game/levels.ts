/**
 * Level specification table (The Pac-Man Dossier, Table A.1) plus the
 * scatter/chase schedule and ghost-house release limits.
 *
 * All speeds are percentages of the documented base speed
 * (100% = 75.75757625 px/s = 20 sub/tick at 60.606061 Hz).
 */
import { TICK_HZ } from './constants';
import type { BehaviorMode } from './types';

export interface LevelConfig {
  level: number;
  /** index into FRUITS */
  fruit: number;
  fruitScore: number;
  pacSpeed: number;
  pacFrightSpeed: number;
  ghostSpeed: number;
  ghostFrightSpeed: number;
  ghostTunnelSpeed: number;
  elroy1Dots: number;
  elroy1Speed: number;
  elroy2Dots: number;
  elroy2Speed: number;
  /** frightened duration in ticks; 0 = no blue time */
  frightTicks: number;
  frightFlashes: number;
  /** pinky, inky, clyde personal dot limits */
  houseLimits: readonly [number, number, number];
  /** inactivity timer limit in ticks */
  idleLimitTicks: number;
}

interface Row {
  fruit: number;
  fruitScore: number;
  pac: number;
  ghost: number;
  tunnel: number;
  e1: number;
  e1s: number;
  e2: number;
  e2s: number;
  fp: number;
  fg: number;
  fright: number; // seconds; -1 = no frightened mode at all
  flashes: number;
}

// level, fruit, points, pac, ghost, tunnel, elroy1 dots, elroy1 %, elroy2 dots, elroy2 %, fright pac, fright ghost, fright sec, flashes
const TABLE: readonly Row[] = [
  { fruit: 0, fruitScore: 100, pac: 80, ghost: 75, tunnel: 40, e1: 20, e1s: 80, e2: 10, e2s: 85, fp: 90, fg: 50, fright: 6, flashes: 5 },
  { fruit: 1, fruitScore: 300, pac: 90, ghost: 85, tunnel: 45, e1: 30, e1s: 90, e2: 15, e2s: 95, fp: 95, fg: 55, fright: 5, flashes: 5 },
  { fruit: 2, fruitScore: 500, pac: 90, ghost: 85, tunnel: 45, e1: 40, e1s: 90, e2: 20, e2s: 95, fp: 95, fg: 55, fright: 4, flashes: 5 },
  { fruit: 2, fruitScore: 500, pac: 90, ghost: 85, tunnel: 45, e1: 40, e1s: 90, e2: 20, e2s: 95, fp: 95, fg: 55, fright: 3, flashes: 5 },
  { fruit: 3, fruitScore: 700, pac: 100, ghost: 95, tunnel: 50, e1: 40, e1s: 100, e2: 20, e2s: 105, fp: 100, fg: 60, fright: 2, flashes: 5 },
  { fruit: 3, fruitScore: 700, pac: 100, ghost: 95, tunnel: 50, e1: 50, e1s: 100, e2: 25, e2s: 105, fp: 100, fg: 60, fright: 5, flashes: 5 },
  { fruit: 4, fruitScore: 1000, pac: 100, ghost: 95, tunnel: 50, e1: 50, e1s: 100, e2: 25, e2s: 105, fp: 100, fg: 60, fright: 2, flashes: 5 },
  { fruit: 4, fruitScore: 1000, pac: 100, ghost: 95, tunnel: 50, e1: 50, e1s: 100, e2: 25, e2s: 105, fp: 100, fg: 60, fright: 2, flashes: 5 },
  { fruit: 5, fruitScore: 2000, pac: 100, ghost: 95, tunnel: 50, e1: 60, e1s: 100, e2: 30, e2s: 105, fp: 100, fg: 60, fright: 1, flashes: 3 },
  { fruit: 5, fruitScore: 2000, pac: 100, ghost: 95, tunnel: 50, e1: 60, e1s: 100, e2: 30, e2s: 105, fp: 100, fg: 60, fright: 5, flashes: 5 },
  { fruit: 6, fruitScore: 3000, pac: 100, ghost: 95, tunnel: 50, e1: 60, e1s: 100, e2: 30, e2s: 105, fp: 100, fg: 60, fright: 2, flashes: 5 },
  { fruit: 6, fruitScore: 3000, pac: 100, ghost: 95, tunnel: 50, e1: 80, e1s: 100, e2: 40, e2s: 105, fp: 100, fg: 60, fright: 1, flashes: 3 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 80, e1s: 100, e2: 40, e2s: 105, fp: 100, fg: 60, fright: 1, flashes: 3 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 80, e1s: 100, e2: 40, e2s: 105, fp: 100, fg: 60, fright: 3, flashes: 5 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 100, e1s: 100, e2: 50, e2s: 105, fp: 100, fg: 60, fright: 1, flashes: 3 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 100, e1s: 100, e2: 50, e2s: 105, fp: 100, fg: 60, fright: 1, flashes: 3 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 100, e1s: 100, e2: 50, e2s: 105, fp: 100, fg: 60, fright: -1, flashes: 0 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 100, e1s: 100, e2: 50, e2s: 105, fp: 100, fg: 60, fright: 1, flashes: 3 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 120, e1s: 100, e2: 60, e2s: 105, fp: 100, fg: 60, fright: -1, flashes: 0 },
  { fruit: 7, fruitScore: 5000, pac: 100, ghost: 95, tunnel: 50, e1: 120, e1s: 100, e2: 60, e2s: 105, fp: 100, fg: 60, fright: -1, flashes: 0 },
];

const secondsToTicks = (s: number): number => Math.round(s * TICK_HZ);

export function getLevelConfig(level: number): LevelConfig {
  const row = TABLE[Math.min(level, TABLE.length) - 1];
  let houseLimits: readonly [number, number, number];
  if (level === 1) houseLimits = [0, 30, 60];
  else if (level === 2) houseLimits = [0, 0, 50];
  else houseLimits = [0, 0, 0];
  const frightTicks = row.fright < 0 ? 0 : secondsToTicks(row.fright);
  return {
    level,
    fruit: row.fruit,
    fruitScore: row.fruitScore,
    pacSpeed: row.pac,
    pacFrightSpeed: row.fp,
    ghostSpeed: row.ghost,
    ghostFrightSpeed: row.fg,
    ghostTunnelSpeed: row.tunnel,
    elroy1Dots: row.e1,
    elroy1Speed: row.e1s,
    elroy2Dots: row.e2,
    elroy2Speed: row.e2s,
    frightTicks,
    frightFlashes: row.flashes,
    houseLimits,
    idleLimitTicks: secondsToTicks(level <= 4 ? 4 : 3),
  };
}

export interface SchedulePhase {
  mode: BehaviorMode;
  ticks: number; // Infinity for the final chase
}

/**
 * Scatter/chase schedule. The fourth scatter on levels 2+ is one nominal frame
 * (1/60 s), which is expressed as a single tick at the hardware cadence.
 */
export function getSchedule(level: number): SchedulePhase[] {
  const s = (n: number) => secondsToTicks(n);
  const oneFrame = 1;
  const phases: SchedulePhase[] = [];
  const firstScatter = level === 1 ? 7 : level <= 4 ? 7 : 5;
  phases.push({ mode: 'scatter', ticks: s(firstScatter) });
  phases.push({ mode: 'chase', ticks: s(20) });
  phases.push({ mode: 'scatter', ticks: s(firstScatter) });
  phases.push({ mode: 'chase', ticks: s(20) });
  phases.push({ mode: 'scatter', ticks: s(5) });
  const thirdChase = level === 1 ? 20 : level <= 4 ? 1033 : 1037;
  phases.push({ mode: 'chase', ticks: s(thirdChase) });
  phases.push({ mode: 'scatter', ticks: oneFrame });
  phases.push({ mode: 'chase', ticks: Number.POSITIVE_INFINITY });
  return phases;
}

export const FRUITS = [
  { name: 'cherry', score: 100 },
  { name: 'strawberry', score: 300 },
  { name: 'peach', score: 500 },
  { name: 'apple', score: 700 },
  { name: 'melon', score: 1000 },
  { name: 'galaxian', score: 2000 },
  { name: 'bell', score: 3000 },
  { name: 'key', score: 5000 },
] as const;