import './style.css';
import { TICK_MS, type Dir } from './game/constants';
import { FixedStepClock } from './game/clock';
import { Simulation } from './game/sim';
import { createReferenceScene } from './game/reference';
import { GameRenderer } from './render/renderer';
import { Input } from './input/input';
import { AudioEngine } from './audio/audio';
import { sirenStage } from './audio/sfx';
import { autopilot } from './game/autopilot';
import { TICK_HZ } from './game/constants';
import { ReplayPlayer, ReplayRecorder, parseReplay, verifyReplay } from './game/replay';
import { GamepadInput } from './input/gamepad';
import { SwipeTracker } from './input/swipe';
import { loadHighScore, saveHighScore } from './storage';

const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
if (!canvas) throw new Error('missing #screen canvas');

const params = new URLSearchParams(window.location.search);
const isReference = params.get('scene') === 'reference';
const autostart = params.get('autostart') === '1';
const fixedScale = Number(params.get('scale') ?? '0');
/**
 * ?arcade=1 — strict arcade mode: no pausing (P or on losing focus), no restart
 * key and no debug overlay. Mute, touch and gamepad stay available.
 */
const arcade = params.get('arcade') === '1';
/** ?level=N starts every new game on level N (1..256), e.g. ?level=256 for the split screen. */
const startLevel = Number(params.get('level') ?? '1') || 1;

const sim: Simulation = isReference
  ? createReferenceScene()
  : new Simulation({ seed: 0x1234abcd, highScore: loadHighScore(), level: startLevel });

// ------------------------------------------------------------------ attract mode
// Title card -> demo game (driven by the autopilot) -> title card ..., until the
// player starts. The demo runs in its own Simulation and is silent.
const CARD_TICKS = Math.round(6 * TICK_HZ);
const DEMO_TICKS = Math.round(30 * TICK_HZ);
const GAMEOVER_TO_ATTRACT_TICKS = Math.round(4 * TICK_HZ);
const DEMO_SEED = 0xde300;
type AttractMode = 'off' | 'card' | 'demo' | 'replay';
let attract: AttractMode = 'off';
let attractTicks = 0;
let demoSim: Simulation | null = null;
let replayPlayer: ReplayPlayer | null = null;
let gameOverTicks = 0;
/** Ticks a finished replay stays on screen before returning to the title card. */
const REPLAY_HOLD_TICKS = Math.round(3 * TICK_HZ);

function enterAttract(): void {
  attract = 'card';
  attractTicks = 0;
  demoSim = null;
  replayPlayer = null;
  sim.phase = 'title';
}

function stepAttract(): void {
  attractTicks++;
  if (attract === 'card') {
    if (attractTicks >= CARD_TICKS) {
      demoSim = new Simulation({ seed: DEMO_SEED, highScore: sim.highScore });
      demoSim.startNewGame();
      attract = 'demo';
      attractTicks = 0;
    }
    return;
  }
  if (attract === 'replay' && replayPlayer) {
    if (!replayPlayer.done) {
      replayPlayer.step();
      replayPlayer.sim.highScore = sim.highScore; // watching a replay never moves the high score
      attractTicks = 0;
    } else if (attractTicks >= REPLAY_HOLD_TICKS) {
      setStatus(replayPlayer.matches() ? 'Replay finished: matched the recording.' : 'Replay finished.');
      enterAttract();
    }
    return;
  }
  if (attract === 'demo' && demoSim) {
    const livesBefore = demoSim.lives;
    demoSim.setDirection(autopilot(demoSim));
    demoSim.step();
    demoSim.highScore = sim.highScore; // the demo never moves the high score
    // The demo ends once its Pac-Man has lost a life, or after DEMO_TICKS.
    if (demoSim.lives < livesBefore || demoSim.phase === 'gameover' || attractTicks >= DEMO_TICKS) enterAttract();
  }
}

const renderer = new GameRenderer(canvas);
const audio = new AudioEngine();
if (Number.isFinite(fixedScale) && fixedScale > 0) renderer.setFixedScale(fixedScale);

let debug = !arcade && params.get('debug') === '1';
const recorder = new ReplayRecorder();
const gamepad = new GamepadInput();
let lastDotsEaten = sim.dotsEaten;
let lastScore = sim.score;
let lastGhostChain = sim.ghostChain;
let lastLives = sim.lives;
let lastPhase = sim.phase;
let audioStarted = false;

function ensureAudio(): void {
  if (isReference) return;
  audio.ensure();
  if (!audioStarted) {
    audioStarted = true;
    // First interaction during the opening READY: play the start tune now.
    if (sim.phase === 'ready' && sim.score === 0) audio.startJingle();
  }
}

/** Every new game (Enter after game over, or R) opens with the start tune. */
function newGameAudio(): void {
  audio.reset();
  audio.startJingle();
}

/** Start a fresh game (from the title card, after game over, or the restart key). */
function beginGame(): void {
  attract = 'off';
  demoSim = null;
  replayPlayer = null;
  gameOverTicks = 0;
  sim.startNewGame();
  recorder.begin(sim);
  newGameAudio();
  lastDotsEaten = sim.dotsEaten;
  lastScore = sim.score;
  lastGhostChain = 0;
  lastLives = sim.lives;
  lastPhase = sim.phase;
}

function startGame(): void {
  if (isReference) return;
  ensureAudio();
  if (sim.phase === 'title' || sim.phase === 'gameover') beginGame();
}

/** Every steering input (keys, swipe, gamepad) goes through here so replays capture it. */
function steer(dir: Dir): void {
  if (attract !== 'off' || isReference) return;
  recorder.record(sim, dir);
  sim.setDirection(dir);
}

function togglePause(): void {
  if (isReference || arcade) return;
  ensureAudio();
  sim.togglePause();
}

function toggleMute(): void {
  audio.ensure();
  audio.toggleMute();
}

function restart(): void {
  if (isReference || arcade) return;
  ensureAudio();
  beginGame();
}

function toggleDebug(): void {
  if (!arcade) debug = !debug;
}

const input = new Input(
  {
    onDirection: (dir: Dir) => {
      ensureAudio();
      steer(dir);
    },
    onStart: () => startGame(),
    onPause: () => togglePause(),
    onMute: () => toggleMute(),
    onRestart: () => restart(),
    onDebug: () => toggleDebug(),
    onBlur: () => {
      if (isReference || arcade) return;
      if (sim.phase === 'playing' || sim.phase === 'ready') {
        sim.paused = true;
      }
    },
  },
  canvas,
);

function updateAudio(): void {
  if (isReference) return;

  if (sim.dotsEaten > lastDotsEaten) audio.chomp();
  lastDotsEaten = sim.dotsEaten;

  const chainGrew = sim.ghostChain > lastGhostChain;
  if (chainGrew) audio.eatGhost();
  lastGhostChain = sim.ghostChain;

  if (sim.lives > lastLives) audio.extraLife();
  lastLives = sim.lives;

  if (sim.score > lastScore) {
    const gained = sim.score - lastScore;
    if (!chainGrew && gained >= 100) audio.eatFruit();
  }
  lastScore = sim.score;

  if (sim.phase === 'dying' && lastPhase !== 'dying') audio.death();
  if (sim.phase === 'gameover' && lastPhase !== 'gameover' && !isReference) {
    audio.gameOver();
    saveHighScore(sim.score);
  }
  lastPhase = sim.phase;

  // Background loop, by priority: eyes heading home > frightened > siren.
  if (sim.phase !== 'playing') audio.setLoop('off');
  else if (sim.ghosts.some((g) => g.lifecycle === 'eaten' || g.lifecycle === 'entering')) audio.setLoop('eyes');
  else if (sim.frightTicks > 0) audio.setLoop('fright');
  else audio.setLoop('siren', sirenStage(sim.dotsEaten));
}

window.addEventListener('beforeunload', () => {
  if (!isReference) saveHighScore(sim.score);
});
/** Size the frame to whatever room the (possibly wrapping) bars below it leave. */
function fitToPage(): void {
  const bars = ['controls', 'replay-bar'].map((id) => document.getElementById(id)?.offsetHeight ?? 0);
  renderer.setReservedHeight(bars[0] + bars[1] + 3 * 8 + 16); // bars + #app gaps + margin
  renderer.resize();
}
window.addEventListener('resize', fitToPage);
fitToPage();

// Default: attract mode (title card and demo); Enter or a tap starts a normal
// new game. ?autostart=1 goes straight into a new game.
if (!isReference) {
  if (autostart) {
    beginGame();
  } else {
    enterAttract();
  }
}

/** One simulation tick: the real game, plus the attract sequence while it is running. */
function tickOnce(): void {
  sim.step();
  if (attract !== 'off') {
    stepAttract();
  } else {
    updateAudio();
    if (sim.phase === 'gameover' && !isReference) {
      if (++gameOverTicks >= GAMEOVER_TO_ATTRACT_TICKS) {
        gameOverTicks = 0;
        enterAttract();
      }
    }
  }
  audio.tick();
}

const clock = new FixedStepClock(TICK_MS, 8);
let fps = 60;
let lastFrame = performance.now();
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(now - last, 100);
  last = now;
  // Audio runs in lock-step with the simulation: one register frame per tick.
  pollGamepad();
  fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
  lastFrame = now;
  updateButtons();
  if (!sim.frozen && !sim.paused) {
    clock.advance(dt, tickOnce);
  }
  if (attract === 'demo' && demoSim) renderer.render(demoSim, { debug: false, label: 'DEMO' });
  else if (attract === 'replay' && replayPlayer) renderer.render(replayPlayer.sim, { debug: false, label: 'REPLAY' });
  else renderer.render(sim, { debug, fps });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Touch: drag to steer (continuously: each 24 px of travel is a new swipe, so one
// drag can take several corners), tap to start a game or resume a paused one.
const swipe = new SwipeTracker();
let swipeId = -1;
canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  swipeId = e.pointerId;
  swipe.start(e.clientX, e.clientY);
  if (e.pointerType !== 'mouse') {
    try {
      canvas.setPointerCapture(e.pointerId); // keep the drag even if the finger leaves the canvas
    } catch {
      /* pointer already gone: steering still works while it stays over the canvas */
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== swipeId || e.pointerType === 'mouse') return;
  const dir = swipe.move(e.clientX, e.clientY);
  if (dir !== null) steer(dir);
});
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerId !== swipeId) return;
  swipeId = -1;
  if (!swipe.end(e.clientX, e.clientY)) return;
  if (sim.paused) togglePause();
  else startGame();
});
canvas.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== swipeId) return;
  swipeId = -1;
  swipe.end(Number.NaN, Number.NaN);
});

// ---------------------------------------------------------------- page buttons
// Pause / Mute / Restart / Debug, outside the game frame, mirroring P / M / R / `.
const pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement | null;
const muteBtn = document.getElementById('btn-mute') as HTMLButtonElement | null;
const restartBtn = document.getElementById('btn-restart') as HTMLButtonElement | null;
const debugBtn = document.getElementById('btn-debug') as HTMLButtonElement | null;
function onButton(btn: HTMLButtonElement | null, action: () => void): void {
  btn?.addEventListener('click', () => {
    action();
    btn.blur(); // keep Enter/Space for the game
    updateButtons();
  });
}
onButton(pauseBtn, togglePause);
onButton(muteBtn, toggleMute);
onButton(restartBtn, restart);
onButton(debugBtn, toggleDebug);

let buttonSig = '';
let wasPaused = false;
/** Keep button labels in step with the real state (keys change it too). */
function updateButtons(): void {
  const sig = `${sim.paused}|${audio.isMuted}|${debug}`;
  if (sig === buttonSig) return;
  buttonSig = sig;
  if (pauseBtn) pauseBtn.textContent = sim.paused ? 'Resume' : 'Pause';
  if (muteBtn) {
    muteBtn.textContent = audio.isMuted ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-pressed', String(audio.isMuted));
  }
  debugBtn?.setAttribute('aria-pressed', String(debug));
  if (sim.paused && !wasPaused) setStatus('Paused: tap the game, press P or Resume to continue.');
  if (!sim.paused && wasPaused) setStatus('');
  wasPaused = sim.paused;
}

// ---------------------------------------------------------------------- gamepad
function pollGamepad(): void {
  if (isReference || typeof navigator.getGamepads !== 'function') return;
  const ev = gamepad.poll(navigator.getGamepads());
  if (ev.dir !== null) {
    ensureAudio();
    steer(ev.dir);
  }
  if (ev.start) startGame();
  if (ev.pause) togglePause();
}

// ----------------------------------------------------------------------- replays
// Controls outside the game frame: save the current / last game, or load one and
// watch it play back (silently, labelled REPLAY).
const statusEl = document.getElementById('status');
function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function saveReplay(): void {
  const replay = recorder.snapshot(sim);
  if (!replay) {
    setStatus('Play a game first, then save its replay.');
    return;
  }
  const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pacman-replay-${replay.final.score}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus(`Replay saved (${replay.final.score} points, ${replay.inputs.length} inputs).`);
}

async function loadReplay(file: File): Promise<void> {
  if (isReference) return;
  if (attract === 'off' && sim.phase !== 'gameover' && sim.phase !== 'title') {
    setStatus('Finish the current game before loading a replay.');
    return;
  }
  try {
    const replay = parseReplay(await file.text());
    const ok = verifyReplay(replay);
    sim.paused = false;
    enterAttract();
    replayPlayer = new ReplayPlayer(replay);
    attract = 'replay';
    attractTicks = 0;
    setStatus(
      ok
        ? `Playing replay: ${replay.final.score} points, verified.`
        : 'Playing replay, but it does not reproduce its recorded ending (made with a different game version?).',
    );
  } catch (err) {
    setStatus(`Could not load replay: ${(err as Error).message}.`);
  }
}

const saveBtn = document.getElementById('save-replay') as HTMLButtonElement | null;
const loadInput = document.getElementById('load-replay') as HTMLInputElement | null;
saveBtn?.addEventListener('click', () => {
  saveReplay();
  saveBtn.blur(); // keep Enter/Space for the game
});
loadInput?.addEventListener('change', () => {
  const file = loadInput.files?.[0];
  loadInput.value = '';
  loadInput.blur();
  if (file) void loadReplay(file);
});
if (arcade) document.body.classList.add('arcade');

void input;

// Debug / automation hook (also used by the visual checks): access to the live
// simulation and renderer, plus deterministic stepping via advance().
(window as unknown as { __pacman?: unknown }).__pacman = {
  sim,
  renderer,
  audio,
  get debug(): boolean {
    return debug;
  },
  get attract(): string {
    return attract;
  },
  get demo(): Simulation | null {
    return demoSim;
  },
  get replay(): ReplayPlayer | null {
    return replayPlayer;
  },
  /** the replay of the current / last game, as saved by "Save replay" */
  currentReplay: () => recorder.snapshot(sim),
  loadReplayText: (text: string) => loadReplay(new File([text], 'replay.json')),
  arcade,
  /** Deterministic stepping for automation: run `ticks` full game ticks now (attract logic included). */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) tickOnce();
  },
};