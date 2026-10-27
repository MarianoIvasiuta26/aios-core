import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { COLUMN_LABELS, profileFor, type Column, type Task, type TaskHistoryEntry } from '@office/shared';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { api } from '../lib/api.ts';
import { useOffice } from '../lib/store.ts';
import { draftToPayload, TaskFields, type TaskDraft } from './TaskFields.tsx';

function toDraft(t: Task): TaskDraft {
  return {
    title: t.title,
    description: t.description,
    team: t.team ?? '',
    assignee: t.assignee ?? '',
    priority: t.priority,
    labels: t.labels.join(', '),
    related: t.related ?? '',
    column: t.column,
  };
}

function actorName(actor: string): string {
  if (actor === 'usuario') return 'Vos';
  if (actor === 'cli') return 'CLI';
  if (actor === 'sistema') return 'Sistema';
  return profileFor(actor).displayName;
}

function describe(h: TaskHistoryEntry): string {
  switch (h.action) {
    case 'created':
      return `creó la tarjeta en ${COLUMN_LABELS[h.to as Column] ?? h.to}`;
    case 'moved':
      return `la movió de ${COLUMN_LABELS[h.from as Column] ?? h.from} a ${COLUMN_LABELS[h.to as Column] ?? h.to}`;
    case 'assigned':
      return h.to ? `la asignó a ${profileFor(h.to).displayName}` : 'la dejó sin asignar';
    case 'updated':
      return `cambió ${h.detail ?? 'datos'}`;
    case 'commented':
      return 'comentó';
  }
}

function when(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '—';
}

export function TaskDrawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const history = useOffice((s) => s.openHistory);
  const [draft, setDraft] = useState(() => toDraft(task));
  const [dirty, setDirty] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Si alguien (otro agente, la CLI) cambia la tarjeta mientras no estoy editando, reflejarlo.
  useEffect(() => {
    if (!dirty) setDraft(toDraft(task));
  }, [task, dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.updateTask(task.id, draftToPayload(draft));
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    try {
      await api.comment(task.id, comment);
      setComment('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer"
        role="dialog"
        aria-label={`Tarjeta ${task.id}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      >
        <header className="drawer-head">
          <span className={`tape-inline prio-${task.priority}`}>{task.priority}</span>
          <h2>{task.id}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </button>
        </header>

        <form onSubmit={save}>
          <TaskFields
            draft={draft}
            onChange={(d) => {
              setDraft(d);
              setDirty(true);
            }}
          />
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {dirty && (
              <button type="button" className="ghost" onClick={() => setDirty(false)}>
                Descartar cambios
              </button>
            )}
            <button type="submit" className="primary" disabled={!dirty || !draft.title.trim()}>
              Guardar cambios
            </button>
          </div>
        </form>

        <dl className="dates">
          <div>
            <dt>Creada</dt>
            <dd>{when(task.createdAt)}</dd>
          </div>
          <div>
            <dt>Iniciada</dt>
            <dd>{when(task.startedAt)}</dd>
          </div>
          <div>
            <dt>Cerrada</dt>
            <dd>{when(task.closedAt)}</dd>
          </div>
        </dl>

        <section className="history">
          <h3>Historial</h3>
          <ol>
            {history.map((h) => (
              <li key={h.id}>
                <AgentAvatar agent={['usuario', 'cli', 'sistema'].includes(h.actor) ? null : h.actor} size={16} />
                <div>
                  <p>
                    <strong>{actorName(h.actor)}</strong> {describe(h)}
                  </p>
                  {h.detail && h.action !== 'updated' && h.action !== 'created' && <p className="detail">{h.detail}</p>}
                  <time>{when(h.at)}</time>
                </div>
              </li>
            ))}
          </ol>
          <form className="comment" onSubmit={addComment}>
            <input placeholder="Escribí un comentario" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button type="submit" disabled={!comment.trim()}>
              Comentar
            </button>
          </form>
        </section>
      </motion.aside>
    </>
  );
}
