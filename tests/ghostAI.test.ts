import { describe, expect, it } from 'vitest';
import { DOWN, LEFT, RIGHT, UP } from '../src/game/constants';
import {
  SCATTER_TARGETS,
  chooseDirection,
  clydeTarget,
  inkyTarget,
  pinkyTarget,
} from '../src/game/ghostAI';
import { Tile, tileAt } from '../src/game/maze';

const legal = (col: number, row: number) => {
  const t = tileAt(col, row);
  return t !== Tile.Wall && t !== Tile.Void;
};

describe('ghost target tiles', () => {
  it('Blinky targets Pac-Man directly (chase)', () => {
    const t = SCATTER_TARGETS.blinky;
    expect(t).toEqual({ col: 25, row: -3 });
  });

  it('Pinky targets four tiles ahead in each direction', () => {
    expect(pinkyTarget(10, 10, LEFT)).toEqual({ col: 6, row: 10 });
    expect(pinkyTarget(10, 10, RIGHT)).toEqual({ col: 14, row: 10 });
    expect(pinkyTarget(10, 10, DOWN)).toEqual({ col: 10, row: 14 });
  });

  it('Pinky reproduces the upward overflow quirk (4 up AND 4 left)', () => {
    expect(pinkyTarget(10, 10, UP)).toEqual({ col: 6, row: 6 });
  });

  it('Inky uses 2A - B with Blinky as B', () => {
    // Pac-Man at (10,10) facing right, Blinky at (4,10): A = (12,10), target = (20,10)
    expect(inkyTarget(10, 10, RIGHT, { col: 4, row: 10 })).toEqual({ col: 20, row: 10 });
    // facing left, Blinky at (16,10): A = (8,10), target = (0,10)
    expect(inkyTarget(10, 10, LEFT, { col: 16, row: 10 })).toEqual({ col: 0, row: 10 });
    // facing down
    expect(inkyTarget(10, 10, DOWN, { col: 10, row: 2 })).toEqual({ col: 10, row: 22 });
  });

  it('Inky reproduces the upward overflow quirk (2 up AND 2 left)', () => {
    // A = (8,8), B = (10,10) -> target = (6,6)
    expect(inkyTarget(10, 10, UP, { col: 10, row: 10 })).toEqual({ col: 6, row: 6 });
  });

  it('Clyde uses Pac-Man at squared distance >= 64, otherwise his corner', () => {
    const scatter = SCATTER_TARGETS.clyde;
    const pac = { col: 10, row: 10 };
    // exactly 8 tiles away (64) -> chase
    expect(clydeTarget({ col: 18, row: 10 }, pac, scatter)).toEqual(pac);
    expect(clydeTarget({ col: 10, row: 2 }, pac, scatter)).toEqual(pac);
    // 7 tiles away (49) -> scatter
    expect(clydeTarget({ col: 17, row: 10 }, pac, scatter)).toEqual(scatter);
    // diagonal 7/7 -> 98 >= 64 -> chase
    expect(clydeTarget({ col: 17, row: 17 }, pac, scatter)).toEqual(pac);
  });

  it('scatter corners are outside the maze (upper-right, upper-left, lower-right, lower-left)', () => {
    expect(SCATTER_TARGETS.blinky.col).toBeGreaterThan(20);
    expect(SCATTER_TARGETS.blinky.row).toBeLessThan(0);
    expect(SCATTER_TARGETS.pinky.col).toBeLessThan(5);
    expect(SCATTER_TARGETS.pinky.row).toBeLessThan(0);
    expect(SCATTER_TARGETS.inky.col).toBeGreaterThan(20);
    expect(SCATTER_TARGETS.inky.row).toBeGreaterThan(30);
    expect(SCATTER_TARGETS.clyde.col).toBeLessThan(5);
    expect(SCATTER_TARGETS.clyde.row).toBeGreaterThan(30);
  });
});

describe('ghost route choice', () => {
  it('never chooses the reverse direction', () => {
    // A vertical corridor tile: only up/down are legal; moving up must continue up.
    for (let row = 2; row <= 28; row++) {
      const d = chooseDirection({
        col: 6,
        row,
        dir: UP,
        target: { col: 6, row: row - 1 },
        allowDoor: false,
        allowHouse: false,
        applyNoUp: true,
        frightened: false,
        rng: () => 0,
      });
      expect(d).not.toBe(DOWN);
    }
  });

  it('breaks distance ties up, then left, then down, then right', () => {
    // At (12,11) moving up, (12,10) and (11,11) are both one tile from the
    // target (11,10): up must win the tie.
    const d = chooseDirection({
      col: 12,
      row: 11,
      dir: UP,
      target: { col: 11, row: 10 },
      allowDoor: false,
      allowHouse: false,
      applyNoUp: false,
      frightened: false,
      rng: () => 0,
    });
    expect(d).toBe(UP);
  });

  it('picks the strictly closest test tile', () => {
    // At (12,22) moving right, down (12,23) is the target and up (12,21) is
    // farther away; down must win (left is excluded as the reverse).
    const d = chooseDirection({
      col: 12,
      row: 22,
      dir: RIGHT,
      target: { col: 12, row: 23 },
      allowDoor: false,
      allowHouse: false,
      applyNoUp: false,
      frightened: false,
      rng: () => 0,
    });
    expect(d).toBe(DOWN);
  });

  it('applies the no-up-turn restriction only in scatter/chase', () => {
    // (12,11) is one of the four restricted tiles. Entering it while moving left,
    // the up exit must be rejected when applyNoUp is set.
    const withRestriction = chooseDirection({
      col: 12,
      row: 11,
      dir: LEFT,
      target: { col: 12, row: 0 },
      allowDoor: false,
      allowHouse: false,
      applyNoUp: true,
      frightened: false,
      rng: () => 0,
    });
    expect(withRestriction).not.toBe(UP);

    const withoutRestriction = chooseDirection({
      col: 12,
      row: 11,
      dir: LEFT,
      target: { col: 12, row: 0 },
      allowDoor: false,
      allowHouse: false,
      applyNoUp: false,
      frightened: false,
      rng: () => 0,
    });
    expect(withoutRestriction).toBe(UP);
  });

  it('frightened ghosts pick a pseudo-random legal direction deterministically', () => {
    const a = chooseDirection({
      col: 13,
      row: 11,
      dir: LEFT,
      target: { col: 0, row: 0 },
      allowDoor: false,
      allowHouse: false,
      applyNoUp: true,
      frightened: true,
      rng: () => 0.1,
    });
    const b = chooseDirection({
      col: 13,
      row: 11,
      dir: LEFT,
      target: { col: 0, row: 0 },
      allowDoor: false,
      allowHouse: false,
      applyNoUp: true,
      frightened: true,
      rng: () => 0.1,
    });
    expect(a).toBe(b);
    expect(legal(13 + (a === LEFT ? -1 : a === RIGHT ? 1 : 0), 11 + (a === UP ? -1 : a === DOWN ? 1 : 0))).toBe(true);
  });
});