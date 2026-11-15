/** Local high-score persistence. The reference scene never writes here. */
const KEY = 'pacman.highscore.v1';

export function loadHighScore(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(score: number): void {
  try {
    const current = loadHighScore();
    if (score > current) window.localStorage.setItem(KEY, String(Math.floor(score)));
  } catch {
    /* storage unavailable (private mode) */
  }
}