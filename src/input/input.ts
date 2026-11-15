/**
 * Keyboard input. Gameplay keys are prevented from scrolling the page while
 * the game has focus; page visibility changes pause the simulation.
 */
import type { Dir } from '../game/constants';

export interface InputHandlers {
  onDirection: (dir: Dir) => void;
  onStart: () => void;
  onPause: () => void;
  onMute: () => void;
  onRestart: () => void;
  onDebug: () => void;
  onBlur: () => void;
}

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 0,
  ArrowLeft: 1,
  ArrowDown: 2,
  ArrowRight: 3,
  KeyW: 0,
  KeyA: 1,
  KeyS: 2,
  KeyD: 3,
};

export class Input {
  private readonly handlers: InputHandlers;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  private readonly onVisibility: () => void;
  private readonly onPointer: (e: PointerEvent) => void;

  constructor(handlers: InputHandlers, private readonly surface: HTMLElement) {
    this.handlers = handlers;
    this.onKeyDown = (e) => this.handleKey(e);
    this.onBlur = () => this.handlers.onBlur();
    this.onVisibility = () => {
      if (document.hidden) this.handlers.onBlur();
    };
    this.onPointer = () => this.handlers.onStart();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    surface.addEventListener('pointerdown', this.onPointer);
  }

  private handleKey(e: KeyboardEvent): void {
    const dir = KEY_DIRS[e.code];
    if (dir !== undefined) {
      e.preventDefault();
      this.handlers.onDirection(dir);
      return;
    }
    switch (e.code) {
      case 'Enter':
      case 'Space':
      case 'NumpadEnter':
        // Leave Enter/Space to page controls (Save / Load replay) when they have focus.
        if (e.target instanceof Element && e.target.closest('button, input, label, a, select, textarea')) return;
        e.preventDefault();
        this.handlers.onStart();
        break;
      case 'KeyP':
        e.preventDefault();
        this.handlers.onPause();
        break;
      case 'KeyM':
        e.preventDefault();
        this.handlers.onMute();
        break;
      case 'KeyR':
        e.preventDefault();
        this.handlers.onRestart();
        break;
      case 'Backquote':
      case 'F1':
        e.preventDefault();
        this.handlers.onDebug();
        break;
      default:
        break;
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.surface.removeEventListener('pointerdown', this.onPointer);
  }
}