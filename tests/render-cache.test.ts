import { describe, expect, it } from 'vitest';
import { dotsStale } from '../src/render/renderer';
import { Simulation } from '../src/game/sim';

describe('dot texture cache', () => {
  it('rebuilds when switching between the demo and the real game, even at equal revisions', () => {
    const game = new Simulation({ seed: 1 });
    const demo = new Simulation({ seed: 2 });
    game.startNewGame();
    demo.startNewGame();
    demo.dots.fill(0); // the demo has eaten its maze...
    demo.revision = game.revision; // ...but happens to share the revision number
    const shown = { sim: demo, revision: demo.revision };
    expect(dotsStale(shown, game)).toBe(true);
    expect(dotsStale(shown, demo)).toBe(false);
    demo.revision++;
    expect(dotsStale(shown, demo)).toBe(true);
    expect(dotsStale(null, game)).toBe(true);
  });
});
