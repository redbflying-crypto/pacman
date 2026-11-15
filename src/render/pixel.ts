/**
 * Tiny RGBA pixel buffer used to generate every texture at startup.
 * Keeping art generation in plain data makes it testable in Node and keeps the
 * runtime free of Canvas2D.
 */
export type RGB = readonly [number, number, number];

export function hexToRgb(hex: number): RGB {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  clear(): void {
    this.data.fill(0);
  }

  set(x: number, y: number, color: RGB, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = alpha;
  }

  blend(x: number, y: number, color: RGB, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const i = (y * this.width + x) * 4;
    if (alpha >= 255) {
      this.data[i] = color[0];
      this.data[i + 1] = color[1];
      this.data[i + 2] = color[2];
      this.data[i + 3] = 255;
      return;
    }
    const a = alpha / 255;
    this.data[i] = Math.round(this.data[i] * (1 - a) + color[0] * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + color[1] * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + color[2] * a);
    this.data[i + 3] = Math.max(this.data[i + 3], alpha);
  }

  fillRect(x: number, y: number, w: number, h: number, color: RGB, alpha = 255): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color, alpha);
  }

  blit(src: PixelBuffer, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3];
        if (a === 0) continue;
        this.blend(dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2]], a);
      }
    }
  }

  /** Alpha mask coverage, used by tests. */
  countAlpha(): number {
    let n = 0;
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] > 0) n++;
    return n;
  }
}