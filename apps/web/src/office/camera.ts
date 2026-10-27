import type { Application, Container } from 'pixi.js';

const MAX_ZOOM = 6;
const MARGIN = 48;

/** Cámara de la oficina: zoom con rueda/pinch hacia el cursor, arrastre para desplazarse y foco animado. */
export class Camera {
  zoom = 1;
  private x = 0;
  private y = 0;
  private minZoom = 0.5;
  private anim: { x: number; y: number; zoom: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private dragged = false;
  private readonly el: HTMLCanvasElement;
  private readonly listeners: Array<[string, EventListener]> = [];

  constructor(
    private readonly app: Application,
    private readonly world: Container,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {
    this.el = app.canvas;
    this.el.style.touchAction = 'none';
    this.on('wheel', (e) => this.onWheel(e as WheelEvent));
    this.on('pointerdown', (e) => this.onDown(e as PointerEvent));
    this.on('pointermove', (e) => this.onMove(e as PointerEvent));
    this.on('pointerup', (e) => this.onUp(e as PointerEvent));
    this.on('pointercancel', (e) => this.onUp(e as PointerEvent));
    this.on('pointerleave', (e) => this.onUp(e as PointerEvent));
    app.renderer.on('resize', this.onResize);
  }

  /** true si el último gesto fue un arrastre (para no confundirlo con un click). */
  get wasDrag() {
    return this.dragged;
  }

  private on(type: string, fn: EventListener) {
    this.el.addEventListener(type, fn, { passive: false });
    this.listeners.push([type, fn]);
  }

  detach() {
    for (const [type, fn] of this.listeners) this.el.removeEventListener(type, fn);
    this.app.renderer.off('resize', this.onResize);
  }

  private get screen() {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  private fitZoom() {
    const { w, h } = this.screen;
    return Math.min(w / this.worldW, h / this.worldH);
  }

  private onResize = () => {
    this.minZoom = Math.min(1, this.fitZoom() * 0.9);
    this.apply();
  };

  /** Encaja toda la oficina en pantalla. */
  fit(animated = false) {
    this.minZoom = Math.min(1, this.fitZoom() * 0.9);
    const zoom = this.fitZoom();
    const { w, h } = this.screen;
    const target = { zoom, x: (w - this.worldW * zoom) / 2, y: (h - this.worldH * zoom) / 2 };
    if (animated) this.anim = target;
    else {
      Object.assign(this, target);
      this.apply();
    }
  }

  /** Centra un punto del mundo con una animación suave. */
  focus(wx: number, wy: number, zoom = Math.max(this.zoom, 3)) {
    const { w, h } = this.screen;
    const z = Math.min(MAX_ZOOM, zoom);
    this.anim = { zoom: z, x: w / 2 - wx * z, y: h / 2 - wy * z };
  }

  zoomBy(factor: number) {
    const { w, h } = this.screen;
    this.zoomAt(factor, w / 2, h / 2);
  }

  private zoomAt(factor: number, sx: number, sy: number) {
    this.anim = null;
    const z = Math.min(MAX_ZOOM, Math.max(this.minZoom, this.zoom * factor));
    const wx = (sx - this.x) / this.zoom;
    const wy = (sy - this.y) / this.zoom;
    this.zoom = z;
    this.x = sx - wx * z;
    this.y = sy - wy * z;
    this.apply();
  }

  update(dt: number) {
    if (!this.anim) return;
    const k = Math.min(1, dt * 7);
    this.zoom += (this.anim.zoom - this.zoom) * k;
    this.x += (this.anim.x - this.x) * k;
    this.y += (this.anim.y - this.y) * k;
    if (Math.abs(this.anim.zoom - this.zoom) < 0.002 && Math.abs(this.anim.x - this.x) < 0.5 && Math.abs(this.anim.y - this.y) < 0.5) {
      Object.assign(this, this.anim);
      this.anim = null;
    }
    this.apply();
  }

  /** Mantiene la oficina en pantalla: si entra completa, centrada; si no, sin bordes vacíos de más. */
  private clamp() {
    const { w, h } = this.screen;
    const ww = this.worldW * this.zoom;
    const wh = this.worldH * this.zoom;
    this.x = ww + MARGIN * 2 <= w ? (w - ww) / 2 : Math.min(MARGIN, Math.max(w - ww - MARGIN, this.x));
    this.y = wh + MARGIN * 2 <= h ? (h - wh) / 2 : Math.min(MARGIN, Math.max(h - wh - MARGIN, this.y));
  }

  private apply() {
    if (!this.anim) this.clamp();
    this.world.scale.set(this.zoom);
    this.world.position.set(Math.round(this.x), Math.round(this.y));
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const { x, y } = this.local(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this.zoomAt(factor, x, y);
  }

  private onDown(e: PointerEvent) {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    this.dragged = false;
    this.anim = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  }

  private onMove(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = this.local(e);
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinchDist > 0) this.zoomAt(dist / this.pinchDist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      this.pinchDist = dist;
      this.dragged = true;
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      if (!this.dragged && Math.hypot(dx, dy) < 2) return;
      this.dragged = true;
      this.x += dx;
      this.y += dy;
      this.el.style.cursor = 'grabbing';
      this.apply();
    }
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    this.el.style.cursor = '';
  }
}
