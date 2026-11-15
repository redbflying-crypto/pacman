/**
 * Three.js presentation layer.
 *
 * The simulation is rendered into a 224x288 WebGLRenderTarget with an
 * orthographic camera, then blitted to the canvas with nearest-neighbour
 * filtering at an integer scale. The canvas backing store is an integer
 * multiple of 224x288, so every logical pixel maps to a whole block of device
 * pixels and the page letterboxes with black around it.
 */
import * as THREE from 'three';
import {
  COLORS,
  DEATH_TICKS,
  LEFT,
  MAZE_OFFSET_Y,
  SCREEN_H,
  SCREEN_W,
  SUB,
  type Dir,
} from '../game/constants';
import { MAZE, MAZE_COLS, MAZE_ROWS, type Layout } from '../game/maze';
import { CUTSCENES } from '../game/cutscenes';
import { SPLIT_COL } from '../game/splitScreen';
import { getLevelConfig } from '../game/levels';
import type { Simulation } from '../game/sim';
import { PixelBuffer } from './pixel';
import {
  ATLAS_COLS,
  buildAtlas,
  buildDotPixels,
  buildMazePixels,
  buildSplitMazePixels,
  blitAtlasSprite,
  drawScrambleCell,
  drawLifeIcon,
  drawText,
  textWidth,
  type Atlas,
} from './art';

/** Maze row (below the ghost house) that carries READY! / GAME OVER / PAUSED. */
const MESSAGE_ROW = 17;
const MAZE_TOP = MAZE_OFFSET_Y;
const GHOST_COLOR_INDEX = { blinky: 0, pinky: 1, inky: 2, clyde: 3 } as const;

function makeTexture(buf: PixelBuffer): THREE.DataTexture {
  const tex = new THREE.DataTexture(buf.data, buf.width, buf.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function spriteMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    alphaTest: 0.02,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function place(mesh: THREE.Object3D, x: number, y: number, w: number, h: number): void {
  mesh.position.set(x + w / 2, SCREEN_H - y - h / 2, 0);
}

function setQuadFrame(geo: THREE.PlaneGeometry, atlas: Atlas, index: number): void {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const u0 = (col * 16) / atlas.width;
  const u1 = (col * 16 + 16) / atlas.width;
  const v0 = (row * 16) / atlas.height;
  const v1 = (row * 16 + 16) / atlas.height;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  uv.setXY(0, u0, v0);
  uv.setXY(1, u1, v0);
  uv.setXY(2, u0, v1);
  uv.setXY(3, u1, v1);
  uv.needsUpdate = true;
}

/**
 * Full-screen DataTextures are stored top-row-first, so the quad's V axis must
 * be flipped for the image to appear upright.
 */
function flipQuadV(geo: THREE.PlaneGeometry): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  uv.setXY(0, 0, 0);
  uv.setXY(1, 1, 0);
  uv.setXY(2, 0, 1);
  uv.setXY(3, 1, 1);
  uv.needsUpdate = true;
}

export interface DotKey {
  sim: object;
  revision: number;
}

/**
 * The dot texture must be rebuilt when the pellets change *or* when a different
 * simulation is drawn: the attract demo and the real game each count their own
 * revisions, so equal numbers do not mean equal pellets.
 */
export function dotsStale(shown: DotKey | null, sim: { revision: number }): boolean {
  return shown === null || shown.sim !== sim || shown.revision !== sim.revision;
}

export interface RenderOptions {
  debug: boolean;
  /** a non-player game on screen (attract demo, replay): label shown in the message row */
  label?: string;
  /** measured frames per second, shown in the debug overlay */
  fps?: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly atlas: Atlas;

  private readonly canvas: HTMLCanvasElement;
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly mazeMat: THREE.MeshBasicMaterial;
  private readonly mazeTex: THREE.DataTexture;
  /** level-256 art, built on first use */
  private splitTex: THREE.DataTexture | null = null;
  private mazeKind: Layout['kind'] = 'standard';
  private readonly mazeMesh: THREE.Mesh;
  private readonly dotMesh: THREE.Mesh;
  private readonly dotTex: THREE.DataTexture;
  private readonly dotBuf = new PixelBuffer(SCREEN_W, MAZE_ROWS * 8);
  /** which simulation and revision the dot texture currently shows */
  private dotKey: DotKey | null = null;

  private readonly hudBuf = new PixelBuffer(SCREEN_W, SCREEN_H);
  private readonly hudTex: THREE.DataTexture;
  private hudSig = '';

  private readonly debugBuf = new PixelBuffer(SCREEN_W, SCREEN_H);
  private readonly debugTex: THREE.DataTexture;
  private readonly debugMesh: THREE.Mesh;

  private readonly energizerMeshes: THREE.Mesh[] = [];
  private readonly ghostMeshes: THREE.Mesh[] = [];
  private readonly pacMesh: THREE.Mesh;
  private readonly fruitMesh: THREE.Mesh;

  scale = 1;
  private fixedScale = 0;
  /** CSS px of page content around the frame (hint and button bars), measured by the page */
  private reservedHeight = 92;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.atlas = buildAtlas();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);

    this.camera = new THREE.OrthographicCamera(-SCREEN_W / 2, SCREEN_W / 2, SCREEN_H / 2, -SCREEN_H / 2, 0.1, 1000);
    this.camera.position.set(SCREEN_W / 2, SCREEN_H / 2, 100);
    this.camera.lookAt(SCREEN_W / 2, SCREEN_H / 2, 0);

    this.rt = new THREE.WebGLRenderTarget(SCREEN_W, SCREEN_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
    this.rt.texture.generateMipmaps = false;

    // ---- maze
    this.mazeTex = makeTexture(buildMazePixels());
    this.mazeMat = new THREE.MeshBasicMaterial({
      map: this.mazeTex,
      color: COLORS.blue,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      alphaTest: 0.02,
      toneMapped: false,
    });
    const mazeGeo = new THREE.PlaneGeometry(SCREEN_W, MAZE_ROWS * 8);
    flipQuadV(mazeGeo);
    const maze = new THREE.Mesh(mazeGeo, this.mazeMat);
    place(maze, 0, MAZE_TOP, SCREEN_W, MAZE_ROWS * 8);
    maze.renderOrder = 0;
    this.scene.add(maze);
    this.mazeMesh = maze;

    // ---- dots
    this.dotTex = makeTexture(this.dotBuf);
    const dotMat = spriteMaterial(this.dotTex);
    const dotGeo = new THREE.PlaneGeometry(SCREEN_W, MAZE_ROWS * 8);
    flipQuadV(dotGeo);
    const dotMesh = new THREE.Mesh(dotGeo, dotMat);
    place(dotMesh, 0, MAZE_TOP, SCREEN_W, MAZE_ROWS * 8);
    dotMesh.renderOrder = 1;
    this.scene.add(dotMesh);
    this.dotMesh = dotMesh;

    // ---- energizers
    const atlasMat = spriteMaterial(makeTexture(this.atlas.pixels));
    for (const tile of MAZE.energizerTiles) {
      const col = tile % MAZE_COLS;
      const row = Math.floor(tile / MAZE_COLS);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), atlasMat);
      setQuadFrame(mesh.geometry as THREE.PlaneGeometry, this.atlas, this.atlas.energizerFrame());
      place(mesh, col * 8, MAZE_TOP + row * 8, 8, 8);
      mesh.renderOrder = 2;
      this.energizerMeshes.push(mesh);
      this.scene.add(mesh);
    }

    // ---- fruit
    this.fruitMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), atlasMat);
    setQuadFrame(this.fruitMesh.geometry as THREE.PlaneGeometry, this.atlas, this.atlas.fruitFrame(0));
    place(this.fruitMesh, 104, MAZE_TOP + 132, 16, 16);
    this.fruitMesh.renderOrder = 3;
    this.fruitMesh.visible = false;
    this.scene.add(this.fruitMesh);

    // ---- pac-man
    this.pacMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), atlasMat);
    setQuadFrame(this.pacMesh.geometry as THREE.PlaneGeometry, this.atlas, this.atlas.pacFrame(LEFT, 0));
    this.pacMesh.renderOrder = 4;
    this.scene.add(this.pacMesh);

    // ---- ghosts
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), atlasMat);
      setQuadFrame(mesh.geometry as THREE.PlaneGeometry, this.atlas, this.atlas.ghostFrame(i, 0));
      mesh.renderOrder = 5;
      this.ghostMeshes.push(mesh);
      this.scene.add(mesh);
    }

    // ---- HUD
    this.hudTex = makeTexture(this.hudBuf);
    const hudMat = spriteMaterial(this.hudTex);
    const hudGeo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
    flipQuadV(hudGeo);
    const hud = new THREE.Mesh(hudGeo, hudMat);
    place(hud, 0, 0, SCREEN_W, SCREEN_H);
    hud.renderOrder = 6;
    this.scene.add(hud);

    // ---- debug overlay
    this.debugTex = makeTexture(this.debugBuf);
    const debugMat = spriteMaterial(this.debugTex);
    const debugGeo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
    flipQuadV(debugGeo);
    this.debugMesh = new THREE.Mesh(debugGeo, debugMat);
    place(this.debugMesh, 0, 0, SCREEN_W, SCREEN_H);
    this.debugMesh.renderOrder = 7;
    this.debugMesh.visible = false;
    this.scene.add(this.debugMesh);

    // ---- blit
    const blitMat = new THREE.MeshBasicMaterial({
      map: this.rt.texture,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
    blit.frustumCulled = false;
    this.blitScene.add(blit);

    this.resize();
  }

  /** Tell the renderer how much vertical space the page needs besides the game frame. */
  setReservedHeight(px: number): void {
    if (!Number.isFinite(px) || px === this.reservedHeight) return;
    this.reservedHeight = Math.max(0, Math.ceil(px));
    this.resize();
  }

  setFixedScale(scale: number): void {
    this.fixedScale = Math.max(0, Math.floor(scale));
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(160, window.innerWidth - 16);
    const availH = Math.max(240, window.innerHeight - this.reservedHeight);
    const scale = this.fixedScale > 0
      ? this.fixedScale
      : Math.max(1, Math.floor(Math.min((availW * dpr) / SCREEN_W, (availH * dpr) / SCREEN_H)));
    this.scale = scale;
    const w = SCREEN_W * scale;
    const h = SCREEN_H * scale;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w / dpr}px`;
    this.canvas.style.height = `${h / dpr}px`;
  }

  private updateDots(sim: Simulation): void {
    buildDotPixels(sim.dots, sim.energizers, this.dotBuf, sim.layout.hiddenDots);
    this.dotTex.image.data = this.dotBuf.data;
    this.dotTex.needsUpdate = true;
    this.dotKey = { sim, revision: sim.revision };
  }

  /** Swap the maze art when the playfield changes (level 256 and back). */
  private useLayout(layout: Layout): void {
    if (layout.kind === this.mazeKind) return;
    this.mazeKind = layout.kind;
    if (layout.kind === 'split') {
      this.splitTex ??= makeTexture(buildSplitMazePixels(SPLIT_COL));
      this.mazeMat.map = this.splitTex;
    } else {
      this.mazeMat.map = this.mazeTex;
    }
    this.mazeMat.needsUpdate = true;
    this.dotKey = null;
  }

  render(sim: Simulation, opts: RenderOptions): void {
    this.useLayout(sim.layout);
    const playfield = sim.phase !== 'title' && sim.phase !== 'intermission';
    this.mazeMesh.visible = playfield;
    this.dotMesh.visible = playfield;

    const flash = sim.phase === 'levelclear' && Math.floor(sim.flashTicks / 6) % 2 === 1;
    // The split-screen art carries its own colours, so it is drawn untinted.
    this.mazeMat.color.setHex(this.mazeKind === 'split' ? 0xffffff : flash ? COLORS.wallFlash : COLORS.blue);

    if (dotsStale(this.dotKey, sim)) this.updateDots(sim);

    const blink = Math.floor(sim.tick / 12) % 2 === 0;
    for (let i = 0; i < this.energizerMeshes.length; i++) {
      const tile = MAZE.energizerTiles[i];
      this.energizerMeshes[i].visible = playfield && sim.energizers[tile] === 1 && blink;
    }

    if (playfield) this.drawActors(sim);
    else this.drawCutscene(sim);

    this.updateHud(sim, opts.label ?? '');

    this.debugMesh.visible = opts.debug && playfield;
    if (this.debugMesh.visible) this.drawDebug(sim, opts.fps);

    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.blitScene, this.blitCamera);
  }

  /** Intermission actors (or nothing, on the title card). */
  private drawCutscene(sim: Simulation): void {
    this.fruitMesh.visible = false;
    this.pacMesh.visible = false;
    for (const m of this.ghostMeshes) m.visible = false;
    if (sim.phase !== 'intermission' || sim.intermission < 0) return;
    const t = sim.intermissionTick;
    for (const a of CUTSCENES[sim.intermission].frame(t)) {
      const step = a.moving ? Math.floor(t / 6) : 0;
      if (a.sprite === 'pac') {
        setQuadFrame(this.pacMesh.geometry as THREE.PlaneGeometry, this.atlas, this.atlas.pacFrame(a.dir, a.moving ? step % 4 : 2));
        this.pacMesh.position.set(Math.round(a.x), SCREEN_H - Math.round(a.y), 0);
        this.pacMesh.visible = true;
      } else if (a.ghost) {
        const ci = GHOST_COLOR_INDEX[a.ghost];
        const mesh = this.ghostMeshes[ci];
        setQuadFrame(mesh.geometry as THREE.PlaneGeometry, this.atlas, this.atlas.ghostFrame(ci, Math.floor(t / 8) % 2, a.dir));
        mesh.position.set(Math.round(a.x), SCREEN_H - Math.round(a.y), 0);
        mesh.visible = true;
      }
    }
  }

  private drawActors(sim: Simulation): void {

    // ---- pac-man
    const pacX = sim.pac.x / SUB;
    const pacY = sim.pac.y / SUB + MAZE_TOP;
    this.pacMesh.position.set(pacX, SCREEN_H - pacY, 0);
    let pacFrame: number;
    if (sim.phase === 'dying') {
      const progress = 1 - sim.deathTicks / DEATH_TICKS;
      pacFrame = this.atlas.deathFrame(Math.min(3, Math.floor(progress * 4.5)));
    } else {
      const mouth = Math.floor(sim.pac.anim / 6) % 4;
      pacFrame = this.atlas.pacFrame(sim.pac.dir, mouth);
    }
    setQuadFrame(this.pacMesh.geometry as THREE.PlaneGeometry, this.atlas, pacFrame);
    this.pacMesh.visible = sim.phase !== 'gameover';

    // ---- ghosts
    for (let i = 0; i < this.ghostMeshes.length; i++) {
      const g = sim.ghosts[i];
      const mesh = this.ghostMeshes[i];
      let frame: number;
      if (g.lifecycle === 'eaten' || g.lifecycle === 'entering') {
        frame = this.atlas.eyesFrame(g.dir);
      } else if (g.frightened) {
        const warning = sim.frightTicks > 0 && sim.frightTicks < Math.min(120, sim.frightTotal * 0.4);
        const white = warning && Math.floor(sim.tick / 6) % 2 === 0;
        frame = this.atlas.frightenedFrame(Math.floor(g.anim / 8) % 2, white);
      } else {
        frame = this.atlas.ghostFrame(GHOST_COLOR_INDEX[g.id], Math.floor(g.anim / 8) % 2, g.dir);
      }
      setQuadFrame(mesh.geometry as THREE.PlaneGeometry, this.atlas, frame);
      // the pen bob is real movement in the simulation now
      const gx = g.x / SUB;
      const gy = g.y / SUB + MAZE_TOP;
      mesh.position.set(gx, SCREEN_H - gy, 0);
      mesh.visible = sim.phase !== 'gameover';
    }

    // ---- fruit
    if (sim.fruit) {
      this.fruitMesh.visible = true;
      setQuadFrame(this.fruitMesh.geometry as THREE.PlaneGeometry, this.atlas, this.atlas.fruitFrame(sim.fruit.type));
      this.fruitMesh.position.set(112, SCREEN_H - (MAZE_TOP + 140), 0);
    } else {
      this.fruitMesh.visible = false;
    }
  }

  // ---------------------------------------------------------------------- HUD

  private updateHud(sim: Simulation, label: string): void {
    const title = sim.phase === 'title';
    const sig = [
      sim.score,
      sim.highScore,
      sim.lives,
      sim.level,
      sim.phase,
      sim.paused,
      label,
      sim.layout.kind,
      title ? Math.floor(sim.tick / 30) % 2 : 0,
      sim.popups.map((p) => `${p.text}@${Math.ceil(p.ticks / 8)}`).join(','),
      sim.fruit ? `f${sim.fruit.type}` : '',
    ].join('|');
    if (sig === this.hudSig) return;
    this.hudSig = sig;

    const buf = this.hudBuf;
    buf.clear();
    const white: [number, number, number] = [255, 255, 255];

    drawText(buf, '1UP', 24, 3, white);
    drawText(buf, String(sim.score), 24, 12, white);
    drawText(buf, 'HIGH SCORE', 64, 3, white);
    drawText(buf, String(sim.highScore), 64, 12, white);

    if (title) {
      this.drawTitleCard(buf, sim);
    } else {
      // reserve lives (active life excluded)
      const reserve = Math.max(0, sim.lives - 1);
      for (let i = 0; i < Math.min(reserve, 6); i++) drawLifeIcon(buf, 16 + i * 16, 274);

      if (sim.layout.kind === 'split') {
        // Level 256: the overflowing counter routine leaves scramble here too.
        for (let x = 104; x < 216; x += 8) {
          drawScrambleCell(buf, x, 272, 7000 + x);
          drawScrambleCell(buf, x, 280, 9000 + x);
        }
      } else {
        // fruit / level counter, right aligned
        const shown = Math.min(7, sim.level);
        for (let i = 0; i < shown; i++) {
          const cfg = getLevelConfig(Math.max(1, sim.level - i));
          blitAtlasSprite(buf, this.atlas, this.atlas.fruitFrame(cfg.fruit), 216 - (i + 1) * 16 + 2, 272);
        }
      }
    }

    for (const p of sim.popups) {
      const text = p.text;
      const y = Math.round(p.y + MAZE_TOP - 8);
      const x = Math.round(p.x - textWidth(text) / 2);
      drawText(buf, text, x, y, [100, 255, 255]);
    }

    // Status text goes in the open lane under the pen (maze row 17), clear of
    // Pac-Man's start row; PAUSED takes the slot over READY!.
    const statusY = MAZE_TOP + MESSAGE_ROW * 8;
    const centred = (msg: string) => Math.round((SCREEN_W - textWidth(msg)) / 2);
    if (sim.paused) {
      drawText(buf, 'PAUSED', centred('PAUSED'), statusY, white);
    } else if (label && sim.phase !== 'title') {
      drawText(buf, label, centred(label), statusY, [0, 255, 255]);
    } else if (sim.phase === 'ready') {
      drawText(buf, 'READY!', centred('READY!'), statusY, [255, 200, 0]);
    } else if (sim.phase === 'gameover') {
      drawText(buf, 'GAME OVER', centred('GAME OVER'), statusY, [255, 40, 40]);
    }

    this.hudTex.image.data = buf.data;
    this.hudTex.needsUpdate = true;
  }

  /** Attract-mode title card: the cast, the scoring, and how to start. Original layout. */
  private drawTitleCard(buf: PixelBuffer, sim: Simulation): void {
    const a = this.atlas;
    const white: [number, number, number] = [255, 255, 255];
    const centred = (msg: string) => Math.round((SCREEN_W - textWidth(msg)) / 2);
    const icon = (index: number, cx: number, cy: number) => blitAtlasSprite(buf, a, index, cx - 8, cy - 8);

    icon(a.pacFrame(3, 2), 112, 72);
    [0, 1, 2, 3].forEach((ci) => icon(a.ghostFrame(ci, 0, 2), 64 + 32 * ci, 104));

    // scoring
    const peach: [number, number, number] = [255, 184, 174];
    buf.fillRect(70, 141, 2, 2, peach, 255);
    drawText(buf, '10', 84, 138, white);
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 11) buf.set(137 + x, 141 + y, peach, 255);
    drawText(buf, '50', 148, 138, white);
    icon(a.frightenedFrame(0, false), 52, 170);
    drawText(buf, '200-1600', 72, 166, white);

    if (Math.floor(sim.tick / 30) % 2 === 0) drawText(buf, 'PRESS ENTER', centred('PRESS ENTER'), 216, [255, 200, 0]);
    drawText(buf, 'OR TAP TO PLAY', centred('OR TAP TO PLAY'), 232, [160, 160, 160]);
  }

  // -------------------------------------------------------------------- debug

  private drawDebug(sim: Simulation, fps?: number): void {
    const buf = this.debugBuf;
    buf.clear();
    const grid: [number, number, number] = [40, 60, 40];
    for (let x = 0; x <= SCREEN_W; x += 8) for (let y = MAZE_TOP; y < MAZE_TOP + MAZE_ROWS * 8; y++) buf.set(x, y, grid, 255);
    for (let y = MAZE_TOP; y <= MAZE_TOP + MAZE_ROWS * 8; y += 8) for (let x = 0; x < SCREEN_W; x++) buf.set(x, y, grid, 255);

    const cross = (x: number, y: number, color: [number, number, number]) => {
      for (let i = -3; i <= 3; i++) {
        buf.set(x + i, y, color, 255);
        buf.set(x, y + i, color, 255);
      }
    };
    const box = (x: number, y: number, color: [number, number, number]) => {
      for (let i = 0; i < 8; i++) {
        buf.set(x + i, y, color, 255);
        buf.set(x + i, y + 7, color, 255);
        buf.set(x, y + i, color, 255);
        buf.set(x + 7, y + i, color, 255);
      }
    };

    // pac-man
    const px = Math.round(sim.pac.x / SUB);
    const py = Math.round(sim.pac.y / SUB) + MAZE_TOP;
    cross(px, py, [255, 255, 0]);
    box(px - 8, py - 8, [120, 120, 0]);

    // ghosts + targets
    const targets = sim.debugGhostTargets();
    sim.ghosts.forEach((g, i) => {
      const gx = Math.round(g.x / SUB);
      const gy = Math.round(g.y / SUB) + MAZE_TOP;
      cross(gx, gy, [255, 80, 80]);
      const t = targets[i];
      box(t.col * 8, MAZE_TOP + t.row * 8, [80, 200, 255]);
    });

    const lines = [
      `LV ${sim.level}  TICK ${sim.tick}${fps ? `  FPS ${Math.round(fps)}` : ''}`,
      `MODE ${sim.mode} ${Number.isFinite(sim.modeTicksLeft) ? (sim.modeTicksLeft / 60.606).toFixed(2) + 's' : 'inf'}`,
      `FRIGHT ${(sim.frightTicks / 60.606).toFixed(2)}s  CHAIN ${sim.ghostChain}`,
      `ELROY ${sim.elroy}  LEFT ${sim.remainingDots()}`,
      `PAC ${sim.pac.dir} want ${sim.pac.want} tile ${sim.pacTile().col},${sim.pacTile().row}`,
      ...sim.debugHouseCounters().map((c) => `${c.id[0].toUpperCase()} ${c.state} ${c.counter}/${c.limit}`),
      `GLOBAL ${sim.debugGlobalCounter().active ? 'ON' : 'OFF'} ${sim.debugGlobalCounter().value} idle ${sim.debugGlobalCounter().idle}`,
    ];
    // Compact font, stacked from the top of the playfield so all lines stay on screen.
    lines.forEach((line, i) => drawText(buf, line, 2, MAZE_TOP + 2 + i * 8, [0, 255, 120], 1, 'debug'));
    this.debugTex.image.data = buf.data;
    this.debugTex.needsUpdate = true;
  }

  dispose(): void {
    this.rt.dispose();
    this.mazeTex.dispose();
    this.dotTex.dispose();
    this.hudTex.dispose();
    this.debugTex.dispose();
    this.renderer.dispose();
    void this.canvas;
  }
}

export type { Dir };