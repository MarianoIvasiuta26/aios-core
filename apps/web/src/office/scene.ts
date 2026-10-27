import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, TextureStyle, type Ticker } from 'pixi.js';
import { COLUMNS, COLUMN_LABELS, profileFor, type Column, type Priority, type Task } from '@office/shared';
import { buildOfficeMap, TILE, WORLD_H, WORLD_W, type OfficeMap, type WallProp } from './map.ts';
import { monitorScreen, paintOffice } from './paint.ts';
import { CHAR_H, CHAR_W, DIRECTIONS, drawChair, drawCharacterSheet, FRAMES, type Direction } from './characters.ts';
import { Camera } from './camera.ts';

TextureStyle.defaultOptions.scaleMode = 'nearest';

const PIXEL_FONT = 'Pixelify Sans';
const TEXT_RES = 8;

function label(text: string, size: number, fill: string, opts: { weight?: '500' | '700'; align?: 'left' | 'center' } = {}) {
  const t = new Text({
    text,
    style: { fontFamily: `"${PIXEL_FONT}", monospace`, fontSize: size, fill, fontWeight: opts.weight ?? '500' },
    resolution: TEXT_RES,
  });
  t.roundPixels = true;
  if (opts.align !== 'left') t.anchor.set(0.5, 0);
  return t;
}

export interface CharacterNode {
  agent: string;
  container: Container;
  sprite: Sprite;
  frames: Record<Direction, Texture[]>;
  seat: { x: number; y: number };
  nameTag: Container;
  monitor: Graphics;
}

const PRIO_COLOR: Record<Priority, string> = { P0: '#e5484d', P1: '#f0a830', P2: '#5b9be0', P3: '#9aa3b2' };

interface WallCard {
  sprite: Sprite;
  tx: number;
  ty: number;
  /** 0→1 mientras vuela hacia su nueva posición. */
  flight: number;
  from: { x: number; y: number };
  targetAlpha: number;
}

/** Tablero central de la pared: muestra las tarjetas reales y las hace volar al cambiar de columna. */
class WallTaskBoard {
  readonly container = new Container();
  private readonly cards = new Map<string, WallCard>();
  private readonly overflow: Text[] = [];
  private readonly textures: Record<Priority, Texture>;
  private readonly colX: number[] = [];
  private readonly colW: number;
  private readonly top: number;
  private readonly maxRows: number;

  constructor(rect: WallProp['rect']) {
    const x = rect.x * TILE;
    const y = rect.y * TILE;
    const w = rect.w * TILE;
    const h = rect.h * TILE;
    const g = new Graphics();
    g.rect(x - 2, y + 2, w + 4, h - 2).fill('#4a3020');
    g.rect(x, y + 4, w, h - 7).fill('#c59a6b');
    g.rect(x, y + 4, w, 1).fill('#d8b088');
    g.rect(x - 2, y + h - 1, w + 4, 2).fill('#2e1e14');
    this.container.addChild(g);

    this.colW = Math.floor((w - 4) / COLUMNS.length);
    this.top = y + 18;
    this.maxRows = Math.floor((y + h - 6 - this.top) / 10);
    COLUMNS.forEach((c, i) => {
      const cx = x + 2 + i * this.colW;
      this.colX.push(cx);
      const header = new Graphics();
      header.rect(cx + 1, y + 7, this.colW - 2, 9).fill(c === 'bloqueada' ? '#7a2f35' : c === 'en-curso' ? '#6b5320' : '#3a2a1e');
      if (i > 0) header.rect(cx, y + 6, 1, h - 12).fill('#a37e56');
      this.container.addChild(header);
      const t = label(COLUMN_LABELS[c], 6, '#f4eedf');
      t.position.set(cx + this.colW / 2, y + 7.5);
      this.container.addChild(t);
      const more = label('', 5, '#3a2a1e');
      more.position.set(cx + this.colW / 2, y + h - 12);
      this.overflow.push(more);
      this.container.addChild(more);
    });

    const tex = (color: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 11;
      canvas.height = 8;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#f4eedf';
      ctx.fillRect(0, 0, 11, 8);
      ctx.fillStyle = color;
      ctx.fillRect(3, 0, 5, 2);
      ctx.fillStyle = '#9b927f';
      ctx.fillRect(2, 4, 7, 1);
      ctx.fillRect(2, 6, 5, 1);
      ctx.fillStyle = '#d9cfb8';
      ctx.fillRect(0, 7, 11, 1);
      return Texture.from(canvas);
    };
    this.textures = { P0: tex(PRIO_COLOR.P0), P1: tex(PRIO_COLOR.P1), P2: tex(PRIO_COLOR.P2), P3: tex(PRIO_COLOR.P3) };
  }

  setTasks(tasks: Task[]) {
    const seen = new Set<string>();
    COLUMNS.forEach((col: Column, ci) => {
      const list = tasks.filter((t) => t.column === col).sort((a, b) => a.position - b.position);
      const capacity = this.maxRows * 4;
      list.forEach((task, i) => {
        if (i >= capacity) return;
        seen.add(task.id);
        const tx = this.colX[ci]! + 3 + (i % 4) * 13;
        const ty = this.top + Math.floor(i / 4) * 10;
        let card = this.cards.get(task.id);
        if (!card) {
          const sprite = new Sprite(this.textures[task.priority]);
          sprite.position.set(tx, ty);
          sprite.alpha = 0;
          this.container.addChild(sprite);
          card = { sprite, tx, ty, flight: 1, from: { x: tx, y: ty }, targetAlpha: 1 };
          this.cards.set(task.id, card);
        }
        card.sprite.texture = this.textures[task.priority];
        if (card.tx !== tx || card.ty !== ty) {
          card.from = { x: card.sprite.x, y: card.sprite.y };
          card.flight = 0;
          card.tx = tx;
          card.ty = ty;
        }
        card.targetAlpha = col === 'hecha' ? 0.55 : 1;
      });
      this.overflow[ci]!.text = list.length > capacity ? `+${list.length - capacity}` : '';
    });
    for (const [id, card] of this.cards) {
      if (!seen.has(id)) {
        card.sprite.destroy();
        this.cards.delete(id);
      }
    }
  }

  update(dt: number) {
    for (const card of this.cards.values()) {
      const s = card.sprite;
      s.alpha += (card.targetAlpha - s.alpha) * Math.min(1, dt * 6);
      if (card.flight >= 1) continue;
      card.flight = Math.min(1, card.flight + dt * 1.6);
      const k = 1 - (1 - card.flight) ** 3;
      const arc = Math.sin(card.flight * Math.PI) * 10;
      s.position.set(card.from.x + (card.tx - card.from.x) * k, card.from.y + (card.ty - card.from.y) * k - arc);
      s.scale.set(1 + Math.sin(card.flight * Math.PI) * 0.4);
    }
  }
}

/** Decoración de pared estática por ahora; la fase 7 la conecta con archivos reales. */
function wallDecor(p: WallProp): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const x = p.rect.x * TILE;
  const y = p.rect.y * TILE;
  const w = p.rect.w * TILE;
  const h = p.rect.h * TILE;
  switch (p.kind) {
    case 'whiteboard':
      g.rect(x - 1, y + 2, w + 2, h - 3).fill('#9aa0a8');
      g.rect(x, y + 3, w, h - 5).fill('#f7f8f8');
      g.rect(x + 8, y + 8, 50, 1).fill('#4e7ab5');
      g.rect(x + 8, y + 12, 34, 1).fill('#4e7ab5');
      g.rect(x + 8, y + 16, 42, 1).fill('#c0504d');
      g.rect(x + w - 30, y + h - 4, 18, 2).fill('#c0504d');
      break;
    case 'backlog-board': {
      g.rect(x - 1, y - 6, w + 2, h + 8).fill('#4a3020');
      g.rect(x, y - 5, w, h + 6).fill('#ece6d6');
      for (let i = 0; i < 9; i++) g.rect(x + 3 + i * 14, y - 3 + (i % 2) * 6, 10, 5).fill(i % 3 === 0 ? '#ffe28a' : '#ffffff');
      break;
    }
    case 'funnel': {
      g.rect(x, y + 2, w, h - 3).fill('#f4f6f5');
      const stages = [0.95, 0.75, 0.55, 0.38, 0.22];
      stages.forEach((r, i) => {
        const bw = Math.round((w - 16) * r);
        g.rect(x + (w - bw) / 2, y + 5 + i * 5, bw, 4).fill(['#3a0ca3', '#4361ee', '#4895ef', '#4cc9f0', '#7ae582'][i]!);
      });
      break;
    }
    case 'chart-wall': {
      g.rect(x, y + 2, w, h - 3).fill('#22283a');
      for (let i = 0; i < 3; i++) {
        const cx = x + 4 + i * 47;
        g.rect(cx, y + 5, 43, 24).fill('#2c3450');
        for (let b = 0; b < 6; b++) {
          const bh = 4 + ((b * 7 + i * 5) % 16);
          g.rect(cx + 4 + b * 6, y + 27 - bh, 4, bh).fill(i === 1 ? '#f0a830' : '#7209b7');
        }
      }
      break;
    }
    case 'traffic-light': {
      g.roundRect(x + 4, y + 1, 24, 10, 2).fill('#1c1f26');
      ['#3a4a3a', '#4a4a32', '#4a3232'].forEach((col, i) => g.circle(x + 9 + i * 7, y + 6, 2.5).fill(col));
      break;
    }
    case 'screen-wall': {
      for (let i = 0; i < 8; i++) {
        const sx = x + i * 32;
        g.rect(sx + 1, y + 3, 30, 24).fill('#0b0f17');
        g.rect(sx + 2, y + 4, 28, 22).fill('#0f1b26');
        for (let l = 0; l < 4; l++) g.rect(sx + 4, y + 7 + l * 5, 8 + ((i * 7 + l * 11) % 18), 1).fill(i % 3 === 0 ? '#ff6b6b55' : '#3fb6ff66');
      }
      break;
    }
    default:
      break;
  }
  return c;
}

export class OfficeScene {
  readonly app = new Application();
  readonly map: OfficeMap = buildOfficeMap();
  readonly world = new Container();
  readonly characters = new Map<string, CharacterNode>();
  camera!: Camera;
  private board!: WallTaskBoard;
  private readonly highlight = new Graphics();
  private highlighted: string | null = null;
  private elapsed = 0;
  private destroyed = false;
  private initialized = false;

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      background: '#0e131c',
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      roundPixels: true,
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.initialized = true;
    host.appendChild(this.app.canvas);
    await document.fonts.load(`10px "${PIXEL_FONT}"`).catch(() => {});

    this.app.stage.addChild(this.world);
    this.world.addChild(new Sprite(Texture.from(paintOffice(this.map))));

    const props = new Container();
    const actors = new Container();
    actors.sortableChildren = true;
    const front = new Container();
    const lighting = new Container();
    const overlay = new Container();
    this.world.addChild(props, actors, front, lighting, overlay);

    for (const p of this.map.wallProps) {
      if (p.kind === 'task-board') {
        this.board = new WallTaskBoard(p.rect);
        props.addChild(this.board.container);
      } else if (p.kind !== 'window-view') {
        props.addChild(wallDecor(p));
      }
    }

    // Personajes en su escritorio, de espaldas, mirando el monitor.
    const chairTex = Texture.from(drawChair(false));
    const bossChairTex = Texture.from(drawChair(true));
    for (const d of this.map.desks) {
      const sheet = Texture.from(drawCharacterSheet(d.agent));
      const frames = Object.fromEntries(
        DIRECTIONS.map((dir, row) => [
          dir,
          Array.from({ length: FRAMES }, (_, f) => new Texture({ source: sheet.source, frame: new Rectangle(f * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H) })),
        ]),
      ) as Record<Direction, Texture[]>;

      const container = new Container();
      const sprite = new Sprite(frames.up[0]);
      sprite.anchor.set(0.5, 1);
      container.addChild(sprite);
      container.position.set(d.seat.x * TILE + TILE / 2, d.seat.y * TILE + TILE - 1);
      container.zIndex = container.y;
      actors.addChild(container);

      const chair = new Sprite(d.agent === 'jefe' ? bossChairTex : chairTex);
      chair.anchor.set(0.5, 1);
      chair.position.set(container.x, container.y + 5);
      front.addChild(chair);

      const deskFurniture = this.map.furniture.find((f) => (f.kind === 'desk' || f.kind === 'boss-desk') && f.x === d.seat.x - 1 && f.y === d.seat.y - 2)!;
      const s = monitorScreen(deskFurniture);
      const monitor = new Graphics();
      monitor.rect(s.x, s.y, s.w, s.h).fill('#14263a');
      monitor.rect(s.x + 1, s.y + 1, 4, 1).fill('#3fb6ff');
      monitor.rect(s.x + 1, s.y + 3, 7, 1).fill('#2a4a66');
      props.addChild(monitor);

      const nameTag = new Container();
      const name = label(profileFor(d.agent === 'jefe' ? null : d.agent).displayName, 5, '#f4eedf');
      const bg = new Graphics();
      const pad = 2;
      bg.roundRect(-name.width / 2 - pad, -1, name.width + pad * 2, name.height + 1, 2).fill({ color: '#121925', alpha: 0.75 });
      nameTag.addChild(bg, name);
      nameTag.position.set(container.x, container.y + 6);
      overlay.addChild(nameTag);

      this.characters.set(d.agent, { agent: d.agent, container, sprite, frames, seat: d.seat, nameTag, monitor });
    }

    // Radar del SOC (la fase 7 lo hace girar durante las auditorías).
    const radarFurniture = this.map.furniture.find((f) => f.kind === 'radar-console');
    if (radarFurniture) {
      const rx = (radarFurniture.x + radarFurniture.w / 2) * TILE;
      const ry = radarFurniture.y * TILE + 18;
      const radar = new Graphics();
      radar.circle(rx, ry, 15).fill('#0c1f1a').stroke({ color: '#2f7a5f', width: 1 });
      radar.circle(rx, ry, 10).stroke({ color: '#1f5a46', width: 1 });
      radar.circle(rx, ry, 5).stroke({ color: '#1f5a46', width: 1 });
      radar.moveTo(rx, ry).lineTo(rx + 11, ry - 10).stroke({ color: '#6bf0b4', width: 1 });
      props.addChild(radar);
    }

    // Iluminación: el SOC es más oscuro, con brillos de pantallas.
    const soc = this.map.zones.find((z) => z.id === 'soc')!;
    const dim = new Graphics();
    dim.rect((soc.rect.x - 1) * TILE, (soc.rect.y - 1) * TILE, (soc.rect.w + 2) * TILE, (soc.rect.h + 2) * TILE).fill({ color: '#05070d', alpha: 0.35 });
    for (const d of this.map.desks.filter((x) => x.zone === 'soc')) {
      dim.circle(d.seat.x * TILE + 8, (d.seat.y - 1) * TILE, 22).fill({ color: '#3fb6ff', alpha: 0.06 });
    }
    lighting.addChild(dim);

    // Carteles de zona.
    for (const z of this.map.zones) {
      const t = label(z.name, 7, '#f4eedf', { weight: '700' });
      const bg = new Graphics();
      bg.roundRect(-t.width / 2 - 4, -2, t.width + 8, t.height + 3, 3).fill({ color: '#121925', alpha: 0.7 });
      const sign = new Container();
      sign.addChild(bg, t);
      sign.position.set(z.sign.x * TILE + TILE / 2, z.sign.y * TILE + 2);
      overlay.addChild(sign);
    }

    // Indicador del agente resaltado (click en una tarjeta).
    this.highlight.visible = false;
    overlay.addChild(this.highlight);

    this.camera = new Camera(this.app, this.world, WORLD_W, WORLD_H);
    this.camera.fit();
    this.app.ticker.add(this.tick);
  }

  private readonly tick = (t: Ticker) => {
    const dt = t.deltaMS / 1000;
    this.elapsed += dt;
    this.board?.update(dt);
    this.camera.update(dt);
    if (this.highlighted) {
      const node = this.characters.get(this.highlighted);
      if (node) {
        const bob = Math.round(Math.sin(this.elapsed * 6) * 2);
        this.highlight.position.set(node.container.x, node.container.y - CHAR_H - 6 + bob);
      }
    }
  };

  setTasks(tasks: Task[]) {
    this.board?.setTasks(tasks);
  }

  setHighlight(agent: string | null) {
    this.highlighted = agent && this.characters.has(agent) ? agent : null;
    this.highlight.clear();
    if (!this.highlighted) {
      this.highlight.visible = false;
      return;
    }
    const color = profileFor(this.highlighted === 'jefe' ? null : this.highlighted).color;
    this.highlight.poly([-5, -6, 5, -6, 0, 0]).fill('#f2c14e').stroke({ color: '#121925', width: 1 });
    this.highlight.circle(0, -9, 2).fill(color);
    this.highlight.visible = true;
    const node = this.characters.get(this.highlighted)!;
    this.camera.focus(node.container.x, node.container.y - CHAR_H / 2);
  }

  get fps() {
    return this.initialized ? this.app.ticker.FPS : 0;
  }

  destroy() {
    this.destroyed = true;
    if (!this.initialized) return;
    this.camera?.detach();
    this.app.ticker.remove(this.tick);
    this.app.destroy(true, { children: true, texture: true });
  }
}
