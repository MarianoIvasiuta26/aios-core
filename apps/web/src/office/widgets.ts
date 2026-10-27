import { Container, Graphics, Text } from 'pixi.js';
import type { Priority, Severity } from '@office/shared';
import { TILE, type OfficeMap, type Rect, type WallPropKind } from './map.ts';
import type { Particles } from './actor.ts';
import type { ZoneModel } from './zones.ts';

const FONT = '"Pixelify Sans", monospace';

function text(size: number, fill: string, wrap?: number) {
  const t = new Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: size,
      fill,
      lineHeight: size + 1,
      ...(wrap ? { wordWrap: true, wordWrapWidth: wrap, breakWords: true } : {}),
    },
    resolution: 8,
  });
  t.roundPixels = true;
  return t;
}

// Dígitos de 3×5 para contadores: nítidos a cualquier zoom y sin rasterizar texto.
const DIGITS = [
  '111101101101111',
  '010110010010111',
  '111001111100111',
  '111001111001111',
  '101101111001001',
  '111100111001111',
  '111100111101111',
  '111001001001001',
  '111101111101111',
  '111101111001111',
];

function digits(g: Graphics, value: number, x: number, y: number, color: string, align: 'left' | 'right' | 'center' = 'left', k = 1) {
  const s = String(Math.max(0, Math.round(value)));
  const w = (s.length * 4 - 1) * k;
  let cx = align === 'right' ? x - w : align === 'center' ? x - Math.floor(w / 2) : x;
  for (const ch of s) {
    const bits = DIGITS[Number(ch)]!;
    for (let i = 0; i < 15; i++) if (bits[i] === '1') g.rect(cx + (i % 3) * k, y + Math.floor(i / 3) * k, k, k);
    cx += 4 * k;
  }
  g.fill(color);
}

const PRIO_STICKY: Record<Priority, string> = { P0: '#ff8a80', P1: '#ffd27a', P2: '#fff2a8', P3: '#ffffff' };
export const SEVERITY_COLOR: Record<Severity, string> = {
  Crítica: '#ff3b3b',
  Alta: '#ff9f43',
  Media: '#ffd43b',
  Baja: '#4dabf7',
  Info: '#adb5bd',
};
const LEAD_COLOR: Record<string, string> = { nuevo: '#e5484d', investigado: '#f0a830', contactado: '#3fb950' };
const QA_COLORS = { verde: ['#1f3a26', '#4ade80'], amarillo: ['#3d3a1c', '#facc15'], rojo: ['#3d1f1f', '#ef4444'] } as const;

const px = (r: Rect) => ({ x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE });

interface Pin {
  company: string;
  x: number;
  y: number;
  color: string;
  /** 0→1 mientras cae. */
  drop: number;
}

interface Pop {
  g: Graphics;
  x: number;
  y: number;
  t: number;
}

/**
 * Lo que se ve en las zonas según los archivos del workspace: corcho del backlog, semáforo de QA,
 * pantallas y radar del SOC, embudo, oportunidades, mapa de leads y el pizarrón con el pedido actual.
 */
export class ZoneWidgets {
  readonly container = new Container();
  private model: ZoneModel | null = null;
  private readonly rects: Partial<Record<WallPropKind, { x: number; y: number; w: number; h: number }>> = {};

  private readonly whiteboard = new Graphics();
  private readonly promptText = text(5, '#24324a', 132);
  private prompt: string | null = null;

  private readonly backlog = new Graphics();
  private stickyPop = new Map<string, number>();

  private readonly qa = new Graphics();
  private qaBlink = 0;

  private readonly screens = new Graphics();
  private readonly screenLabels: Text[] = [];
  private readonly radar = new Graphics();
  private readonly radarAt: { x: number; y: number; r: number } | null;
  private sweep = 0;
  /** Brillo de cada punto del radar (se enciende cuando pasa la barrida). */
  private readonly dotGlow = new Map<string, number>();
  private alarm = 0;
  private readonly socWash = new Graphics();
  private readonly socRect: { x: number; y: number; w: number; h: number };

  private readonly funnel = new Graphics();
  private readonly chart = new Graphics();
  private chartSpark = 0;

  private readonly map = new Graphics();
  private readonly mapAt: { x: number; y: number; w: number; h: number } | null;
  private readonly leadsLabel = text(5, '#f4eedf');
  private readonly leadsBg = new Graphics();
  private pins: Pin[] = [];

  private readonly pops: Pop[] = [];
  private elapsed = 0;

  constructor(
    officeMap: OfficeMap,
    private readonly particles: Particles,
  ) {
    for (const p of officeMap.wallProps) this.rects[p.kind] = px(p.rect);
    const radar = officeMap.furniture.find((f) => f.kind === 'radar-console');
    this.radarAt = radar ? { x: (radar.x + radar.w / 2) * TILE, y: radar.y * TILE + 18, r: 15 } : null;
    const pin = officeMap.furniture.find((f) => f.kind === 'pinboard-map');
    this.mapAt = pin ? px(pin) : null;
    this.socRect = px(officeMap.zones.find((z) => z.id === 'soc')!.rect);

    const wb = this.rects.whiteboard;
    if (wb) this.promptText.position.set(wb.x + 6, wb.y + 5);
    this.container.addChild(
      this.whiteboard,
      this.promptText,
      this.backlog,
      this.qa,
      this.screens,
      this.radar,
      this.funnel,
      this.chart,
      this.map,
      this.leadsBg,
      this.leadsLabel,
      this.socWash,
    );

    const sw = this.rects['screen-wall'];
    if (sw) {
      const names = ['Postura', 'Crítica', 'Alta', 'Media', 'Baja', 'Críticos'];
      const xs = [sw.x + 32, sw.x + 80, sw.x + 112, sw.x + 144, sw.x + 176, sw.x + 224];
      names.forEach((n, i) => {
        const t = text(5, '#8fb3c9');
        t.text = n;
        t.anchor.set(0.5, 0);
        t.position.set(xs[i]!, sw.y + 4);
        this.screenLabels.push(t);
        this.container.addChild(t);
      });
    }
    this.leadsLabel.anchor.set(0.5, 0);
    this.setModel(null);
    this.setPrompt(null);
  }

  get current() {
    return this.model;
  }

  setModel(model: ZoneModel | null) {
    const prev = this.model;
    this.model = model;
    const now = this.elapsed;
    for (const s of model?.backlog?.stories ?? [])
      if (prev && !prev.backlog?.stories.some((p) => p.id === s.id && p.column === s.column)) this.stickyPop.set(s.id, now);
    this.drawBacklog();
    this.drawQa();
    this.drawScreens();
    this.drawFunnel();
    this.syncPins(prev !== null);
  }

  setPrompt(prompt: string | null) {
    if (prompt === this.prompt && this.promptText.text) return;
    this.prompt = prompt;
    const wb = this.rects.whiteboard;
    if (!wb) return;
    const g = this.whiteboard.clear();
    g.rect(wb.x - 1, wb.y + 2, wb.w + 2, wb.h - 3).fill('#9aa0a8');
    g.rect(wb.x, wb.y + 3, wb.w, wb.h - 5).fill('#f7f8f8');
    g.rect(wb.x + wb.w - 30, wb.y + wb.h - 4, 18, 2).fill('#c0504d');
    const clean = prompt?.replace(/\s+/g, ' ').trim() ?? '';
    this.promptText.text = clean ? (clean.length > 110 ? `${clean.slice(0, 108)}…` : clean) : 'Sala libre';
    this.promptText.style.fill = clean ? '#24324a' : '#a9b0ba';
  }

  /** Alarma roja del SOC por un hallazgo crítico nuevo. */
  raiseAlarm() {
    this.alarm = 8;
  }

  /** El semáforo parpadea al cambiar a rojo. */
  blinkQa() {
    this.qaBlink = 3;
  }

  /** Destellos en el gráfico de oportunidades. */
  sparkleChart() {
    this.chartSpark = 6;
    const r = this.rects['chart-wall'];
    if (!r) return;
    for (let i = 0; i < 14; i++) {
      this.particles.emit(r.x + 10 + Math.random() * (r.w - 20), r.y + 8 + Math.random() * 16, i % 2 ? '#f2c14e' : '#fff3c4', {
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 25,
        g: 40,
        life: 0.9,
      });
    }
  }

  /** Pulgar arriba flotando sobre un punto del mundo. */
  thumbsUp(x: number, y: number) {
    const g = new Graphics();
    // Pulgar de 7×8 en pixel art, con borde oscuro.
    g.rect(-4, -1, 9, 7).fill('#3a2a1a');
    g.rect(-1, -6, 4, 6).fill('#3a2a1a');
    g.rect(-3, 0, 7, 5).fill('#f2c39b');
    g.rect(0, -5, 2, 5).fill('#f2c39b');
    g.rect(-3, 0, 2, 5).fill('#4e7ab5');
    this.container.addChild(g);
    this.pops.push({ g, x, y, t: 0 });
  }

  update(dt: number, socActive: boolean) {
    this.elapsed += dt;
    this.qaBlink = Math.max(0, this.qaBlink - dt);
    this.alarm = Math.max(0, this.alarm - dt);
    this.chartSpark = Math.max(0, this.chartSpark - dt);

    if (this.stickyPop.size > 0) this.drawBacklog();
    if (this.qaBlink > 0) this.drawQa();
    this.drawRadar(dt, socActive);
    this.drawChart();
    this.drawAlarm();
    this.drawPins(dt);

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]!;
      p.t += dt;
      const k = Math.min(1, p.t / 0.25);
      p.g.scale.set(0.4 + 0.6 * k);
      p.g.position.set(Math.round(p.x), Math.round(p.y - 10 * Math.min(1, p.t / 1.8)));
      p.g.alpha = p.t < 1.4 ? 1 : Math.max(0, 1 - (p.t - 1.4) / 0.6);
      if (p.t >= 2) {
        p.g.destroy();
        this.pops.splice(i, 1);
      }
    }
  }

  // ── Producto ────────────────────────────────────────────────────────────

  private drawBacklog() {
    const r = this.rects['backlog-board'];
    if (!r) return;
    const g = this.backlog.clear();
    g.rect(r.x - 1, r.y - 6, r.w + 2, r.h + 8).fill('#4a3020');
    g.rect(r.x, r.y - 5, r.w, r.h + 6).fill('#ece6d6');
    const stories = this.model?.backlog?.stories ?? [];
    stories.forEach((s, i) => {
      const x = r.x + 3 + i * 14;
      const born = this.stickyPop.get(s.id);
      const age = born === undefined ? 1 : Math.min(1, (this.elapsed - born) / 0.5);
      if (age >= 1) this.stickyPop.delete(s.id);
      const lift = Math.round((1 - age) * 4);
      const y = r.y - 3 + (i % 2) * 6 - lift;
      const done = s.column === 'hecha';
      g.rect(x, y, 10, 5).fill(done ? '#cfe8c9' : PRIO_STICKY[s.priority ?? 'P3']);
      g.rect(x + 4, y, 2, 1).fill(done ? '#3fb950' : '#c0504d');
      if (done) g.rect(x + 3, y + 2, 4, 1).fill('#3fb950');
      else if (s.column === 'en-curso' || s.column === 'en-revision') g.rect(x + 1, y + 3, 8, 1).fill('#4e7ab5');
    });
  }

  // ── QA ──────────────────────────────────────────────────────────────────

  private drawQa() {
    const r = this.rects['traffic-light'];
    if (!r) return;
    const g = this.qa.clear();
    g.roundRect(r.x + 4, r.y + 1, 24, 10, 2).fill('#1c1f26');
    const light = this.model?.qa.light ?? null;
    const blinkOff = this.qaBlink > 0 && Math.floor(this.qaBlink * 6) % 2 === 0;
    (['verde', 'amarillo', 'rojo'] as const).forEach((c, i) => {
      const on = light === c && !blinkOff;
      const [dim, lit] = QA_COLORS[c];
      const cx = r.x + 9 + i * 7;
      if (on) g.circle(cx, r.y + 6, 5).fill({ color: lit, alpha: 0.25 });
      g.circle(cx, r.y + 6, 2.5).fill(on ? lit : dim);
    });
  }

  // ── SOC ─────────────────────────────────────────────────────────────────

  private drawScreens() {
    const r = this.rects['screen-wall'];
    if (!r) return;
    const g = this.screens.clear();
    for (let i = 0; i < 8; i++) {
      const sx = r.x + i * 32;
      g.rect(sx + 1, r.y + 3, 30, 24).fill('#0b0f17');
      g.rect(sx + 2, r.y + 4, 28, 22).fill('#0f1b26');
    }
    const soc = this.model?.soc;
    // Postura (pantallas 1 y 2): número y barra.
    if (soc?.posture !== null && soc?.posture !== undefined) {
      const p = soc.posture;
      const color = p >= 80 ? '#3fb950' : p >= 50 ? '#f0a830' : '#e5484d';
      digits(g, p, r.x + 32, r.y + 11, color, 'center', 2);
      g.rect(r.x + 6, r.y + 23, 52, 2).fill('#1d2a36');
      g.rect(r.x + 6, r.y + 23, Math.round((52 * p) / 100), 2).fill(color);
    } else {
      g.rect(r.x + 26, r.y + 16, 12, 1).fill('#2c3e50');
    }
    // Conteos por severidad (pantallas 3 a 6).
    (['Crítica', 'Alta', 'Media', 'Baja'] as const).forEach((sev, i) => {
      const n = soc?.counts[sev] ?? 0;
      const x = r.x + 64 + i * 32 + 16;
      digits(g, n, x, r.y + 12, n > 0 ? SEVERITY_COLOR[sev] : '#2c3e50', 'center', 2);
      if (n > 0) g.rect(x - 8, r.y + 24, 16, 1).fill(SEVERITY_COLOR[sev]);
    });
    // Pantallas 7 y 8 (alarma): se dibujan en drawAlarm.
  }

  private drawAlarm() {
    const r = this.rects['screen-wall'];
    const criticals = this.model?.soc.criticals.length ?? 0;
    const g = this.socWash.clear();
    if (r) {
      const x = r.x + 194;
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * (this.alarm > 0 ? 12 : 4));
      if (criticals > 0) {
        g.rect(x, r.y + 4, 60, 22).fill({ color: '#ff3b3b', alpha: 0.25 + 0.45 * pulse });
        digits(g, criticals, x + 30, r.y + 12, '#ffffff', 'center', 2);
      } else {
        g.circle(x + 30, r.y + 16, 3).fill({ color: '#3fb950', alpha: 0.8 });
      }
    }
    // Baliza: mientras haya críticos abiertos el SOC se tiñe de rojo (fuerte durante la alarma).
    if (criticals > 0 || this.alarm > 0) {
      const s = this.socRect;
      const strength = this.alarm > 0 ? 0.12 + 0.1 * Math.sin(this.elapsed * 10) : 0.04 + 0.02 * Math.sin(this.elapsed * 3);
      g.rect(s.x - TILE, s.y - TILE, s.w + 2 * TILE, s.h + 2 * TILE).fill({ color: '#ff2020', alpha: Math.max(0, strength) });
    }
  }

  private drawRadar(dt: number, active: boolean) {
    const at = this.radarAt;
    if (!at) return;
    const prev = this.sweep;
    this.sweep = (this.sweep + dt * (active ? 3.2 : 0.8)) % (Math.PI * 2);
    const g = this.radar.clear();
    g.circle(at.x, at.y, at.r).fill('#0c1f1a').stroke({ color: '#2f7a5f', width: 1 });
    g.circle(at.x, at.y, 10).stroke({ color: '#1f5a46', width: 1 });
    g.circle(at.x, at.y, 5).stroke({ color: '#1f5a46', width: 1 });
    // Estela de la barrida.
    for (let i = 0; i < 6; i++) {
      const a = this.sweep - i * 0.12;
      g.moveTo(at.x, at.y)
        .lineTo(at.x + Math.cos(a) * (at.r - 1), at.y + Math.sin(a) * (at.r - 1))
        .stroke({ color: '#6bf0b4', width: 1, alpha: (active ? 0.9 : 0.6) * (1 - i / 6) });
    }
    for (const d of this.model?.soc.dots ?? []) {
      const passed = angleBetween(d.angle, prev, this.sweep);
      const glow = passed ? 1 : Math.max(0, (this.dotGlow.get(d.id) ?? 0.35) - dt * 0.6);
      this.dotGlow.set(d.id, glow);
      const critical = d.severity === 'Crítica';
      const alpha = Math.max(critical ? 0.6 + 0.4 * Math.sin(this.elapsed * 8) : 0.35, glow);
      const x = Math.round(at.x + Math.cos(d.angle) * d.radius * (at.r - 3));
      const y = Math.round(at.y + Math.sin(d.angle) * d.radius * (at.r - 3));
      if (critical) g.circle(x, y, 3).fill({ color: SEVERITY_COLOR[d.severity], alpha: alpha * 0.3 });
      g.rect(x - 1, y - 1, 2, 2).fill({ color: SEVERITY_COLOR[d.severity], alpha });
    }
  }

  // ── Comercial ───────────────────────────────────────────────────────────

  private drawFunnel() {
    const r = this.rects.funnel;
    if (!r) return;
    const g = this.funnel.clear();
    g.rect(r.x, r.y + 2, r.w, r.h - 3).fill('#f4f6f5');
    const stages = this.model?.funnel;
    const colors = ['#3a0ca3', '#4361ee', '#4895ef', '#4cc9f0', '#3fb950'];
    const shape = [0.95, 0.78, 0.6, 0.44, 0.3];
    const max = Math.max(1, ...(stages ?? []).map((s) => s.count));
    const room = r.w - 26;
    shape.forEach((ratio, i) => {
      const y = r.y + 5 + i * 5;
      const count = stages?.[i]?.count ?? 0;
      const full = Math.round(room * ratio);
      const x = r.x + 4 + Math.round((room - full) / 2);
      g.rect(x, y, full, 4).fill({ color: colors[i]!, alpha: 0.18 });
      if (stages) {
        const filled = count > 0 ? Math.max(3, Math.round((full * count) / max)) : 0;
        if (filled) g.rect(x + Math.round((full - filled) / 2), y, filled, 4).fill(colors[i]!);
        digits(g, count, r.x + r.w - 4, y, '#22283a', 'right');
      }
    });
  }

  private drawChart() {
    const r = this.rects['chart-wall'];
    if (!r) return;
    const g = this.chart.clear();
    g.rect(r.x, r.y + 2, r.w, r.h - 3).fill('#22283a');
    const ops = this.model?.opportunities ?? [];
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * (this.chartSpark > 0 ? 9 : 3));
    const slots = 6;
    const bw = 16;
    const gap = Math.floor((r.w - 8 - slots * bw) / (slots - 1));
    const base = r.y + 28;
    for (let i = 0; i < slots; i++) {
      const x = r.x + 4 + i * (bw + gap);
      const o = ops[i];
      if (!o) {
        g.rect(x, base - 2, bw, 2).fill('#2c3450');
        continue;
      }
      const h = Math.max(3, Math.round((o.score / 10) * 21));
      if (o.hot) g.rect(x - 2, base - h - 2, bw + 4, h + 3).fill({ color: '#f2c14e', alpha: 0.15 + 0.35 * pulse });
      g.rect(x, base - h, bw, h).fill(o.hot ? '#f2c14e' : '#7209b7');
      if (h >= 8) digits(g, o.score, x + bw / 2, base - h + 2, o.hot ? '#3a2a00' : '#e9d8fd', 'center');
    }
  }

  private syncPins(animate: boolean) {
    const at = this.mapAt;
    const leads = this.model?.leads;
    const next: Pin[] = (leads?.pins ?? []).map((p) => {
      const old = this.pins.find((o) => o.company === p.company);
      return {
        company: p.company,
        x: Math.round((at?.x ?? 0) + 4 + p.x * ((at?.w ?? 0) - 8)),
        y: Math.round((at?.y ?? 0) + 4 + p.y * ((at?.h ?? 0) - 8)),
        color: LEAD_COLOR[p.status] ?? LEAD_COLOR.nuevo!,
        drop: old ? old.drop : animate ? 0 : 1,
      };
    });
    this.pins = next;
    if (!at) return;
    this.leadsLabel.text = leads ? `Leads: ${leads.count}` : 'Leads: 0';
    this.leadsLabel.position.set(at.x + at.w / 2, at.y + at.h + 1);
    const w = this.leadsLabel.width + 6;
    this.leadsBg
      .clear()
      .roundRect(at.x + at.w / 2 - w / 2, at.y + at.h, w, this.leadsLabel.height + 1, 2)
      .fill({ color: '#121925', alpha: 0.8 });
  }

  private drawPins(dt: number) {
    const g = this.map.clear();
    for (const p of this.pins) {
      p.drop = Math.min(1, p.drop + dt * 2.2);
      const fall = Math.round((1 - p.drop * p.drop) * 12);
      g.rect(p.x, p.y + 1, 1, 2).fill({ color: '#000000', alpha: 0.35 * p.drop });
      g.rect(p.x - 1, p.y - 2 - fall, 3, 3).fill(p.color);
      g.rect(p.x - 1, p.y - 2 - fall, 1, 1).fill('#ffffff');
    }
  }
}

/** ¿El ángulo `a` quedó entre `from` y `to` (girando en sentido positivo)? */
function angleBetween(a: number, from: number, to: number): boolean {
  const TAU = Math.PI * 2;
  const norm = (x: number) => ((x % TAU) + TAU) % TAU;
  const span = norm(to - from);
  return norm(a - from) <= span;
}
