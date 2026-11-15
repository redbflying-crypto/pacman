/**
 * Touch steering. A swipe steers as soon as the finger has travelled far
 * enough, then re-anchors at the current point, so one continuous drag can
 * steer round several corners without lifting the finger (and turns can be
 * buffered ahead of an intersection). A short press with no swipe is a tap.
 */
import type { Dir } from '../game/constants';

/** Finger travel (CSS px) that counts as a swipe step. */
export const SWIPE_STEP = 24;
/** Maximum travel for a press to still count as a tap. */
export const TAP_SLOP = 12;

export class SwipeTracker {
  private anchor: { x: number; y: number } | null = null;
  private origin: { x: number; y: number } | null = null;
  private swiped = false;

  start(x: number, y: number): void {
    this.anchor = { x, y };
    this.origin = { x, y };
    this.swiped = false;
  }

  /** Returns a direction when the drag since the anchor crosses SWIPE_STEP. */
  move(x: number, y: number): Dir | null {
    if (!this.anchor) return null;
    const dx = x - this.anchor.x;
    const dy = y - this.anchor.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_STEP) return null;
    this.anchor = { x, y };
    this.swiped = true;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 3 : 1;
    return dy > 0 ? 2 : 0;
  }

  /** Ends the press; true when it was a tap (no swipe, little travel). */
  end(x: number, y: number): boolean {
    const o = this.origin;
    const tap = !!o && !this.swiped && Math.hypot(x - o.x, y - o.y) <= TAP_SLOP;
    this.anchor = this.origin = null;
    return tap;
  }

  get active(): boolean {
    return this.anchor !== null;
  }
}
