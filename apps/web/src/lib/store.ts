import { create } from 'zustand';
import type { OfficeEvent, ServerMessage, SessionInfo, Task, TaskHistoryEntry } from '@office/shared';
import { api, connectSocket, type ConnectionState } from './api.ts';

const MAX_EVENTS = 1000;

interface OfficeState {
  conn: ConnectionState;
  events: OfficeEvent[];
  sessions: SessionInfo[];
  tasks: Record<string, Task>;
  /** taskId → instante del último cambio remoto (para el destello). */
  flashes: Record<string, number>;
  /** Historial de la tarjeta abierta en el panel (se mantiene en vivo). */
  openTaskId: string | null;
  openHistory: TaskHistoryEntry[];
  /** Agente resaltado (click en una tarjeta → se resalta en la oficina). */
  highlightedAgent: string | null;

  openTask(id: string | null): void;
  /** Aplica un cambio local antes de que confirme el server. */
  patchTaskLocal(task: Task): void;
}

export const useOffice = create<OfficeState>((set, get) => ({
  conn: 'connecting',
  events: [],
  sessions: [],
  tasks: {},
  flashes: {},
  openTaskId: null,
  openHistory: [],
  highlightedAgent: null,

  openTask(id) {
    const task = id ? get().tasks[id] : undefined;
    set({ openTaskId: id, openHistory: [], highlightedAgent: task?.assignee ?? null });
    if (id) {
      void api
        .task(id)
        .then(({ history }) => {
          if (get().openTaskId === id) set({ openHistory: history });
        })
        .catch(() => {});
    }
  },

  patchTaskLocal(task) {
    set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
  },
}));

function onMessage(msg: ServerMessage) {
  const set = useOffice.setState;
  switch (msg.type) {
    case 'event':
      set((s) => ({ events: [msg.event, ...s.events].slice(0, MAX_EVENTS) }));
      break;
    case 'session':
      set((s) => ({ sessions: [msg.session, ...s.sessions.filter((x) => x.id !== msg.session.id)] }));
      break;
    case 'task_upsert':
      set((s) => ({
        tasks: { ...s.tasks, [msg.task.id]: msg.task },
        flashes: { ...s.flashes, [msg.task.id]: Date.now() },
        openHistory: s.openTaskId === msg.task.id ? mergeHistory(s.openHistory, msg.entries) : s.openHistory,
      }));
      break;
    default:
      break;
  }
}

function mergeHistory(current: TaskHistoryEntry[], incoming: TaskHistoryEntry[]): TaskHistoryEntry[] {
  const byId = new Map(current.map((h) => [h.id, h]));
  for (const h of incoming) byId.set(h.id, h);
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id - b.id);
}

async function loadSnapshot() {
  const [tasks, sessions] = await Promise.all([api.tasks(), api.sessions()]);
  useOffice.setState({ tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), sessions });
}

let started = false;

/** Conecta una sola vez para toda la app; al reconectar recarga el snapshot. */
export function startOfficeSync() {
  if (started) return;
  started = true;
  connectSocket(onMessage, (conn) => {
    useOffice.setState({ conn });
    if (conn === 'open') void loadSnapshot().catch(() => {});
  });
}
