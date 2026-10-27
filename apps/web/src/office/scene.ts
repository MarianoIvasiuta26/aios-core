import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, TextureStyle, type Ticker } from 'pixi.js';
import {
  BOSS_ID,
  COLUMNS,
  COLUMN_LABELS,
  profileFor,
  VISITOR_ID,
  type Column,
  type OfficeEvent,
  type Priority,
  type Task,
} from '@office/shared';
import { buildOfficeMap, TILE, WORLD_H, WORLD_W, type OfficeMap, type Rect } from './map.ts';
import { monitorScreen, paintOffice } from './paint.ts';
import { CHAR_H, CHAR_W, DIRECTIONS, drawChair, drawCharacterSheet, FRAMES, POSES, type Direction, type Pose } from './characters.ts';
import { Camera } from './camera.ts';
import { Actor, Particles, type ActorFrames } from './actor.ts';
import { Director } from './director.ts';
import { Monitor } from './monitor.ts';
import { createPlaces } from './pathfind.ts';
import { ZoneWidgets } from './widgets.ts';
import { zoneModel, zoneReactions, type ZoneReaction } from './zones.ts';
import type { WorkspaceState } from '@office/shared';

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

export type Pick = { type: 'agent'; agent: string } | { type: 'zone'; zone: string };

function framesFor(agent: string): ActorFrames {
  const sheet = Texture.from(drawCharacterSheet(agent));
  const frame = (col: number, row: number) =>
    new Texture({ source: sheet.source, frame: new Rectangle(col * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H) });
  return {
    dirs: Object.fromEntries(DIRECTIONS.map((dir, row) => [dir, Array.from({ length: FRAMES }, (_, f) => frame(f, row))])) as Record<
      Direction,
      Texture[]
    >,
    poses: Object.fromEntries(POSES.map((pose, i) => [pose, frame(i, DIRECTIONS.length)])) as Record<Pose, Texture>,
  };
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

  constructor(rect: Rect) {
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
export class OfficeScene {
  readonly app = new Application();
  readonly map: OfficeMap = buildOfficeMap();
  readonly world = new Container();
  readonly actors = new Map<string, Actor>();
  private readonly nameTags = new Map<string, Container>();
  private readonly monitors: Monitor[] = [];
  private readonly particles = new Particles();
  director!: Director;
  camera!: Camera;
  private board!: WallTaskBoard;
  private widgets: ZoneWidgets | null = null;
  private workspaceRoot: string | null = null;
  private pendingWorkspace: WorkspaceState | null | undefined = undefined;
  private pendingPrompt: string | null = null;
  private readonly highlight = new Graphics();
  private readonly zoneOutline = new Graphics();
  /** Click (sin arrastre) sobre un personaje o una zona. */
  onPick: ((pick: Pick | null) => void) | null = null;
  /** Personaje bajo el cursor, con su posición en pantalla. */
  onHover: ((hover: { agent: string; x: number; y: number } | null) => void) | null = null;
  private hovered: string | null = null;
  private highlighted: string | null = null;
  private elapsed = 0;
  private unlisten: (() => void) | null = null;
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
      }
    }

    // Sillas fijas en cada escritorio; los personajes entran, se sientan y se van.
    const places = createPlaces(this.map);
    const chairTex = Texture.from(drawChair(false));
    const bossChairTex = Texture.from(drawChair(true));
    const agents = [...this.map.desks.map((d) => d.agent), VISITOR_ID];
    for (const agent of agents) {
      const desk = this.map.desks.find((d) => d.agent === agent);
      let monitor: Monitor | null = null;
      if (desk) {
        const chair = new Sprite(agent === 'jefe' ? bossChairTex : chairTex);
        chair.anchor.set(0.5, 1);
        chair.position.set(desk.seat.x * TILE + TILE / 2, desk.seat.y * TILE + TILE - 1 + 5);
        front.addChild(chair);

        const deskFurniture = this.map.furniture.find(
          (f) => (f.kind === 'desk' || f.kind === 'boss-desk') && f.x === desk.seat.x - 1 && f.y === desk.seat.y - 2,
        )!;
        const screen = new Graphics();
        props.addChild(screen);
        monitor = new Monitor(screen, monitorScreen(deskFurniture));
        this.monitors.push(monitor);
      }

      const actor = new Actor(agent, framesFor(agent), (a, b) => this.director.pathFor(agent)(a, b), this.particles, monitor);
      actors.addChild(actor.container);
      this.actors.set(agent, actor);

      const nameTag = new Container();
      const name = label(profileFor(agent === 'jefe' ? null : agent).displayName, 5, '#f4eedf');
      const bg = new Graphics();
      const pad = 2;
      bg.roundRect(-name.width / 2 - pad, -1, name.width + pad * 2, name.height + 1, 2).fill({ color: '#121925', alpha: 0.75 });
      nameTag.addChild(bg, name);
      nameTag.visible = false;
      overlay.addChild(nameTag);
      this.nameTags.set(agent, nameTag);
    }
    this.director = new Director([...this.actors.values()], places, this.map.walkable);
    front.addChild(this.particles.container);

    // Zonas vivas: backlog, semáforo, SOC, embudo, oportunidades, mapa de leads y pizarrón.
    this.widgets = new ZoneWidgets(this.map, this.particles);
    props.addChild(this.widgets.container);
    if (this.pendingWorkspace !== undefined) this.setWorkspace(this.pendingWorkspace);
    this.widgets.setPrompt(this.pendingPrompt);

    // Iluminación: el SOC es más oscuro, con brillos de pantallas.
    const soc = this.map.zones.find((z) => z.id === 'soc')!;
    const dim = new Graphics();
    dim
      .rect((soc.rect.x - 1) * TILE, (soc.rect.y - 1) * TILE, (soc.rect.w + 2) * TILE, (soc.rect.h + 2) * TILE)
      .fill({ color: '#05070d', alpha: 0.35 });
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

    // Indicador del agente resaltado (click en una tarjeta) y contorno de la zona elegida.
    this.highlight.visible = false;
    this.zoneOutline.visible = false;
    overlay.addChild(this.zoneOutline, this.highlight);

    const canvas = this.app.canvas;
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onUp = (e: PointerEvent) => {
      if (this.camera.wasDrag || e.button !== 0) return;
      const p = local(e);
      this.onPick?.(this.pickAt(p.x, p.y));
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return;
      const p = local(e);
      const pick = this.pickAt(p.x, p.y);
      const agent = pick?.type === 'agent' ? pick.agent : null;
      canvas.style.cursor = agent ? 'pointer' : '';
      this.hovered = agent;
      this.emitHover();
    };
    const onLeave = () => {
      this.hovered = null;
      this.emitHover();
    };
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    this.unlisten = () => {
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };

    this.camera = new Camera(this.app, this.world, WORLD_W, WORLD_H);
    this.camera.fit();
    this.app.ticker.add(this.tick);
  }

  private readonly tick = (t: Ticker) => {
    const dt = t.deltaMS / 1000;
    this.elapsed += dt;
    this.board?.update(dt);
    this.director.update();
    for (const [agent, actor] of this.actors) {
      actor.update(dt);
      const tag = this.nameTags.get(agent)!;
      tag.visible = actor.visible;
      if (actor.visible) tag.position.set(actor.container.x, actor.container.y + (actor.seated ? 6 : 1));
    }
    for (const m of this.monitors) m.update(dt);
    this.widgets?.update(dt, this.socActive());
    this.particles.update(dt);
    this.camera.update(dt);
    if (this.hovered) this.emitHover();
    if (this.highlighted) {
      const actor = this.actors.get(this.highlighted);
      if (actor) {
        const bob = Math.round(Math.sin(this.elapsed * 6) * 2);
        this.highlight.visible = actor.visible;
        this.highlight.position.set(actor.container.x, actor.container.y - CHAR_H - 6 + bob);
      }
    }
  };

  /** Coordenadas de pantalla (CSS px del canvas) → mundo. */
  toWorld(sx: number, sy: number) {
    return { x: (sx - this.world.x) / this.world.scale.x, y: (sy - this.world.y) / this.world.scale.y };
  }

  toScreen(wx: number, wy: number) {
    return { x: wx * this.world.scale.x + this.world.x, y: wy * this.world.scale.y + this.world.y };
  }

  /** Personaje (el de más adelante si se superponen) o, si no, la zona bajo ese punto. */
  pickAt(sx: number, sy: number): Pick | null {
    const w = this.toWorld(sx, sy);
    let best: Actor | null = null;
    for (const actor of this.actors.values()) {
      if (!actor.visible) continue;
      const { x, y } = actor.container;
      if (w.x >= x - 7 && w.x <= x + 7 && w.y >= y - CHAR_H && w.y <= y + 8 && (!best || y > best.container.y)) best = actor;
    }
    if (best) return { type: 'agent', agent: best.agent };
    const tx = Math.floor(w.x / TILE);
    const ty = Math.floor(w.y / TILE);
    const zone = this.map.zones.find((z) => tx >= z.rect.x && tx < z.rect.x + z.rect.w && ty >= z.rect.y && ty < z.rect.y + z.rect.h);
    return zone ? { type: 'zone', zone: zone.id } : null;
  }

  private emitHover() {
    const actor = this.hovered ? this.actors.get(this.hovered) : null;
    if (!actor?.visible) {
      this.onHover?.(null);
      return;
    }
    const p = this.toScreen(actor.container.x, actor.container.y - CHAR_H - 2);
    this.onHover?.({ agent: actor.agent, x: p.x, y: p.y });
  }

  setZoneOutline(zone: string | null) {
    const z = zone ? this.map.zones.find((x) => x.id === zone) : null;
    this.zoneOutline.clear();
    this.zoneOutline.visible = !!z;
    if (!z) return;
    const { x, y, w, h } = z.rect;
    this.zoneOutline.rect(x * TILE, y * TILE, w * TILE, h * TILE).stroke({ color: '#f2c14e', width: 1.5, alpha: 0.9 });
  }

  focusZone(zone: string) {
    const z = this.map.zones.find((x) => x.id === zone);
    if (!z) return;
    const { x, y, w, h } = z.rect;
    const zoom = Math.min(this.app.screen.width / ((w + 4) * TILE), this.app.screen.height / ((h + 4) * TILE), 4);
    this.camera.focus((x + w / 2) * TILE, (y + h / 2) * TILE, zoom);
  }

  /** Zona donde está parado ahora un personaje. */
  pickAgentZone(agent: string): string | null {
    const actor = this.actors.get(agent);
    if (!actor?.visible) return null;
    const { x, y } = actor.tile;
    return this.map.zones.find((z) => x >= z.rect.x && x < z.rect.x + z.rect.w && y >= z.rect.y && y < z.rect.y + z.rect.h)?.id ?? null;
  }

  focusAgent(agent: string) {
    const actor = this.actors.get(agent);
    if (actor?.visible) this.camera.focus(actor.center.x, actor.center.y, Math.max(this.camera.zoom, 3.5));
  }

  status(agent: string) {
    return this.director?.status(agent) ?? null;
  }

  /** Rehace el piso a partir del historial de la sesión (sin animar). */
  resetFloor(events: OfficeEvent[]) {
    this.director?.reset(events);
  }

  handleEvent(e: OfficeEvent) {
    this.director?.handle(e);
  }

  /** Archivos del repo de trabajo → zonas. Los cambios (no la carga inicial) hacen reaccionar a los agentes. */
  setWorkspace(ws: WorkspaceState | null) {
    if (!this.widgets || !this.director) {
      this.pendingWorkspace = ws;
      return;
    }
    const initial = (ws?.root ?? null) !== this.workspaceRoot;
    this.workspaceRoot = ws?.root ?? null;
    const next = zoneModel(ws);
    const reactions = zoneReactions(initial ? null : this.widgets.current, next);
    this.widgets.setModel(next);
    for (const r of reactions) this.react(r);
  }

  setPrompt(prompt: string | null) {
    this.pendingPrompt = prompt;
    this.widgets?.setPrompt(prompt);
  }

  private react(r: ZoneReaction) {
    const widgets = this.widgets!;
    switch (r.type) {
      case 'critical': {
        widgets.raiseAlarm();
        const text = `¡Crítico! ${r.finding.id}`;
        // Avisa quien lo encontró; si ya no está en la oficina, compliance; si tampoco, el jefe se entera solo.
        const by = r.finding.auditor?.startsWith('sec-') ? r.finding.auditor : 'sec-compliance';
        if (!this.director.alert(by, text) && !this.director.alert('sec-compliance', text)) {
          const boss = this.actors.get(BOSS_ID);
          if (boss?.visible) {
            boss.shake(1.2);
            boss.bubbleText(text, 'error');
            setTimeout(() => boss.bubbleText(null), 3000);
          }
        }
        break;
      }
      case 'qa':
        if (r.light === 'rojo') widgets.blinkQa();
        else if (r.light === 'verde') for (const a of ['qa-unit', 'qa-e2e']) this.director.react(a);
        break;
      case 'hot-opportunity':
        widgets.sparkleChart();
        this.director.react('analista-mercado');
        break;
      case 'new-leads':
        this.director.react('prospector');
        break;
      case 'draft-approved': {
        const gerente = this.actors.get('gerente-ventas');
        const desk = this.map.desks.find((d) => d.agent === 'gerente-ventas');
        this.director.react('gerente-ventas');
        if (gerente?.visible) widgets.thumbsUp(gerente.container.x, gerente.container.y - CHAR_H - 8);
        else if (desk) widgets.thumbsUp(desk.seat.x * TILE + TILE / 2, (desk.seat.y - 2) * TILE);
        break;
      }
    }
  }

  /** Algún auditor está trabajando en su escritorio → el radar barre rápido. */
  private socActive() {
    for (const agent of ['sec-appsec', 'sec-cloud', 'sec-supply-chain', 'sec-compliance']) {
      const s = this.director?.status(agent);
      if (s?.present && s.where === 'desk' && !s.finished && !s.idle) return true;
    }
    return false;
  }

  setTasks(tasks: Task[]) {
    this.board?.setTasks(tasks);
  }

  setHighlight(agent: string | null) {
    this.highlighted = agent && this.actors.has(agent) ? agent : null;
    this.highlight.clear();
    if (!this.highlighted) {
      this.highlight.visible = false;
      return;
    }
    const color = profileFor(this.highlighted === 'jefe' ? null : this.highlighted).color;
    this.highlight.poly([-5, -6, 5, -6, 0, 0]).fill('#f2c14e').stroke({ color: '#121925', width: 1 });
    this.highlight.circle(0, -9, 2).fill(color);
    this.highlight.visible = true;
    const actor = this.actors.get(this.highlighted)!;
    if (actor.visible) this.camera.focus(actor.center.x, actor.center.y);
    else this.camera.focus(this.map.pois.entrance.x * TILE, this.map.pois.entrance.y * TILE);
  }

  get fps() {
    return this.initialized ? this.app.ticker.FPS : 0;
  }

  destroy() {
    this.destroyed = true;
    if (!this.initialized) return;
    this.camera?.detach();
    this.unlisten?.();
    this.app.ticker.remove(this.tick);
    this.app.destroy(true, { children: true, texture: true });
  }
}
