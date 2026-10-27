import type { Column, Task } from '@office/shared';
import { profileFor } from '@office/shared';

const GAP = 1024;

/** Posición para insertar entre dos vecinos (null = extremo de la lista). */
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (prev !== null) return prev + GAP;
  if (next !== null) return next - GAP;
  return GAP;
}

/**
 * Calcula la posición final de `dragged` al soltarla en `column` en el índice `index`
 * de la lista ordenada de esa columna (sin contar la arrastrada).
 */
export function dropPosition(columnTasks: Task[], draggedId: string, index: number): number {
  const rest = columnTasks.filter((t) => t.id !== draggedId);
  const i = Math.max(0, Math.min(index, rest.length));
  return positionBetween(rest[i - 1]?.position ?? null, rest[i]?.position ?? null);
}

export interface BoardFilters {
  text: string;
  team: string;
  assignee: string;
  priority: string;
  label: string;
}

export const EMPTY_FILTERS: BoardFilters = { text: '', team: '', assignee: '', priority: '', label: '' };

export function matches(t: Task, f: BoardFilters): boolean {
  if (f.team && t.team !== f.team) return false;
  if (f.assignee && (f.assignee === '-' ? t.assignee !== null : t.assignee !== f.assignee)) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.label && !t.labels.includes(f.label)) return false;
  const q = f.text.trim().toLowerCase();
  if (q) {
    const who = t.assignee ? profileFor(t.assignee).displayName : '';
    const hay = `${t.id} ${t.title} ${t.description} ${t.related ?? ''} ${t.labels.join(' ')} ${who}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function byColumn(tasks: Task[]): Record<Column, Task[]> {
  const out: Record<Column, Task[]> = { backlog: [], 'por-hacer': [], 'en-curso': [], 'en-revision': [], bloqueada: [], hecha: [] };
  for (const t of tasks) out[t.column].push(t);
  for (const list of Object.values(out)) list.sort((a, b) => a.position - b.position);
  return out;
}
