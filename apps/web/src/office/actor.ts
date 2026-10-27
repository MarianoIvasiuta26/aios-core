import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { CHAR_H, type Direction, type Pose } from './characters.ts';
import { TILE } from './map.ts';
import type { Monitor } from './monitor.ts';
import type { Facing, Spot, Tile } from './pathfind.ts';

/** Paso de un plan: el director arma la secuencia y el actor la ejecuta en orden. */
export type Step =
  | { type: 'walk'; to: Spot }
  | { type: 'wait'; ms: number; pose?: Pose | null; facing?: Facing }
  | { type: 'sit' }
  | { type: 'hide' }
  | { type: 'run'; fn: () => void };

export type BubbleTone = 'normal' | 'terminal' | 'error' | 'web' | 'waiting';

const WALK_SPEED = 6; // tiles por segundo
/** Las caminatas largas se aceleran para no tardar más que esto. */
const MAX_WALK_S = 4;
const PIXEL_FONT = '"Pixelify Sans", monospace';

const TONES: Record<BubbleTone, { bg: string; fg: string; border: string }> = {
  normal: { bg: '#f4eedf', fg: '#1e2532', border: '#1e2532' },
  terminal: { bg: '#0b1410', fg: '#3ddc84', border: '#3ddc84' },
  error: { bg: '#3b0d12', fg: '#ffb3b3', border: '#ff6b6b' },
  web: { bg: '#e3f0ff', fg: '#1e3a5f', border: '#4e7ab5' },
  waiting: { bg: '#f2c14e', fg: '#1e2532', border: '#1e2532' },
};

/** Partículas baratas: sprites blancos teñidos, reciclados. */
export class Particles {
  readonly container = new Container();
  private readonly live: Array<{ s: Sprite; vx: number; vy: number; g: number; life: number; max: number }> = [];
  private readonly pool: Sprite[] = [];

  emit(x: number, y: number, color: string, opts: { vx?: number; vy?: number; g?: number; life?: number; size?: number } = {}) {
    const s = this.pool.pop() ?? new Sprite(Texture.WHITE);
    s.tint = color;
    s.width = s.height = opts.size ?? 1;
    s.position.set(x, y);
    s.alpha = 1;
    s.visible = true;
    this.container.addChild(s);
    const life = opts.life ?? 0.8;
    this.live.push({ s, vx: opts.vx ?? 0, vy: opts.vy ?? -12, g: opts.g ?? 0, life, max: life });
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.container.removeChild(p.s);
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.alpha = Math.min(1, p.life / (p.max * 0.5));
    }
  }
}

class Bubble {
  readonly container = new Container();
  private readonly bg = new Graphics();
  private readonly label: Text;
  private current = '';

  constructor() {
    this.label = new Text({ text: '', style: { fontFamily: PIXEL_FONT, fontSize: 6, fill: '#1e2532' }, resolution: 8 });
    this.label.anchor.set(0.5, 1);
    this.container.addChild(this.bg, this.label);
    this.container.visible = false;
  }

  set(text: string | null, tone: BubbleTone = 'normal') {
    const key = `${tone}|${text ?? ''}`;
    if (key === this.current) return;
    this.current = key;
    if (!text) {
      this.container.visible = false;
      return;
    }
    const t = TONES[tone];
    this.label.text = text;
    this.label.style.fill = t.fg;
    const w = Math.ceil(this.label.width) + 6;
    const h = Math.ceil(this.label.height) + 3;
    this.bg.clear();
    this.bg.roundRect(-w / 2, -h - 1, w, h, 2).fill(t.bg).stroke({ color: t.border, width: 0.5 });
    this.bg.poly([-2, -1.5, 2, -1.5, 0, 1.5]).fill(t.bg);
    this.label.position.set(0, -2.5);
    this.container.visible = true;
  }
}

export interface ActorFrames {
  dirs: Record<Direction, Texture[]>;
  poses: Record<Pose, Texture>;
}

/** Un personaje en la oficina: camina por caminos, se sienta, hace poses y muestra efectos. */
export class Actor {
  readonly container = new Container();
  readonly sprite: Sprite;
  private readonly fx = new Graphics();
  private readonly bubble = new Bubble();
  private readonly alert: Text;
  tile: Tile = { x: 0, y: 0 };
  private px = 0;
  private py = 0;
  facing: Facing = 'down';
  seated = false;
  private pose: Pose | null = null;
  private plan: Step[] = [];
  private path: Tile[] = [];
  private waitLeft = 0;
  private walkPhase = 0;
  private speed = WALK_SPEED;
  private t = 0;
  /** Efectos activos */
  typing = false;
  reading = false;
  globe = false;
  waiting = false;
  private shakeLeft = 0;
  private cheerLeft = 0;
  private smokeAcc = 0;
  private codeAcc = 0;

  constructor(
    readonly agent: string,
    private readonly frames: ActorFrames,
    private readonly pathTo: (from: Tile, to: Tile) => Tile[],
    private readonly particles: Particles,
    readonly monitor: Monitor | null,
  ) {
    this.sprite = new Sprite(frames.dirs.down[0]);
    this.sprite.anchor.set(0.5, 1);
    this.alert = new Text({ text: '!', style: { fontFamily: PIXEL_FONT, fontSize: 10, fill: '#f2c14e', fontWeight: '700', stroke: { color: '#1e2532', width: 2 } }, resolution: 8 });
    this.alert.anchor.set(0.5, 1);
    this.alert.visible = false;
    this.container.addChild(this.sprite, this.fx, this.bubble.container, this.alert);
    this.container.visible = false;
  }

  get visible() {
    return this.container.visible;
  }

  get busy() {
    return this.plan.length > 0 || this.path.length > 0 || this.waitLeft > 0;
  }

  /** Posición del centro del cuerpo en el mundo (para centrar la cámara). */
  get center() {
    return { x: this.px, y: this.py - CHAR_H / 2 };
  }

  place(spot: Spot, seated: boolean) {
    this.tile = { x: spot.x, y: spot.y };
    this.px = spot.x * TILE + TILE / 2;
    this.py = spot.y * TILE + TILE - 1;
    this.facing = spot.facing;
    this.seated = seated;
    this.path = [];
    this.plan = [];
    this.waitLeft = 0;
    this.pose = null;
    this.container.visible = true;
    this.sync();
  }

  hide() {
    this.container.visible = false;
    this.plan = [];
    this.path = [];
    this.seated = false;
    this.clearEffects();
  }

  /** Reemplaza el plan actual. Si está caminando, termina el paso hacia el tile siguiente. */
  setPlan(steps: Step[]) {
    this.path = this.path.slice(0, 1);
    this.waitLeft = 0;
    this.plan = steps;
    if (this.path.length === 0) this.nextStep();
  }

  bubbleText(text: string | null, tone: BubbleTone = 'normal') {
    this.bubble.set(text, tone);
  }

  shake(seconds = 0.7) {
    this.shakeLeft = seconds;
  }

  cheer(seconds = 1.6) {
    this.cheerLeft = seconds;
    for (let i = 0; i < 18; i++) {
      const colors = ['#f2c14e', '#e5484d', '#5b9be0', '#78d389', '#c792ea'];
      this.particles.emit(this.px, this.py - CHAR_H, colors[i % colors.length]!, {
        vx: (Math.random() - 0.5) * 60,
        vy: -30 - Math.random() * 30,
        g: 90,
        life: 1.2,
        size: 1.5,
      });
    }
  }

  clearEffects() {
    this.typing = this.reading = this.globe = this.waiting = false;
    this.shakeLeft = this.cheerLeft = 0;
    this.bubble.set(null);
    this.fx.clear();
  }

  private nextStep() {
    const step = this.plan.shift();
    if (!step) return;
    switch (step.type) {
      case 'walk': {
        this.seated = false;
        this.pose = null;
        this.path = this.pathTo(this.tile, step.to);
        if (this.path.length === 0) {
          this.facing = step.to.facing;
          this.nextStep();
        } else {
          (this.path as Array<Tile & { facing?: Facing }>).at(-1)!.facing = step.to.facing;
          this.speed = Math.max(WALK_SPEED, this.path.length / MAX_WALK_S);
        }
        break;
      }
      case 'wait':
        this.waitLeft = step.ms / 1000;
        if (step.pose !== undefined) this.pose = step.pose;
        if (step.facing) this.facing = step.facing;
        if (step.pose) this.seated = false;
        break;
      case 'sit':
        this.seated = true;
        this.pose = null;
        this.facing = 'up';
        this.nextStep();
        break;
      case 'hide':
        this.hide();
        break;
      case 'run':
        step.fn();
        this.nextStep();
        break;
    }
  }

  update(dt: number) {
    if (!this.container.visible) return;
    this.t += dt;

    // Movimiento
    let moving = false;
    const next = this.path[0] as (Tile & { facing?: Facing }) | undefined;
    if (next) {
      moving = true;
      const tx = next.x * TILE + TILE / 2;
      const ty = next.y * TILE + TILE - 1;
      const dx = tx - this.px;
      const dy = ty - this.py;
      const dist = Math.hypot(dx, dy);
      const step = this.speed * TILE * dt;
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
      else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';
      if (dist <= step) {
        this.px = tx;
        this.py = ty;
        this.tile = { x: next.x, y: next.y };
        this.path.shift();
        if (this.path.length === 0) {
          if (next.facing) this.facing = next.facing;
          this.nextStep();
        }
      } else {
        this.px += (dx / dist) * step;
        this.py += (dy / dist) * step;
      }
      this.walkPhase += step;
    } else if (this.waitLeft > 0) {
      this.waitLeft -= dt;
      if (this.waitLeft <= 0) {
        this.waitLeft = 0;
        this.pose = null;
        this.nextStep();
      }
    }

    // Efectos
    this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    this.cheerLeft = Math.max(0, this.cheerLeft - dt);
    this.drawFx(dt, moving);
    this.sync(moving);
  }

  private drawFx(dt: number, moving: boolean) {
    const g = this.fx;
    g.clear();
    const headY = -CHAR_H + 2;
    if (this.globe) {
      const cy = headY - 8;
      const spin = Math.sin(this.t * 4);
      g.circle(0, cy, 4).fill('#4e9be8').stroke({ color: '#1e3a5f', width: 0.5 });
      g.rect(-3 + spin * 1.5, cy - 2, 3, 2).fill('#5fae64');
      g.rect(-1 + spin * 2, cy + 1, 2, 2).fill('#5fae64');
      g.ellipse(0, cy, Math.abs(spin) * 4 + 0.3, 4).stroke({ color: '#cfe6ff', width: 0.4 });
    }
    if (this.reading && this.seated && !moving) {
      const flip = Math.floor(this.t * 3) % 3;
      g.rect(5, -14, 5, 6).fill('#f4f1e8');
      g.rect(5, -14, 5, 1).fill('#c7c2b5');
      if (flip === 1) g.rect(4, -15, 3, 4).fill('#ffffff');
    }
    if (this.shakeLeft > 0) {
      this.smokeAcc += dt;
      if (this.smokeAcc > 0.08) {
        this.smokeAcc = 0;
        this.particles.emit(this.px + (Math.random() - 0.5) * 8, this.py + headY, Math.random() > 0.5 ? '#8a8f98' : '#b4b8bf', {
          vx: (Math.random() - 0.5) * 8,
          vy: -14,
          life: 1,
          size: 2,
        });
      }
    }
    if (this.typing && this.seated && this.monitor) {
      this.codeAcc += dt;
      if (this.codeAcc > 0.09) {
        this.codeAcc = 0;
        const r = this.monitor.rect;
        const colors = ['#c792ea', '#82aaff', '#c3e88d', '#ffcb6b', '#89ddff'];
        this.particles.emit(r.x + Math.random() * r.w, r.y, colors[Math.floor(Math.random() * colors.length)]!, {
          vx: (Math.random() - 0.5) * 6,
          vy: -10 - Math.random() * 8,
          life: 0.9,
        });
      }
    }
    this.alert.visible = this.waiting;
    if (this.waiting) {
      this.alert.position.set(this.seated ? 9 : 0, headY - 3);
      this.alert.scale.set(1 + Math.sin(this.t * 8) * 0.15);
    }
    // Sentado, la burbuja va por encima del monitor para no taparlo.
    const lift = this.seated ? 25 : this.waiting ? 14 : this.globe ? 13 : 2;
    this.bubble.container.position.set(0, headY - lift);
  }

  private sync(moving = false) {
    const pose: Pose | null = this.cheerLeft > 0 ? 'cheer' : this.waiting && this.seated ? 'hand' : this.pose;
    if (pose) {
      this.sprite.texture = this.frames.poses[pose];
    } else {
      const dir: Direction = this.seated ? 'up' : this.facing;
      const frame = moving ? 1 + (Math.floor(this.walkPhase / 7) % 2) : 0;
      this.sprite.texture = this.frames.dirs[dir][frame]!;
    }
    let ox = 0;
    let oy = 0;
    if (this.shakeLeft > 0) ox = Math.round(Math.sin(this.t * 45));
    if (this.cheerLeft > 0) oy = -Math.round(Math.abs(Math.sin(this.t * 9)) * 3);
    else if (this.typing && this.seated) oy = Math.floor(this.t * 8) % 2 ? -1 : 0;
    else if (moving) oy = Math.floor(this.walkPhase / 7) % 2 ? -1 : 0;
    this.sprite.position.set(ox, oy);
    this.container.position.set(Math.round(this.px), Math.round(this.py));
    this.container.zIndex = this.py + (this.seated ? 0 : 1);
  }
}
