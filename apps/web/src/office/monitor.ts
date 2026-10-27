import type { Graphics } from 'pixi.js';
import { hash } from './paint.ts';
import type { Language } from './behavior.ts';

export type ScreenMode = 'off' | 'idle' | 'code' | 'terminal' | 'doc' | 'web' | 'error' | 'logo';

/** Fuente de 3×5 para los logos dibujados por código. */
const GLYPHS: Record<string, string[]> = {
  G: ['###', '#..', '#.#', '#.#', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  J: ['..#', '..#', '..#', '#.#', '###'],
  S: ['###', '#..', '###', '..#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
};

const CODE_COLORS = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#ffcb6b'];

/** Pantalla de un monitor: se redibuja unas pocas veces por segundo, nunca por frame. */
export class Monitor {
  private mode: ScreenMode = 'off';
  private language: Language | null = null;
  private tick = 0;
  private acc = 0;

  constructor(
    private readonly g: Graphics,
    readonly rect: { x: number; y: number; w: number; h: number },
  ) {
    this.draw();
  }

  set(mode: ScreenMode, language: Language | null = null) {
    if (mode === this.mode && language === this.language) return;
    this.mode = mode;
    this.language = language;
    this.draw();
  }

  update(dt: number) {
    if (this.mode === 'off' || this.mode === 'logo' || this.mode === 'doc') return;
    this.acc += dt;
    const period = this.mode === 'idle' ? 0.6 : 0.16;
    if (this.acc < period) return;
    this.acc = 0;
    this.tick++;
    this.draw();
  }

  private text(x: number, y: number, word: string, color: string) {
    let cx = x;
    for (const ch of word) {
      const glyph = GLYPHS[ch];
      if (!glyph) continue;
      glyph.forEach((row, gy) => [...row].forEach((c, gx) => c === '#' && this.g.rect(cx + gx, y + gy, 1, 1).fill(color)));
      cx += 4;
    }
  }

  private draw() {
    const { x, y, w, h } = this.rect;
    const g = this.g;
    g.clear();
    switch (this.mode) {
      case 'off':
        g.rect(x, y, w, h).fill('#0f141d');
        break;
      case 'idle':
        g.rect(x, y, w, h).fill('#14263a');
        g.rect(x + 1, y + 1, 4, 1).fill('#3fb6ff');
        if (this.tick % 2 === 0) g.rect(x + 1, y + 3, 1, 2).fill('#9fd3ff');
        break;
      case 'code': {
        g.rect(x, y, w, h).fill('#1b1f2b');
        for (let l = 0; l < h - 1; l += 2) {
          const seed = l + this.tick;
          const indent = Math.floor(hash(seed, 1) * 3) * 2;
          const len = 2 + Math.floor(hash(seed, 2) * (w - 4 - indent));
          g.rect(x + 1 + indent, y + 1 + l, len, 1).fill(CODE_COLORS[Math.floor(hash(seed, 3) * CODE_COLORS.length)]!);
        }
        break;
      }
      case 'terminal': {
        g.rect(x, y, w, h).fill('#05090a');
        for (let l = 0; l < h - 3; l += 2) {
          const len = 2 + Math.floor(hash(l + this.tick, 7) * (w - 4));
          g.rect(x + 1, y + 1 + l, len, 1).fill('#3ddc84');
        }
        if (this.tick % 2 === 0) g.rect(x + 1, y + h - 2, 2, 1).fill('#3ddc84');
        break;
      }
      case 'doc':
        g.rect(x, y, w, h).fill('#eef0f2');
        for (let l = 2; l < h - 1; l += 2) g.rect(x + 2, y + l, w - 4 - (l % 4), 1).fill('#9aa3ad');
        g.rect(x + 2, y + 1, 5, 1).fill('#4e7ab5');
        break;
      case 'web': {
        g.rect(x, y, w, h).fill('#dcecff');
        g.rect(x, y, w, 2).fill('#4e7ab5');
        g.rect(x + 2, y + 3, w - 4, 2).fill('#ffffff');
        const scroll = this.tick % 4;
        for (let l = 6; l < h; l += 2) g.rect(x + 2, y + l, ((l + scroll) % 3) * 3 + 4, 1).fill('#7b8fa8');
        break;
      }
      case 'error':
        g.rect(x, y, w, h).fill('#3b0d12');
        g.rect(x + 2, y + 2, w - 4, 1).fill('#ff6b6b');
        g.rect(x + 2, y + 4, w - 6, 1).fill('#ff9b9b');
        g.rect(x + w / 2 - 1, y + 6, 2, 2).fill('#ffd166');
        break;
      case 'logo':
        if (this.language === 'go') {
          g.rect(x, y, w, h).fill('#00add8');
          this.text(x + 3, y + 3, 'GO', '#ffffff');
        } else if (this.language === 'php') {
          g.rect(x, y, w, h).fill('#4f5b93');
          g.ellipse(x + w / 2, y + h / 2, w / 2 - 1, h / 2 - 1).fill('#777bb3');
          this.text(x + 2, y + 3, 'PHP', '#ffffff');
        } else {
          g.rect(x, y, w, h).fill('#f7df1e');
          this.text(x + w - 9, y + h - 6, 'JS', '#1b1b1b');
        }
        break;
    }
  }
}
