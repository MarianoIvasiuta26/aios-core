/**
 * Sonidos generados con WebAudio: cortos, suaves y sin archivos. Apagados por defecto; el navegador
 * recién deja sonar después de un click, así que el contexto se crea al activarlos.
 */
export type Cue = 'enter' | 'done' | 'error' | 'waiting' | 'card' | 'alarm' | 'approved' | 'hot';

interface Note {
  /** Frecuencia en Hz (o [desde, hasta] para un barrido). */
  f: number | [number, number];
  /** Inicio y duración en segundos. */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

const CUES: Record<Cue, Note[]> = {
  // Puerta: dos notas ascendentes muy suaves.
  enter: [
    { f: 523, at: 0, dur: 0.09, type: 'triangle' },
    { f: 784, at: 0.08, dur: 0.12, type: 'triangle' },
  ],
  // Terminó: acorde mayor arpegiado.
  done: [
    { f: 659, at: 0, dur: 0.1, type: 'sine' },
    { f: 784, at: 0.07, dur: 0.1, type: 'sine' },
    { f: 1047, at: 0.14, dur: 0.18, type: 'sine' },
  ],
  // Error: un "bup" grave que baja.
  error: [{ f: [220, 150], at: 0, dur: 0.18, type: 'square', gain: 0.35 }],
  // Esperando permiso: ping agudo.
  waiting: [{ f: 1318, at: 0, dur: 0.16, type: 'sine', gain: 0.7 }],
  // Tarjeta: clic de papel.
  card: [{ f: [900, 600], at: 0, dur: 0.05, type: 'triangle', gain: 0.6 }],
  // Hallazgo crítico: dos tonos alternados, tres veces.
  alarm: [0, 1, 2].flatMap((i) => [
    { f: 880, at: i * 0.32, dur: 0.14, type: 'square' as const, gain: 0.3 },
    { f: 660, at: i * 0.32 + 0.16, dur: 0.14, type: 'square' as const, gain: 0.3 },
  ]),
  // Borrador aprobado: "ding".
  approved: [
    { f: 988, at: 0, dur: 0.08, type: 'sine' },
    { f: 1319, at: 0.06, dur: 0.3, type: 'sine' },
  ],
  // Oportunidad caliente: brillo corto.
  hot: [
    { f: 1568, at: 0, dur: 0.06, type: 'sine', gain: 0.5 },
    { f: 2093, at: 0.05, dur: 0.12, type: 'sine', gain: 0.5 },
  ],
};

const VOLUME = 0.06;
/** Mismo sonido no más seguido que esto (en una ráfaga de eventos suena una vez). */
const MIN_GAP_MS = 250;

export class Sound {
  private ctx: AudioContext | null = null;
  private readonly last = new Map<Cue, number>();
  enabled = false;

  /** Llamar desde un click (política de autoplay). */
  enable() {
    this.enabled = true;
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  disable() {
    this.enabled = false;
  }

  play(cue: Cue) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.last.get(cue) ?? 0) < MIN_GAP_MS) return;
    this.last.set(cue, now);
    const t0 = ctx.currentTime + 0.01;
    for (const n of CUES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? 'sine';
      const start = t0 + n.at;
      const end = start + n.dur;
      if (Array.isArray(n.f)) {
        osc.frequency.setValueAtTime(n.f[0], start);
        osc.frequency.exponentialRampToValueAtTime(n.f[1], end);
      } else osc.frequency.setValueAtTime(n.f, start);
      // Envolvente corta para que no haga clic al empezar ni al cortar.
      const peak = VOLUME * (n.gain ?? 1);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }
}

export const sound = new Sound();
