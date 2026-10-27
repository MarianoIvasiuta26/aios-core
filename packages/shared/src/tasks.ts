import type { Team } from './agents.ts';

export const COLUMNS = ['backlog', 'por-hacer', 'en-curso', 'en-revision', 'bloqueada', 'hecha'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
  backlog: 'Backlog',
  'por-hacer': 'Por hacer',
  'en-curso': 'En curso',
  'en-revision': 'En revisión',
  bloqueada: 'Bloqueada',
  hecha: 'Hecha',
};

const COLUMN_ALIASES: Record<string, Column> = {
  todo: 'por-hacer',
  pendiente: 'por-hacer',
  doing: 'en-curso',
  curso: 'en-curso',
  wip: 'en-curso',
  review: 'en-revision',
  revision: 'en-revision',
  blocked: 'bloqueada',
  bloqueado: 'bloqueada',
  done: 'hecha',
  hecho: 'hecha',
  cerrada: 'hecha',
};

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/** Acepta el slug, la etiqueta ("En revisión") o un alias ("done", "review"). */
export function parseColumn(input: string): Column | null {
  const s = slug(input);
  if ((COLUMNS as readonly string[]).includes(s)) return s as Column;
  for (const c of COLUMNS) if (slug(COLUMN_LABELS[c]) === s) return c;
  return COLUMN_ALIASES[s] ?? null;
}

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type Priority = (typeof PRIORITIES)[number];

export function parsePriority(input: string): Priority | null {
  const p = input.trim().toUpperCase();
  return (PRIORITIES as readonly string[]).includes(p) ? (p as Priority) : null;
}

export interface Task {
  /** `T-<n>` */
  id: string;
  title: string;
  description: string;
  team: Team | null;
  /** Id de agente del registro (`backend`, `qa-unit`…) o null. */
  assignee: string | null;
  priority: Priority;
  labels: string[];
  /** Historia o hallazgo relacionado (`HU-12`, `SEC-07`). */
  related: string | null;
  column: Column;
  /** Orden dentro de la columna (menor = más arriba). */
  position: number;
  createdAt: number;
  startedAt: number | null;
  closedAt: number | null;
  updatedAt: number;
}

export type TaskAction = 'created' | 'moved' | 'updated' | 'assigned' | 'commented';

export interface TaskHistoryEntry {
  id: number;
  taskId: string;
  at: number;
  /** Agente o `usuario` (la UI) o `sistema` (automatizaciones). */
  actor: string;
  action: TaskAction;
  from: string | null;
  to: string | null;
  detail: string | null;
}

export interface NewTask {
  title: string;
  description?: string;
  team?: Team | null;
  assignee?: string | null;
  priority?: Priority;
  labels?: string[];
  related?: string | null;
  column?: Column;
  actor?: string;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  team?: Team | null;
  assignee?: string | null;
  priority?: Priority;
  labels?: string[];
  related?: string | null;
  column?: Column;
  position?: number;
  actor?: string;
  /** Nota que queda en el historial junto al cambio. */
  note?: string;
}

export const TASK_ID_RE = /\bT-(\d+)\b/g;

/** Extrae ids de tarea (`T-12`) de un texto, sin repetidos y en orden. */
export function extractTaskIds(text: string): string[] {
  return [...new Set([...text.matchAll(TASK_ID_RE)].map((m) => `T-${m[1]}`))];
}
