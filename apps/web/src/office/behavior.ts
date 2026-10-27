import { parseColumn, type Column, type OfficeEvent } from '@office/shared';

/**
 * Lógica pura: qué está haciendo cada personaje según los eventos. Sin Pixi, testeable.
 * La parte visual (caminar, poses, burbujas) la decide el director a partir de esto.
 */

export type ActivityKind =
  | 'thinking' // presente, entre herramientas
  | 'reading'
  | 'typing'
  | 'terminal'
  | 'web'
  | 'waiting' // pidió permiso / espera al usuario
  | 'error'
  | 'card' // mueve una tarjeta del tablero
  | 'delegating' // el jefe lanza un subagente
  | 'done'; // terminó su parte

export interface Activity {
  kind: ActivityKind;
  /** Texto corto para la burbuja (archivo, comando, búsqueda). */
  detail: string | null;
  /** Columna destino cuando mueve una tarjeta. */
  column?: Column;
  /** Lenguaje para el monitor de backend. */
  language?: Language | null;
}

export type Language = 'go' | 'php' | 'js';

export type Presence = 'enter' | 'finish' | 'leave' | null;

export interface Interpretation {
  agent: string;
  activity: Activity;
  presence: Presence;
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);

const BUBBLE_MAX = 28;

export function shorten(text: string, max = BUBBLE_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function languageOf(file: string | null): Language | null {
  if (!file) return null;
  if (/\.go$/.test(file)) return 'go';
  if (/\.php$/.test(file)) return 'php';
  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) return 'js';
  return null;
}

function webDetail(e: OfficeEvent): string {
  if (e.tool === 'WebFetch' && e.target) {
    try {
      return new URL(e.target).host;
    } catch {
      return shorten(e.target);
    }
  }
  return shorten(e.target ?? 'web');
}

/** Interpreta un evento para el personaje que lo generó. null = no cambia nada visible. */
export function interpret(e: OfficeEvent): Interpretation | null {
  const agent = e.agentName;
  const at = (kind: ActivityKind, detail: string | null = null, extra: Partial<Activity> = {}): Interpretation => ({
    agent,
    activity: { kind, detail, ...extra },
    presence: null,
  });

  switch (e.kind) {
    case 'agent_start':
      return { agent, activity: { kind: 'thinking', detail: null }, presence: 'enter' };
    case 'agent_stop':
      return { agent, activity: { kind: 'done', detail: null }, presence: 'finish' };
    case 'session_start':
      return { agent, activity: { kind: 'thinking', detail: null }, presence: 'enter' };
    case 'session_end':
      return { agent, activity: { kind: 'done', detail: null }, presence: 'leave' };
    case 'prompt':
      return at('thinking', e.target ? shorten(e.target) : null);
    case 'stop':
      return at('done');
    case 'waiting':
      return at('waiting', 'Necesito permiso');
    case 'task_move': {
      const [id, col] = (e.target ?? '').split(' ');
      const column = col ? parseColumn(col) : null;
      return at('card', id ?? null, column ? { column } : {});
    }
    case 'tool_error':
      return at('error', shorten(e.summary.replace(/^Error en \w+: /, '')));
    case 'tool_end':
      return at('thinking');
    case 'tool_start': {
      const tool = e.tool ?? '';
      if (READ_TOOLS.has(tool)) {
        const detail = tool === 'Read' && e.target ? basename(e.target) : shorten(e.target ?? tool);
        return at('reading', detail, { language: languageOf(e.target) });
      }
      if (WRITE_TOOLS.has(tool)) return at('typing', e.target ? basename(e.target) : null, { language: languageOf(e.target) });
      if (tool === 'Bash') return at('terminal', shorten(e.summary.replace(/^Corriendo: /, '')));
      if (WEB_TOOLS.has(tool)) return at('web', webDetail(e));
      if (tool === 'Agent' || tool === 'Task') return at('delegating', e.target ? `→ ${e.target}` : null);
      return at('thinking', shorten(e.summary));
    }
    default:
      return null;
  }
}

export interface AgentSnapshot {
  agent: string;
  /** Está en la oficina (entró y no se fue). */
  present: boolean;
  /** Terminó su trabajo (está en el café). */
  finished: boolean;
  activity: Activity;
  lastEventAt: number;
}

/**
 * Estado final de cada personaje tras una lista de eventos (para reconstruir la oficina al recargar
 * o al cambiar de piso, sin animar todo el historial).
 */
export function reduceAgents(events: OfficeEvent[]): Map<string, AgentSnapshot> {
  const out = new Map<string, AgentSnapshot>();
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)) {
    const it = interpret(e);
    if (!it) continue;
    const prev = out.get(it.agent);
    const snap: AgentSnapshot = prev ?? { agent: it.agent, present: false, finished: false, activity: it.activity, lastEventAt: e.timestamp };
    snap.lastEventAt = e.timestamp;
    snap.activity = it.activity;
    if (it.presence === 'enter') {
      snap.present = true;
      snap.finished = false;
    } else if (it.presence === 'finish') {
      snap.finished = true;
    } else if (it.presence === 'leave') {
      snap.present = false;
    } else {
      // Cualquier actividad implica presencia (los hooks pueden haberse instalado a mitad de sesión).
      snap.present = true;
      if (it.activity.kind !== 'done') snap.finished = false;
    }
    out.set(it.agent, snap);
  }
  // Al cerrarse la sesión se van todos.
  const ended = events.some((e) => e.kind === 'session_end' && e.agentName === 'jefe');
  if (ended) for (const s of out.values()) s.present = false;
  return out;
}

/** Tiempo mínimo que se muestra cada actividad para que las herramientas rápidas se lleguen a ver. */
export const MIN_SHOW_MS: Record<ActivityKind, number> = {
  thinking: 0,
  reading: 1100,
  typing: 1300,
  terminal: 1300,
  web: 1500,
  waiting: 600,
  error: 2200,
  card: 0,
  delegating: 1200,
  done: 0,
};

export const IDLE_AFTER_MS = 60_000;
