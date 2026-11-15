import { describe, expect, it } from 'vitest';
import type { Dir } from '../src/game/constants';
import { autopilot } from '../src/game/autopilot';
import { ReplayPlayer, ReplayRecorder, parseReplay, stateHash, verifyReplay, type Replay } from '../src/game/replay';
import { Simulation } from '../src/game/sim';
import { GamepadInput, heldDirection, type PadLike } from '../src/input/gamepad';
import { SWIPE_STEP, SwipeTracker, TAP_SLOP } from '../src/input/swipe';
import { REFERENCE_COMPOSITION, createReferenceScene, referenceScore } from '../src/game/reference';

/** Record a game the way main.ts does: optional title wait, then steering through the recorder. */
function recordGame(ticks: number, titleWait = 0, level = 1): { sim: Simulation; replay: Replay } {
  const sim = new Simulation({ seed: 0x1234abcd, level });
  sim.stepTicks(titleWait); // time on the title card (moves the power-on counter)
  sim.startNewGame();
  const rec = new ReplayRecorder();
  rec.begin(sim);
  let last: Dir | null = null;
  for (let i = 0; i < ticks && sim.phase !== 'gameover'; i++) {
    const d = autopilot(sim);
    if (d !== last) {
      rec.record(sim, d);
      sim.setDirection(d);
      last = d;
    }
    sim.step();
  }
  return { sim, replay: rec.snapshot(sim)! };
}

describe('replays', () => {
  it('reproduce a recorded game exactly, fruit timing included', () => {
    const { sim, replay } = recordGame(4000, 333);
    expect(sim.dotsEaten).toBeGreaterThan(170); // both fruits have appeared
    expect(replay.powerOnTicks).toBe(333);
    expect(verifyReplay(replay)).toBe(true);
    const player = new ReplayPlayer(replay);
    while (!player.done) player.step();
    expect(stateHash(player.sim)).toBe(stateHash(sim));
    expect(player.sim.score).toBe(sim.score);
  });

  it('survive a JSON round trip', () => {
    const { replay } = recordGame(1500);
    expect(verifyReplay(parseReplay(JSON.stringify(replay)))).toBe(true);
  });

  it('detect a replay that no longer reproduces its ending', () => {
    const { replay } = recordGame(1500);
    const tampered: Replay = { ...replay, inputs: replay.inputs.map(([t, d], i) => [t, (i === 3 ? (d + 1) % 4 : d) as Dir]) };
    expect(verifyReplay(tampered)).toBe(false);
  });

  it('can be saved mid-game, and record the starting level', () => {
    const { replay } = recordGame(600, 0, 5);
    expect(replay.startLevel).toBe(5);
    expect(replay.final.tick).toBe(600);
    expect(verifyReplay(replay)).toBe(true);
  });

  it('reject malformed files with a readable reason', () => {
    const good = JSON.stringify(recordGame(200).replay);
    const bad = (mutate: (r: Record<string, unknown>) => void): string => {
      const r = JSON.parse(good) as Record<string, unknown>;
      mutate(r);
      return JSON.stringify(r);
    };
    expect(() => parseReplay('{oops')).toThrow('not a JSON file');
    expect(() => parseReplay(bad((r) => (r.format = 'other')))).toThrow('not a Pac-Man replay');
    expect(() => parseReplay(bad((r) => (r.version = 9)))).toThrow('unsupported replay version');
    expect(() => parseReplay(bad((r) => (r.inputs = [[0, 7]])))).toThrow('bad replay input entry');
    expect(() => parseReplay(bad((r) => (r.inputs = [[5, 0], [2, 1]])))).toThrow('out of order');
    expect(() => parseReplay(bad((r) => (r.seed = -1)))).toThrow('bad replay header');
    expect(parseReplay(good).format).toBe('pacman-replay');
  });
});

const pad = (pressed: number[] = [], axes: number[] = [0, 0]): PadLike => ({
  connected: true,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
});

describe('gamepad', () => {
  it('maps the d-pad and the left stick (dominant axis, with a dead zone)', () => {
    expect([12, 14, 13, 15].map((b) => heldDirection(pad([b])))).toEqual([0, 1, 2, 3]);
    expect(heldDirection(pad([], [-0.9, 0.2]))).toBe(1);
    expect(heldDirection(pad([], [0.3, 0.8]))).toBe(2);
    expect(heldDirection(pad([], [0.3, -0.4]))).toBeNull();
    expect(heldDirection(pad([12], [0.9, 0]))).toBe(0); // d-pad wins
  });

  it('reports directions on change and buttons on press, like key presses', () => {
    const g = new GamepadInput();
    expect(g.poll([pad([12])]).dir).toBe(0);
    expect(g.poll([pad([12])]).dir).toBeNull(); // still held
    expect(g.poll([pad([])]).dir).toBeNull();
    expect(g.poll([pad([12])]).dir).toBe(0); // pressed again
    expect(g.poll([pad([9])]).start).toBe(true);
    expect(g.poll([pad([9])]).start).toBe(false);
    expect(g.poll([pad([0])]).start).toBe(false); // A straight after Start, no release in between: not a new press
    expect(g.poll([pad([])]).start).toBe(false);
    expect(g.poll([pad([0])]).start).toBe(true);
    expect(g.poll([pad([8])]).pause).toBe(true);
    expect(g.poll([pad([8])]).pause).toBe(false);
  });

  it('copes with no pad connected', () => {
    const g = new GamepadInput();
    expect(g.poll([null, null])).toEqual({ dir: null, start: false, pause: false });
    expect(g.poll(null)).toEqual({ dir: null, start: false, pause: false });
  });
});

describe('touch swipe', () => {
  it('steers repeatedly during one continuous drag, re-anchoring after each step', () => {
    const t = new SwipeTracker();
    t.start(100, 100);
    expect(t.move(110, 102)).toBeNull(); // not far enough yet
    expect(t.move(76, 101)).toBe(1); // left, 24 px from the anchor
    expect(t.move(70, 101)).toBeNull(); // re-anchored at 76
    expect(t.move(72, 70)).toBe(0); // then up, without lifting the finger
    expect(t.move(100, 72)).toBe(3); // then right
    expect(t.move(101, 100)).toBe(2); // then down
    expect(t.end(101, 100)).toBe(false); // a drag is never a tap
  });

  it('treats a short press as a tap, but not a wobble beyond the slop', () => {
    const t = new SwipeTracker();
    t.start(50, 50);
    expect(t.move(55, 53)).toBeNull();
    expect(t.end(55, 53)).toBe(true);
    t.start(50, 50);
    expect(t.end(50 + TAP_SLOP + 5, 50)).toBe(false);
    expect(t.active).toBe(false);
    expect(t.move(0, 0)).toBeNull(); // ignored when no press is active
    expect(SWIPE_STEP).toBe(24);
  });
});

describe('reference scene', () => {
  it('shows a score that its stated composition actually adds up to', () => {
    expect(referenceScore()).toBe(2610);
    const sim = createReferenceScene();
    expect(sim.score).toBe(2610);
    expect(sim.highScore).toBe(2610);
    const c = REFERENCE_COMPOSITION;
    const dotsLeft = sim.dots.reduce((a, b) => a + b, 0);
    const energizersLeft = sim.energizers.reduce((a, b) => a + b, 0);
    expect(240 - dotsLeft).toBe(c.dots);
    expect(4 - energizersLeft).toBe(c.energizers);
    expect(sim.dotsEaten).toBe(c.dots + c.energizers);
    // both cherries need 170 consumed items to have appeared
    expect(sim.dotsEaten).toBeGreaterThanOrEqual(170);
    // one ghost per energizer is a 200 each time; never more ghosts than energizers eaten
    expect(c.ghostScores.length).toBeLessThanOrEqual(c.energizers);
    expect(sim.lives - 1).toBe(2); // two reserve icons
  });
});
