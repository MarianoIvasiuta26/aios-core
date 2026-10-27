import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { profileFor, type Task } from '@office/shared';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { useOffice } from '../lib/store.ts';

const FLASH_MS = 1600;

/** Leve inclinación estable por tarjeta: parecen papeles pinchados en la pared. */
function tilt(id: string): number {
  const n = Number(id.replace(/\D/g, '')) || 0;
  return ((n * 37) % 7) / 10 - 0.3;
}

export function CardFace({ task, lifted = false }: { task: Task; lifted?: boolean }) {
  const flashedAt = useOffice((s) => s.flashes[task.id]);
  const highlighted = useOffice((s) => s.openTaskId === task.id);
  const flashing = flashedAt !== undefined && Date.now() - flashedAt < FLASH_MS;
  const who = task.assignee ? profileFor(task.assignee).displayName : 'Sin asignar';
  return (
    <div
      className={`card prio-${task.priority}${lifted ? ' lifted' : ''}${highlighted ? ' open' : ''}`}
      style={{ ['--tilt' as string]: `${tilt(task.id)}deg` }}
    >
      {flashing && <span className="flash" key={flashedAt} aria-hidden />}
      <span className="tape" aria-label={`Prioridad ${task.priority}`}>
        {task.priority}
      </span>
      <div className="card-id">
        {task.id}
        {task.related && <span className="related">{task.related}</span>}
      </div>
      <p className="card-title">{task.title}</p>
      {task.labels.length > 0 && (
        <ul className="labels">
          {task.labels.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="card-who">
        <AgentAvatar agent={task.assignee} size={18} />
        <span>{who}</span>
      </div>
    </div>
  );
}

export function SortableCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { column: task.column },
  });
  return (
    <li
      ref={setNodeRef}
      className={`card-slot${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') onOpen(task.id);
      }}
      aria-label={`${task.id} ${task.title}`}
    >
      <CardFace task={task} />
    </li>
  );
}
