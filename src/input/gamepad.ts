/**
 * Gamepad support (standard mapping): d-pad or left stick to steer, Start or A
 * to start, Back/Select to pause. Polled once per animation frame. Directions
 * are reported when they change, matching a key press; buttons on press only.
 */
import type { Dir } from '../game/constants';

/** The parts of the Gamepad API we read (so tests can pass plain objects). */
export interface PadLike {
  connected?: boolean;
  buttons: ReadonlyArray<{ pressed: boolean }>;
  axes: ReadonlyArray<number>;
}

export interface PadEvents {
  dir: Dir | null;
  start: boolean;
  pause: boolean;
}

const STICK_DEADZONE = 0.5;
// Standard mapping button indices.
const BTN_A = 0;
const BTN_BACK = 8;
const BTN_START = 9;
const DPAD: ReadonlyArray<[number, Dir]> = [
  [12, 0], // up
  [14, 1], // left
  [13, 2], // down
  [15, 3], // right
];

/** Direction currently held on a pad: d-pad first, else the stick's dominant axis. */
export function heldDirection(pad: PadLike): Dir | null {
  for (const [button, dir] of DPAD) if (pad.buttons[button]?.pressed) return dir;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < STICK_DEADZONE) return null;
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 1 : 3;
  return y < 0 ? 0 : 2;
}

export class GamepadInput {
  private lastDir: Dir | null = null;
  private lastStart = false;
  private lastPause = false;

  /** Read the first connected pad and report what changed since the last poll. */
  poll(pads: ReadonlyArray<PadLike | null> | null | undefined): PadEvents {
    const pad = pads ? (pads.find((p) => p && p.connected !== false) ?? null) : null;
    if (!pad) {
      this.lastDir = null;
      this.lastStart = this.lastPause = false;
      return { dir: null, start: false, pause: false };
    }
    const held = heldDirection(pad);
    const dir = held !== null && held !== this.lastDir ? held : null;
    this.lastDir = held;

    const startDown = !!(pad.buttons[BTN_START]?.pressed || pad.buttons[BTN_A]?.pressed);
    const pauseDown = !!pad.buttons[BTN_BACK]?.pressed;
    const events = { dir, start: startDown && !this.lastStart, pause: pauseDown && !this.lastPause };
    this.lastStart = startDown;
    this.lastPause = pauseDown;
    return events;
  }
}
