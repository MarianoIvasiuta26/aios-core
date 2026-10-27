import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AGENTS, COLUMNS, COLUMN_LABELS, PRIORITIES, TEAMS, TEAM_LABELS, type Column, type Task } from '@office/shared';
import { api } from '../lib/api.ts';
import { useOffice } from '../lib/store.ts';
import { byColumn, dropPosition, EMPTY_FILTERS, matches, type BoardFilters } from './logic.ts';
import { CardFace, SortableCard } from './TaskCard.tsx';
import { TaskDrawer } from './TaskDrawer.tsx';
import { draftToPayload, EMPTY_DRAFT, TaskFields } from './TaskFields.tsx';
import './board.css';

const EMPTY_HINT: Record<Column, string> = {
  backlog: 'Ideas e historias sin priorizar.',
  'por-hacer': 'Lo próximo que se toma.',
  'en-curso': 'Nadie está trabajando ahora.',
  'en-revision': 'Nada esperando revisión.',
  bloqueada: 'Ninguna tarjeta bloqueada.',
  hecha: 'Todavía no se cerró nada.',
};

function BoardColumn({ column, tasks, onOpen }: { column: Column; tasks: Task[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column}`, data: { column } });
  return (
    <section className={`column col-${column}${isOver ? ' over' : ''}`} aria-label={COLUMN_LABELS[column]}>
      <header>
        <h2>{COLUMN_LABELS[column]}</h2>
        <span className="count">{tasks.length}</span>
      </header>
      <SortableContext id={column} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="cards">
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} onOpen={onOpen} />
          ))}
          {tasks.length === 0 && <li className="empty">{EMPTY_HINT[column]}</li>}
        </ol>
      </SortableContext>
    </section>
  );
}

function NewTaskDialog({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createTask(draftToPayload(draft));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        className="dialog"
        role="dialog"
        aria-label="Nueva tarjeta"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8 }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>Nueva tarjeta</h2>
        <form onSubmit={submit}>
          <TaskFields draft={draft} onChange={setDraft} autoFocus />
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={!draft.title.trim()}>
              Crear tarjeta
            </button>
          </div>
        </form>
      </motion.div>
    </>
  );
}

export function BoardPage() {
  const tasksById = useOffice((s) => s.tasks);
  const openTaskId = useOffice((s) => s.openTaskId);
  const openTask = useOffice((s) => s.openTask);
  const patchTaskLocal = useOffice((s) => s.patchTaskLocal);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => Object.values(tasksById), [tasksById]);
  const visible = useMemo(() => all.filter((t) => matches(t, filters)), [all, filters]);
  const columns = useMemo(() => byColumn(visible), [visible]);
  const labels = useMemo(() => [...new Set(all.flatMap((t) => t.labels))].sort(), [all]);
  const filtered = visible.length !== all.length;
  const openTaskData = openTaskId ? tasksById[openTaskId] : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );

  const onDragStart = (e: DragStartEvent) => setDragging(tasksById[String(e.active.id)] ?? null);

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const task = tasksById[String(e.active.id)];
    if (!task || !e.over) return;
    const overId = String(e.over.id);
    const target: Column = overId.startsWith('col:') ? (overId.slice(4) as Column) : (tasksById[overId]?.column ?? task.column);
    const list = columns[target];
    // Igual que arrayMove de dnd-kit: la tarjeta termina en el índice de aquella sobre la que se soltó.
    const index = overId.startsWith('col:') ? list.length : list.findIndex((t) => t.id === overId);
    if (overId === task.id) return;
    const position = dropPosition(list, task.id, index);
    if (target === task.column && position === task.position) return;
    const before = task;
    patchTaskLocal({ ...task, column: target, position });
    try {
      await api.updateTask(task.id, { column: target, position });
      setError(null);
    } catch (err) {
      patchTaskLocal(before);
      setError(`No se pudo mover ${task.id}: ${(err as Error).message}`);
    }
  };

  const setFilter = (k: keyof BoardFilters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="board-page">
      <div className="toolbar">
        <input className="search" type="search" placeholder="Buscar tarjetas" value={filters.text} onChange={setFilter('text')} aria-label="Buscar" />
        <select value={filters.team} onChange={setFilter('team')} aria-label="Equipo">
          <option value="">Todos los equipos</option>
          {TEAMS.filter((t) => t !== 'externo').map((t) => (
            <option key={t} value={t}>
              {TEAM_LABELS[t]}
            </option>
          ))}
        </select>
        <select value={filters.assignee} onChange={setFilter('assignee')} aria-label="Agente">
          <option value="">Todos los agentes</option>
          <option value="-">Sin asignar</option>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
        <select value={filters.priority} onChange={setFilter('priority')} aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={filters.label} onChange={setFilter('label')} aria-label="Etiqueta">
          <option value="">Toda etiqueta</option>
          {labels.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
            Mostrar todas ({all.length})
          </button>
        )}
        <button type="button" className="primary new" onClick={() => setCreating(true)}>
          Nueva tarjeta
        </button>
      </div>
      {error && (
        <p className="error banner" role="alert">
          {error}
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={() => setDragging(null)}>
        <div className="wall">
          {COLUMNS.map((c) => (
            <BoardColumn key={c} column={c} tasks={columns[c]} onOpen={openTask} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.3,1)' }}>
          {dragging ? <CardFace task={dragging} lifted /> : null}
        </DragOverlay>
      </DndContext>

      <AnimatePresence>
        {openTaskData && <TaskDrawer key={openTaskData.id} task={openTaskData} onClose={() => openTask(null)} />}
        {creating && <NewTaskDialog key="new" onClose={() => setCreating(false)} />}
      </AnimatePresence>
    </div>
  );
}
