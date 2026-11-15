/**
 * Frozen reference scene.
 *
 * Reconstructs a mid-level-1 state with score 2610 / high score 2610, two
 * reserve lives and the level-1 cherry counter. The brief's screenshot was never
 * available, so the consumed-pellet pattern is a deterministic reconstruction,
 * not a pixel copy. The score is computed from REFERENCE_COMPOSITION below, so
 * the stated composition and the displayed score cannot disagree.
 */
import { Simulation } from './sim';
import { MAZE } from './maze';
import { Rng } from './rng';
import { DOT_SCORE, ENERGIZER_SCORE, LEFT, RIGHT, DOWN, SUB } from './constants';
import { FRUITS } from './levels';

/**
 * What has been scored by the moment of the reference scene:
 * 181 dots (1810) + 4 energizers (200) + both level-1 cherries (200)
 * + one ghost caught on each of two energizers (200 + 200) = 2610.
 */
export const REFERENCE_COMPOSITION = {
  dots: 181,
  energizers: 4,
  cherries: 2,
  ghostScores: [200, 200] as const,
} as const;

export function referenceScore(c = REFERENCE_COMPOSITION): number {
  return (
    c.dots * DOT_SCORE +
    c.energizers * ENERGIZER_SCORE +
    c.cherries * FRUITS[0].score +
    c.ghostScores.reduce((a, b) => a + b, 0)
  );
}
import type { GhostId } from './types';

const GHOST_PLACEMENT: Record<GhostId, { col: number; row: number; dir: 0 | 1 | 2 | 3 }> = {
  blinky: { col: 21, row: 5, dir: LEFT },
  pinky: { col: 6, row: 8, dir: RIGHT },
  inky: { col: 21, row: 23, dir: LEFT },
  clyde: { col: 1, row: 20, dir: DOWN },
};

export function createReferenceScene(): Simulation {
  const sim = new Simulation({ seed: 0x5eed1234, level: 1, lives: 3, frozen: true });
  sim.startNewGame();

  const rng = new Rng(0xc0ffee);
  const order = MAZE.dotTiles
    .map((i) => ({ i, k: rng.next() }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.i);
  const c = REFERENCE_COMPOSITION;
  for (let n = 0; n < c.dots; n++) sim.dots[order[n]] = 0;
  for (const i of MAZE.energizerTiles.slice(0, c.energizers)) sim.energizers[i] = 0;

  sim.dotsEaten = c.dots + c.energizers;
  sim.revision++;
  sim.fruitSpawned = [true, true];
  sim.fruit = null;
  sim.score = referenceScore();
  sim.highScore = sim.score;
  sim.ghostChain = 0;
  sim.elroy = 0;
  sim.phase = 'playing';
  sim.paused = false;
  sim.tick = 3600;

  for (const g of sim.ghosts) {
    const p = GHOST_PLACEMENT[g.id];
    g.lifecycle = 'out';
    g.frightened = false;
    g.x = (p.col * 8 + 4) * SUB;
    g.y = (p.row * 8 + 4) * SUB;
    g.dir = p.dir;
    g.nextDir = p.dir;
  }

  return sim;
}