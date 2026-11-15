# Pac-Man — arcade reconstruction (Three.js)

A deterministic, playable recreation of the 1980 Namco/Midway arcade **Pac-Man**, rendered with
Three.js. The simulation follows the rules documented in *The Pac-Man Dossier*; the presentation is
flat, top-down, orthographic and pixel-crisp.

- Logical resolution **224 × 288**, rendered into a 224 × 288 render target and presented with
  nearest-neighbour scaling at an integer scale (letterboxed with black).
- Maze **28 × 31 tiles** at screen y = 24, exactly **240 dots + 4 energizers** (verified by tests).
- Fixed-step simulation at the hardware cadence **60.606061 Hz**, integer fixed-point positions
  (16 sub-pixels per logical pixel), seeded PRNG — no float drift, deterministic replays.
- Locally generated art and audio: no remote assets, no ROMs, no backend.

## Commands

```bash
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm test           # Vitest (118 tests)
npm run typecheck  # tsc --noEmit
```

Node 20.19+ / 22.12+ is required by Vite 8.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Move (four-way, buffered turns, instant reversal) |
| Enter / Space | Start a game from the title card or demo / restart after game over |
| P | Pause / resume |
| M | Mute / unmute |
| R | Restart a new game |
| ` (backtick) or F1 | Toggle the debug overlay |
| Drag / tap (touch) | Steer (one continuous drag can take several corners: every 24 px of travel is a new swipe) / tap to start, or to resume when paused |
| Buttons below the frame | Pause / Mute / Restart / Debug (same as P / M / R / `), Save / Load replay |
| Gamepad (standard mapping) | D-pad or left stick to steer, Start or A to start, Back/Select to pause |

Gameplay keys are prevented from scrolling the page (Enter/Space still work on the page buttons when
those have focus). The game pauses on window blur or when the tab is hidden.

## Replays

Every game is recorded as a small JSON file: the seed, starting level, power-on tick and each
steering input with the tick it arrived on, plus a hash of the final state. Below the game frame,
**Save replay** downloads the current or last game; **Load replay** plays one back in the frame
(silent, labelled REPLAY) after checking headlessly that it reproduces its recorded ending, and says
so if it does not (for example, a replay made with an earlier version of the rules). Replays can
be loaded from the title card or after a game over, not mid-game.

## Modes and URL options

| URL | Effect |
| --- | --- |
| `/` | Attract mode (title card, then a demo game); Enter / tap starts a normal new game (level 1, 3 lives, score 0) |
| `/?autostart=1` | Skip attract mode and start a new game immediately |
| `/?arcade=1` | Strict arcade mode: no pausing (P or on losing focus), no restart key, no debug overlay |
| `/?level=N` | Every new game starts on level N (1–256), e.g. `?level=256&autostart=1` for the split screen |
| `/?scene=reference` | **Frozen reference scene**: score 2610, high score 2610, two reserve lives, level-1 cherry, partially eaten maze |
| `/?scene=reference&debug=1` | Reference scene with the debug overlay |
| `/?debug=1` | Normal game with the debug overlay |

The debug overlay draws the tile grid, actor centres, current/queued directions, ghost target tiles,
scatter/chase timer, frightened time, house counters, global counter, Cruise Elroy state and the
remaining consumable count. It is disabled by default and never appears in the normal view.

For automation, `window.__pacman` exposes the live `sim`, `renderer`, `audio`, the attract state
(`attract`, `demo`) and `advance(n)`, which runs n full game ticks immediately (deterministic
stepping, independent of the browser's frame rate).

## Architecture

```
src/
  game/
    constants.ts   timing, geometry, palette, fixed-point helpers
    types.ts       state shapes (Pac-Man, ghosts, fruit, popups, snapshot)
    maze.ts        static maze data, walkability, coordinate conversion, validation
    levels.ts      Table A.1 level specification, scatter/chase schedule, fruit table
    movement.ts    pure movement helpers: pixel-step patterns, turn window, tunnel wrap
    ghostAI.ts     target tiles (Blinky/Pinky/Inky/Clyde), route choice, no-up-turn zones
    rng.ts         seeded mulberry32 PRNG
    sim.ts         deterministic fixed-step simulation, state machine, house/Elroy rules
    clock.ts       fixed-step accumulator shared by the loop and tests
    reference.ts   frozen reference-scene construction
    cutscenes.ts   intermission schedule and the three (original) cutscenes, as pure data
    splitScreen.ts level-256 split-screen layout
    autopilot.ts   deterministic demo-game driver for attract mode
    replay.ts      replay recording, verification (final-state hash) and playback
  render/
    pixel.ts       RGBA pixel buffer
    art.ts         procedural inset maze walls, sprites, 8×8 HUD font, dots
    renderer.ts    Three.js orthographic renderer, 224×288 target, nearest blit
  input/input.ts   keyboard/pointer input
  input/gamepad.ts gamepad polling (standard mapping), pure mapping logic
  input/swipe.ts   continuous-drag touch steering and tap detection
  audio/
    wsg.ts         3-voice wavetable synth (own 32-sample 4-bit waveforms), tick-paced
    sfx.ts         sound sequencer: per-tick frame programs for every effect and loop
    wsg.worklet.ts AudioWorklet host (ScriptProcessor fallback in audio.ts)
    audio.ts       engine: one node per page, tick() once per simulation step
  storage.ts       local high score
  main.ts          bootstrap, loop, audio triggers, debug hook
tests/             Vitest suites (maze, ghost AI, simulation, art/font, audio, phase 5 features)
```

Gameplay logic never touches Three.js: the simulation is a pure integer state machine, and the
renderer only reads it.

### Coordinate conventions

| Space | Definition |
| --- | --- |
| Logical pixel | 224 × 288 screen, origin top-left, +x right, +y down |
| Tile | 8 × 8 logical pixels; 28 × 36 full screen, 28 × 31 maze |
| Maze-local pixel | logical pixel minus `MAZE_OFFSET_Y = 24` |
| Sub-pixel | 1/16 logical pixel; all positions/speeds are integers |
| Three.js world | 1 unit = 1 logical pixel, origin at screen top-left (camera at 112,144) |

## Rules implemented

- **Movement:** actors move in whole logical pixels; each speed percentage becomes an even
  pattern of one-pixel steps per 16 ticks (100% = 20 px / 16 ticks), so averages are exact.
  Four-way buffered input, immediate reversal, stop on the tile centre when facing a wall.
- **Cornering (Dossier):** Pac-Man may turn 3 px before / 4 px after a tile centre when moving
  right or down, and 4 before / 3 after when moving left or up. Each corner step moves one pixel
  in the new direction and one toward the new centreline (45°), so early turns gain a tick per
  pixel. Ghosts never cut corners: they decide one tile ahead and turn exactly on tile centres.
- **Tunnel:** the tunnel row continues past both screen edges; Pac-Man and ghosts wrap at
  x < 0 / x ≥ 224.
- **Eating pauses:** 1 tick per dot, 3 ticks per energizer (no separate "dots speed" reduction, so
  the slowdown is not double-counted).
- **Ghosts:** one-tile-ahead decisions, squared-Euclidean distance, up/left/down/right tie-break,
  no reverse, Pinky/Inky upward overflow quirks, Clyde's 8-tile threshold, the four no-up-turn tiles
  (scatter/chase only), scatter targets outside the maze, eyes returning to the house.
- **Modes:** the documented scatter/chase schedule per level, reversal on scatter↔chase and on
  energizer entry, frightened pause of the schedule, no reversal on frightened expiry.
- **Frightened:** 50 points, 200/400/800/1600 chain, level durations and flash counts from Table A.1
  (level 17: none, level 18: 1 s, level 19+: none), tunnel slow-down. Frightened ghosts pick a
  pseudo-random first direction and fall back clockwise; the generator restarts from the same seed
  every level and every life and advances only at frightened decisions, so patterns repeat (Dossier).
- **House:** Pinky/Inky/Clyde personal dot counters (0/30/60 on level 1, 0/0/50 on level 2, 0/0/0
  from level 3), post-death global counter (7/17/32), inactivity timeout (4 s, 3 s from level 5).
  Revived Blinky leaves at once; revived Pinky/Inky/Clyde obey the counters and timer (so the
  Dossier's "trap the ghosts" trick works). Waiting ghosts bob in their slots; a released ghost
  levels off, slides to the door column and walks out. Exits are independent, so several ghosts
  can leave at once. Ghosts walking out turn blue on an energizer and can be caught in the doorway.
- **Ghost bug (Dossier Appendix B):** a ghost eaten while still exiting through the door drops
  straight back into the pen as eyes, revives, and climbs straight up through the maze walls,
  wrapping from the top of the maze to the bottom until it is back in the pen.
- **Cruise Elroy:** two thresholds and speeds per level; Elroy targets Pac-Man during scatter;
  suspended after a death until Clyde leaves.
- **Fruit:** at 70 and 170 consumed items, below the house, 9–10 s lifetime that a pattern cannot predict (driven by a power-on tick counter
  that also runs on the title screen), correct values
  (cherry 100 → key 5000), score popup.
- **Scoring/lives:** dot 10, energizer 50, extra life at 10,000 once per game, 3 starting lives
  (2 reserve icons), same-tile collision including the simultaneous tile-swap pass-through.
- **Level clear:** maze flash, consumable reset, next level configuration; an intermission plays
  after levels 2, 5, 9, 13 and 17.
- **Attract mode:** a title card, then a silent demo game played by a deterministic autopilot
  (ends when its Pac-Man loses a life or after 30 s), looping until the player starts. The game
  returns to attract mode 4 s after game over.
- **Level 256 (Dossier):** the 8-bit level counter makes 256 the last level. Its right half is
  scrambled: different walls, nine dots (four invisible) that return after every lost life, and
  scramble in the bonus counter. 244 dots can never be eaten, so the level never ends.
- **Levels:** full Table A.1 (speeds, Elroy, frightened time/flashes, fruit), not a linear ramp.

## Tests

`npm test` runs 118 tests. Actually executed results:

```
Test Files  8 passed (8)
Tests       118 passed (118)
```

Coverage includes maze dimensions/dot counts/reachability, coordinate transforms, Pac-Man wall
blocking and centre stops, reversals, buffered turns, every Dossier pre/post-turn window boundary,
the exact 45° corner path and its tick gain, Pac-Man and ghost tunnel wrap, a 3000-tick
random-input corridor/pixel-grid invariant, ghosts staying on walkable lanes for a whole game, each ghost's target (including both upward quirks and Clyde's 64
threshold), tie-breaking, no-up-turn restrictions, mode reversals, frightened pause/resume, the
200/400/800/1600 chain, fruit at 70/170, extra life once, death persistence/life decrement, level
completion/reset, house counters, revived-ghost release (Blinky under the global counter, the
Dossier's stuck-counter trap), eyes returning to their own pen slot, pen bobbing, simultaneous
exits, the exit path from a bobbed position, doorway collisions, the full ghost-bug sequence,
frightened-PRNG reset points and pattern repeatability, fruit lifetime range and variability,
wall lines confined to wall tiles with a 4 px inset and full coverage, the intermission schedule
and flow, cutscene sanity, level-256 layout/never-clears/dot regeneration/autopilot play, the
demo autopilot's survival and determinism, directional ghost pupils, replay
record/verify/round-trip/tamper detection/validation, gamepad mapping and press edges, the
dot-texture cache across simulations, continuous-drag swipe steering and tap detection, the reference scene's score matching its
composition, the 14 px lane, the 8 px
font grid, synth waveforms/pitch/tick pacing/auto-silence, effect lengths and loop priorities, Elroy thresholds, seeded
determinism, a golden full-game replay hash, and 60 Hz vs 144 Hz
equivalence.

## Known deviations from the arcade original

1. **Reference screenshot:** the screenshot the brief describes (score 2610) was never available,
   so the frozen reference scene reconstructs the documented state with a seeded consumed-pellet
   pattern and reconstructed actor placement; it is not a pixel copy. Its score is computed from
   the stated composition: 181 dots (1810) + 4 energizers (200) + both level-1 cherries (200) + one
   ghost caught on each of two energizers (200 + 200) = 2610, with two reserve lives and the cherry
   counter. (An earlier version claimed "one ghost", which only adds up to 2410.)
2. **Maze wall art:** our own style, generated from the collision map rather than the arcade's
   tile patterns: a single line set 4 px into the wall mass with rounded convex corners, a single
   outer frame, and 2 px pen walls. Every corridor shows a 14 px clear lane.
3. **Movement timing:** cornering windows and the 45° corner path follow the Dossier, but the
   per-frame step patterns are our own even distribution of each documented average speed (the
   Dossier gives only percentages, not the ROM's patterns). The turn window implies the arcade's
   tile centre sits at pixel 3 of a tile versus our 4; we apply that offset only to Pac-Man's turn
   and wall-stop decisions, not to dot eating or collisions. Stopping on the tile centre at a wall
   is not stated by the Dossier.
4. **Ghost house movement:** the Dossier gives no speeds, bob amplitude or exit path inside the
   pen; we use 40% for bobbing and walking out, 60% for eyes descending, and a ±4 px bob. In the
   ghost bug, the climbing ghost uses the level's normal ghost speed and does not collide with
   Pac-Man (the Dossier does not say), and the rarer "eyes lost after a second energizer" case is
   not reproduced.
5. **Pseudo-random sequences:** the arcade reads ROM bytes at pseudo-random addresses for frightened
   turns; without the ROM we use a seeded mulberry32 stream. It resets and advances at the documented
   points, so patterns repeat the way the Dossier describes, but the actual turns differ from the
   original. The Dossier does not say what drives the fruit lifetime; we hash a power-on tick counter.
6. **Audio:** an arcade-style 3-voice wavetable synth updated once per simulation tick, playing
   original sounds and an original start tune (alternating chomp, a four-stage siren, frightened
   and eyes loops, ghost eaten, fruit, extra life, death, game over). Nothing is sampled or
   transcribed from the arcade, so it does not sound like the original machine.
7. **Font:** our own 7×7-in-8×8 HUD font (bold outer strokes), not the arcade font. READY!,
   GAME OVER and PAUSED sit in the lane under the pen; the debug overlay keeps a compact 5×7 font.
8. **Eyes speed:** returning eyes move at 100% of base speed; the original value is not documented
   in the sources used.
9. **Attract mode and intermissions:** the title card, demo autopilot and the three cutscenes
   (Conga, Wave, Tag) are original designs; only the intermission schedule (after levels 2, 5, 9,
   13, 17) follows the arcade, and it comes from general sources, not the Dossier. The demo is
   driven live by a deterministic autopilot rather than a stored input log.
10. **Level 256:** the right-half scramble is our own deterministic pattern, not the arcade's
   corrupted memory. The left half keeps all of our maze's 120 dots and 2 energizers, where the
   Dossier counts 114 dots there; the pen, the right-hand tunnel and the start lane are kept usable.
11. **Browser conveniences:** pause on focus loss, mute, restart, touch swipe, gamepad, replays and
    the optional debug overlay are additions, not arcade behaviour. `?arcade=1` switches off the
    ones that change how a game plays out (pausing, restart, debug overlay).

## License

The code in this repository is released under the [MIT License](LICENSE).

Pac-Man is a trademark of Bandai Namco Entertainment Inc. This is an unofficial, non-commercial
reconstruction for study; it is not affiliated with or endorsed by Bandai Namco, and it contains no
ROM data, original artwork or original audio.
