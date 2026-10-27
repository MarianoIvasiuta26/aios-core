import type Database from 'better-sqlite3';
import {
  COLUMNS,
  profileFor,
  type Column,
  type NewTask,
  type Priority,
  type Task,
  type TaskAction,
  type TaskHistoryEntry,
  type TaskPatch,
  type Team,
} from '@office/shared';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  team         TEXT,
  assignee     TEXT,
  priority     TEXT NOT NULL DEFAULT 'P2',
  labels       TEXT NOT NULL DEFAULT '[]',
  related      TEXT,
  col          TEXT NOT NULL DEFAULT 'backlog',
  position     REAL NOT NULL,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  closed_at    INTEGER,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_history (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  task_seq INTEGER NOT NULL REFERENCES tasks(seq) ON DELETE CASCADE,
  at       INTEGER NOT NULL,
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  from_val TEXT,
  to_val   TEXT,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS task_history_task ON task_history(task_seq, at);
`;

interface TaskRow {
  seq: number;
  title: string;
  description: string;
  team: string | null;
  assignee: string | null;
  priority: string;
  labels: string;
  related: string | null;
  col: string;
  position: number;
  created_at: number;
  started_at: number | null;
  closed_at: number | null;
  updated_at: number;
}

interface HistoryRow {
  id: number;
  task_seq: number;
  at: number;
  actor: string;
  action: string;
  from_val: string | null;
  to_val: string | null;
  detail: string | null;
}

/** Ordena por el orden del tablero, no alfabéticamente. */
const COLUMN_ORDER = `CASE col ${COLUMNS.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ')} END`;

export class TaskError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

const toTask = (r: TaskRow): Task => ({
  id: `T-${r.seq}`,
  title: r.title,
  description: r.description,
  team: r.team as Team | null,
  assignee: r.assignee,
  priority: r.priority as Priority,
  labels: JSON.parse(r.labels) as string[],
  related: r.related,
  column: r.col as Column,
  position: r.position,
  createdAt: r.created_at,
  startedAt: r.started_at,
  closedAt: r.closed_at,
  updatedAt: r.updated_at,
});

const toEntry = (r: HistoryRow): TaskHistoryEntry => ({
  id: r.id,
  taskId: `T-${r.task_seq}`,
  at: r.at,
  actor: r.actor,
  action: r.action as TaskAction,
  from: r.from_val,
  to: r.to_val,
  detail: r.detail,
});

export function parseTaskId(id: string): number {
  const m = /^T-?(\d+)$/i.exec(id.trim());
  if (!m) throw new TaskError(400, `id de tarea inválido: ${id} (se espera T-<n>)`);
  return Number(m[1]);
}

/** Equipo por defecto: el del agente asignado. */
function teamFor(assignee: string | null | undefined): Team | null {
  if (!assignee) return null;
  const p = profileFor(assignee);
  return p.team === 'externo' ? null : p.team;
}

export interface TaskChange {
  task: Task;
  entries: TaskHistoryEntry[];
  moved: { from: Column; to: Column; by: string } | null;
}

export type TaskStore = ReturnType<typeof createTaskStore>;

export function createTaskStore(db: Database.Database, onChange: (c: TaskChange) => void, onRemove: (ids: string[]) => void = () => {}) {
  db.exec(SCHEMA);

  const getRow = db.prepare('SELECT * FROM tasks WHERE seq = ?');
  const nextPosition = db.prepare('SELECT coalesce(max(position), 0) + 1024 AS p FROM tasks WHERE col = ?');
  const addHistory = db.prepare(
    'INSERT INTO task_history (task_seq, at, actor, action, from_val, to_val, detail) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  );

  function row(seq: number): TaskRow {
    const r = getRow.get(seq) as TaskRow | undefined;
    if (!r) throw new TaskError(404, `no existe la tarea T-${seq}`);
    return r;
  }

  function log(seq: number, at: number, actor: string, action: TaskAction, from: string | null, to: string | null, detail: string | null) {
    return toEntry(addHistory.get(seq, at, actor, action, from, to, detail) as HistoryRow);
  }

  const create = db.transaction((input: NewTask, now: number): TaskChange => {
    const title = input.title?.trim();
    if (!title) throw new TaskError(400, 'el título es obligatorio');
    const column = input.column ?? 'backlog';
    const position = (nextPosition.get(column) as { p: number }).p;
    const assignee = input.assignee ?? null;
    const info = db
      .prepare(
        `INSERT INTO tasks (title, description, team, assignee, priority, labels, related, col, position,
                            created_at, started_at, closed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        title,
        input.description ?? '',
        input.team ?? teamFor(assignee),
        assignee,
        input.priority ?? 'P2',
        JSON.stringify(input.labels ?? []),
        input.related ?? null,
        column,
        position,
        now,
        column === 'en-curso' ? now : null,
        column === 'hecha' ? now : null,
        now,
      );
    const seq = Number(info.lastInsertRowid);
    const entry = log(seq, now, input.actor ?? 'usuario', 'created', null, column, title);
    return { task: toTask(row(seq)), entries: [entry], moved: null };
  });

  const update = db.transaction((id: string, patch: TaskPatch, now: number): TaskChange => {
    const seq = parseTaskId(id);
    const before = row(seq);
    const actor = patch.actor ?? 'usuario';
    const entries: TaskHistoryEntry[] = [];
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      values.push(v);
    };

    const changed: string[] = [];
    if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== before.title) {
      set('title', patch.title.trim());
      changed.push('título');
    }
    if (patch.description !== undefined && patch.description !== before.description) {
      set('description', patch.description);
      changed.push('descripción');
    }
    if (patch.priority !== undefined && patch.priority !== before.priority) {
      set('priority', patch.priority);
      changed.push(`prioridad ${before.priority}→${patch.priority}`);
    }
    if (patch.labels !== undefined && JSON.stringify(patch.labels) !== before.labels) {
      set('labels', JSON.stringify(patch.labels));
      changed.push('etiquetas');
    }
    if (patch.related !== undefined && patch.related !== before.related) {
      set('related', patch.related);
      changed.push('relacionado');
    }
    if (patch.team !== undefined && patch.team !== before.team) {
      set('team', patch.team);
      changed.push('equipo');
    }
    if (patch.assignee !== undefined && patch.assignee !== before.assignee) {
      set('assignee', patch.assignee);
      if (patch.team === undefined && patch.assignee) {
        const team = teamFor(patch.assignee);
        if (team && team !== before.team) set('team', team);
      }
      entries.push(log(seq, now, actor, 'assigned', before.assignee, patch.assignee, patch.note ?? null));
    }
    if (changed.length > 0) entries.push(log(seq, now, actor, 'updated', null, null, changed.join(', ')));

    let moved: TaskChange['moved'] = null;
    const from = before.col as Column;
    const to = patch.column ?? from;
    if (to !== from) {
      set('col', to);
      set('position', patch.position ?? (nextPosition.get(to) as { p: number }).p);
      if (to === 'en-curso' && before.started_at === null) set('started_at', now);
      if (to === 'hecha') set('closed_at', now);
      else if (before.closed_at !== null) set('closed_at', null);
      entries.push(log(seq, now, actor, 'moved', from, to, patch.note ?? null));
      moved = { from, to, by: actor };
    } else if (patch.position !== undefined && patch.position !== before.position) {
      set('position', patch.position);
    }

    if (sets.length > 0) {
      set('updated_at', now);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE seq = ?`).run(...values, seq);
    } else if (patch.note) {
      entries.push(log(seq, now, actor, 'commented', null, null, patch.note));
    }
    return { task: toTask(row(seq)), entries, moved };
  });

  const comment = db.transaction((id: string, text: string, actor: string, now: number): TaskChange => {
    const seq = parseTaskId(id);
    row(seq);
    if (!text.trim()) throw new TaskError(400, 'el comentario está vacío');
    const entry = log(seq, now, actor, 'commented', null, null, text.trim());
    db.prepare('UPDATE tasks SET updated_at = ? WHERE seq = ?').run(now, seq);
    return { task: toTask(row(seq)), entries: [entry], moved: null };
  });

  const emit = (c: TaskChange) => {
    onChange(c);
    return c;
  };

  return {
    list(filter: { column?: Column; team?: string; assignee?: string } = {}): Task[] {
      const where: string[] = [];
      const args: unknown[] = [];
      if (filter.column) (where.push('col = ?'), args.push(filter.column));
      if (filter.team) (where.push('team = ?'), args.push(filter.team));
      if (filter.assignee) (where.push('assignee = ?'), args.push(filter.assignee));
      const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${COLUMN_ORDER}, position`;
      return (db.prepare(sql).all(...args) as TaskRow[]).map(toTask);
    },
    get(id: string): Task {
      return toTask(row(parseTaskId(id)));
    },
    /** Borra tarjetas (con su historial). Solo lo usa la demo para no dejar basura en el tablero. */
    remove(ids: string[]): string[] {
      const del = db.prepare('DELETE FROM tasks WHERE seq = ?');
      const removed = db.transaction(() => ids.filter((id) => /^T-\d+$/.test(id) && del.run(parseTaskId(id)).changes > 0))();
      if (removed.length) onRemove(removed);
      return removed;
    },
    exists(id: string): boolean {
      const m = /^T-(\d+)$/.exec(id);
      return m ? getRow.get(Number(m[1])) !== undefined : false;
    },
    history(id: string): TaskHistoryEntry[] {
      const seq = parseTaskId(id);
      row(seq);
      return (db.prepare('SELECT * FROM task_history WHERE task_seq = ? ORDER BY at, id').all(seq) as HistoryRow[]).map(toEntry);
    },
    /**
     * Los movimientos hechos por la CLI sin `--as` quedan como `cli`; cuando llega el evento del hook
     * (async, puede llegar después) se atribuyen al agente que corrió el comando.
     */
    reattribute(id: string, to: Column, actor: string, since: number): TaskChange | null {
      const seq = parseTaskId(id);
      const r = db
        .prepare(
          `UPDATE task_history SET actor = ? WHERE id = (
             SELECT id FROM task_history WHERE task_seq = ? AND action = 'moved' AND to_val = ? AND actor = 'cli' AND at >= ?
             ORDER BY at DESC LIMIT 1) RETURNING *`,
        )
        .get(actor, seq, to, since) as HistoryRow | undefined;
      return r ? emit({ task: toTask(row(seq)), entries: [toEntry(r)], moved: null }) : null;
    },
    create: (input: NewTask, now = Date.now()) => emit(create(input, now)),
    update: (id: string, patch: TaskPatch, now = Date.now()) => emit(update(id, patch, now)),
    comment: (id: string, text: string, actor: string, now = Date.now()) => emit(comment(id, text, actor, now)),
  };
}
