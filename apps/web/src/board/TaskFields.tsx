import { AGENTS, COLUMNS, COLUMN_LABELS, PRIORITIES, TEAMS, TEAM_LABELS, type Column, type Priority, type Team } from '@office/shared';

export interface TaskDraft {
  title: string;
  description: string;
  team: Team | '';
  assignee: string;
  priority: Priority;
  labels: string;
  related: string;
  column: Column;
}

export const EMPTY_DRAFT: TaskDraft = {
  title: '',
  description: '',
  team: '',
  assignee: '',
  priority: 'P2',
  labels: '',
  related: '',
  column: 'backlog',
};

export function draftToPayload(d: TaskDraft) {
  return {
    title: d.title.trim(),
    description: d.description,
    team: d.team || null,
    assignee: d.assignee || null,
    priority: d.priority,
    labels: d.labels
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    related: d.related.trim() || null,
    column: d.column,
  };
}

interface Props {
  draft: TaskDraft;
  onChange: (d: TaskDraft) => void;
  autoFocus?: boolean;
}

/** Campos de una tarjeta; los usan el diálogo de creación y el panel de detalle. */
export function TaskFields({ draft, onChange, autoFocus }: Props) {
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <div className="fields">
      <label className="span-2">
        Título
        <input autoFocus={autoFocus} required value={draft.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className="span-2">
        Descripción
        <textarea rows={4} value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </label>
      <label>
        Asignada a
        <select value={draft.assignee} onChange={(e) => set('assignee', e.target.value)}>
          <option value="">Sin asignar</option>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Equipo
        <select value={draft.team} onChange={(e) => set('team', e.target.value as Team | '')}>
          <option value="">Según el asignado</option>
          {TEAMS.filter((t) => t !== 'externo').map((t) => (
            <option key={t} value={t}>
              {TEAM_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prioridad
        <select value={draft.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Columna
        <select value={draft.column} onChange={(e) => set('column', e.target.value as Column)}>
          {COLUMNS.map((c) => (
            <option key={c} value={c}>
              {COLUMN_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Etiquetas
        <input placeholder="auth, go" value={draft.labels} onChange={(e) => set('labels', e.target.value)} />
      </label>
      <label>
        Historia o hallazgo
        <input placeholder="HU-12 o SEC-07" value={draft.related} onChange={(e) => set('related', e.target.value)} />
      </label>
    </div>
  );
}
