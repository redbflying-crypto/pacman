/**
 * Attract-mode autopilot: steers Pac-Man for the demo game. Each tick it does
 * a breadth-first search from Pac-Man's tile to the nearest dot (or a blue
 * ghost worth chasing), treating tiles close to a dangerous ghost as blocked;
 * when no safe path exists it steps to the neighbour farthest from danger.
 * Purely a function of the simulation state, so the demo replays identically.
 */
import { DIR_VEC, MAZE_COLS, MAZE_ROWS, TUNNEL_ROW, type Dir } from './constants';
import { idx, pacWalkable } from './maze';
import type { Simulation } from './sim';

const ORDER: readonly Dir[] = [0, 1, 2, 3]; // up, left, down, right
/** Tiles within this Manhattan distance of a dangerous ghost are avoided. */
const DANGER_RADIUS = 3;
/** Frightened ghosts stop being prey this many ticks before fright ends. */
const FRIGHT_MARGIN = 90;

function neighbour(col: number, row: number, d: Dir): [number, number] {
  const [dx, dy] = DIR_VEC[d];
  let c = col + dx;
  const r = row + dy;
  if (r === TUNNEL_ROW) c = (c + MAZE_COLS) % MAZE_COLS;
  return [c, r];
}

export function autopilot(sim: Simulation): Dir {
  const layout = sim.layout;
  const start = sim.pacTile();
  const preyTime = sim.frightTicks > FRIGHT_MARGIN;

  const danger = new Uint8Array(MAZE_COLS * MAZE_ROWS);
  const dangerTiles: Array<[number, number]> = [];
  const prey = new Uint8Array(MAZE_COLS * MAZE_ROWS);
  for (const g of sim.ghosts) {
    if (g.lifecycle !== 'out' && g.lifecycle !== 'exiting') continue;
    const gc = Math.floor(g.x / 128);
    const gr = Math.floor(g.y / 128);
    if (g.frightened && preyTime) {
      if (gc >= 0 && gc < MAZE_COLS && gr >= 0 && gr < MAZE_ROWS) prey[idx(gc, gr)] = 1;
      continue;
    }
    dangerTiles.push([gc, gr]);
    for (let dr = -DANGER_RADIUS; dr <= DANGER_RADIUS; dr++) {
      for (let dc = -DANGER_RADIUS; dc <= DANGER_RADIUS; dc++) {
        if (Math.abs(dc) + Math.abs(dr) > DANGER_RADIUS) continue;
        const c = gc + dc;
        const r = gr + dr;
        if (c >= 0 && c < MAZE_COLS && r >= 0 && r < MAZE_ROWS) danger[idx(c, r)] = 1;
      }
    }
  }

  // BFS for the nearest food / prey over safe tiles; remember each tile's first move.
  const firstMove = new Int8Array(MAZE_COLS * MAZE_ROWS).fill(-1);
  const seen = new Uint8Array(MAZE_COLS * MAZE_ROWS);
  const queue: number[] = [];
  if (start.col >= 0 && start.col < MAZE_COLS) {
    seen[idx(start.col, start.row)] = 1;
    queue.push(idx(start.col, start.row));
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const col = i % MAZE_COLS;
    const row = (i / MAZE_COLS) | 0;
    for (const d of ORDER) {
      const [c, r] = neighbour(col, row, d);
      if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS) continue;
      const n = idx(c, r);
      if (seen[n] || danger[n] || !pacWalkable(c, r, layout)) continue;
      seen[n] = 1;
      firstMove[n] = head === 0 ? d : firstMove[i];
      if (sim.dots[n] || sim.energizers[n] || prey[n]) return firstMove[n] as Dir;
      queue.push(n);
    }
  }

  // No safe target: step to the open neighbour farthest from the nearest danger.
  let best: Dir = sim.pac.dir;
  let bestScore = -1;
  for (const d of ORDER) {
    const [c, r] = neighbour(start.col, start.row, d);
    if (!pacWalkable(c, r, layout)) continue;
    let nearest = Infinity;
    for (const [gc, gr] of dangerTiles) nearest = Math.min(nearest, Math.abs(gc - c) + Math.abs(gr - r));
    if (nearest > bestScore) {
      bestScore = nearest;
      best = d;
    }
  }
  return best;
}
