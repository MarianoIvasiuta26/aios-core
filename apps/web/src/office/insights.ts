import type { EventKind, OfficeEvent, Team } from '@office/shared';
import type { Activity, ActivityKind } from './behavior.ts';

/** Grupos de eventos para filtrar la línea de tiempo. */
export const TIMELINE_KINDS = {
  herramientas: ['tool_start'],
  errores: ['tool_error'],
  esperas: ['waiting'],
  tablero: ['task_move'],
  agentes: ['agent_start', 'agent_stop', 'session_start', 'session_end', 'stop'],
  prompts: ['prompt'],
} as const satisfies Record<string, readonly EventKind[]>;

export type TimelineKind = keyof typeof TIMELINE_KINDS;

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  herramientas: 'Herramientas',
  errores: 'Errores',
  esperas: 'Esperas',
  tablero: 'Tablero',
  agentes: 'Entradas y salidas',
  prompts: 'Prompts',
};

export interface TimelineFilter {
  agents: string[];
  teams: Team[];
  kinds: TimelineKind[];
  text: string;
}

export const EMPTY_FILTER: TimelineFilter = { agents: [], teams: [], kinds: [], text: '' };

export interface TimelineRow {
  event: OfficeEvent;
  /** Duración de la herramienta, tomada del tool_end/tool_error correspondiente. */
  durationMs: number | null;
  failed: boolean;
}

/**
 * Filas de la línea de tiempo, de la más nueva a la más vieja. Cada herramienta es una fila
 * (el fin se fusiona con el inicio) y los errores se muestran aparte para poder filtrarlos.
 */
export function timeline(events: readonly OfficeEvent[], f: TimelineFilter, limit = 400): TimelineRow[] {
  const ends = new Map<string, OfficeEvent>();
  for (const e of events) if ((e.kind === 'tool_end' || e.kind === 'tool_error') && e.toolUseId) ends.set(e.toolUseId, e);

  const allowed = new Set<EventKind>(
    (f.kinds.length ? f.kinds : (Object.keys(TIMELINE_KINDS) as TimelineKind[])).flatMap((k) => TIMELINE_KINDS[k]),
  );
  const text = f.text.trim().toLowerCase();
  const rows: TimelineRow[] = [];
  for (let i = events.length - 1; i >= 0 && rows.length < limit; i--) {
    const e = events[i]!;
    if (!allowed.has(e.kind)) continue;
    if (f.agents.length && !f.agents.includes(e.agentName)) continue;
    if (f.teams.length && !f.teams.includes(e.team)) continue;
    if (text && !`${e.summary} ${e.target ?? ''} ${e.agentName}`.toLowerCase().includes(text)) continue;
    const end = e.toolUseId ? ends.get(e.toolUseId) : undefined;
    rows.push({ event: e, durationMs: end?.durationMs ?? null, failed: e.kind === 'tool_error' || end?.kind === 'tool_error' });
  }
  return rows;
}

export interface AgentStats {
  runs: number;
  toolCalls: number;
  errors: number;
  waits: number;
  /** Archivos leídos o editados, del más reciente al más viejo. */
  files: Array<{ path: string; edited: boolean }>;
  commands: string[];
  firstSeen: number | null;
  lastSeen: number | null;
  /** Último resumen significativo ("Editando internal/api/users.go"). */
  lastSummary: string | null;
}

const FILE_READ = new Set(['Read']);
const FILE_EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function agentStats(events: readonly OfficeEvent[], agent: string): AgentStats {
  const out: AgentStats = {
    runs: 0,
    toolCalls: 0,
    errors: 0,
    waits: 0,
    files: [],
    commands: [],
    firstSeen: null,
    lastSeen: null,
    lastSummary: null,
  };
  const files = new Map<string, boolean>();
  const commands: string[] = [];
  for (const e of events) {
    if (e.agentName !== agent) continue;
    out.firstSeen ??= e.timestamp;
    out.lastSeen = e.timestamp;
    switch (e.kind) {
      case 'agent_start':
        out.runs++;
        break;
      case 'tool_start':
        out.toolCalls++;
        if (e.tool && e.target && (FILE_READ.has(e.tool) || FILE_EDIT.has(e.tool))) {
          const edited = FILE_EDIT.has(e.tool) || files.get(e.target) === true;
          files.delete(e.target);
          files.set(e.target, edited);
        }
        if (e.tool === 'Bash') commands.push(e.summary.replace(/^Corriendo: /, ''));
        break;
      case 'tool_error':
        out.errors++;
        break;
      case 'waiting':
        out.waits++;
        break;
    }
    if (e.kind !== 'tool_end') out.lastSummary = e.summary;
  }
  out.files = [...files].reverse().map(([path, edited]) => ({ path, edited }));
  out.commands = commands.reverse().slice(0, 8);
  return out;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** "hace 3 min" para el selector de piso. */
export function formatAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export interface AgentStatusLike {
  present: boolean;
  where: 'away' | 'desk' | 'cafe' | 'elsewhere';
  finished: boolean;
  idle: boolean;
  activity: Activity;
}

export type StatusTone = 'working' | 'waiting' | 'error' | 'rest' | 'away';

const ACTIVITY_LABEL: Record<ActivityKind, (d: string | null) => string> = {
  thinking: () => 'Pensando',
  reading: (d) => (d ? `Leyendo ${d}` : 'Leyendo'),
  typing: (d) => (d ? `Escribiendo ${d}` : 'Escribiendo'),
  terminal: (d) => (d ? `Terminal: ${d}` : 'En la terminal'),
  web: (d) => (d ? `En la web: ${d}` : 'En la web'),
  waiting: () => 'Esperando tu permiso',
  error: (d) => (d ? `Error: ${d}` : 'Error'),
  card: (d) => (d ? `Moviendo ${d} en el tablero` : 'En el tablero'),
  delegating: (d) => (d ? `Delegando ${d}` : 'Delegando'),
  done: () => 'Terminó',
};

/** Frase corta de qué está haciendo el personaje ahora. */
export function statusLine(s: AgentStatusLike | null, agent: string): { text: string; tone: StatusTone } {
  if (!s || !s.present) return { text: 'Fuera de la oficina', tone: 'away' };
  if (s.finished) return { text: 'Terminó su parte, en el café', tone: 'rest' };
  if (s.idle) return { text: agent === 'jefe' ? 'Sin actividad, al teléfono' : 'Sin actividad, en el café', tone: 'rest' };
  const tone: StatusTone = s.activity.kind === 'waiting' ? 'waiting' : s.activity.kind === 'error' ? 'error' : 'working';
  return { text: ACTIVITY_LABEL[s.activity.kind](s.activity.detail), tone };
}
