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
  /** Sesión que muestra la oficina ("piso"). */
  floor: string | null;

  setFloor(id: string | null): void;
  openTask(id: string | null): void;
  highlightAgent(agent: string | null): void;
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
  floor: null,

  setFloor(id) {
    set({ floor: id });
  },

  openTask(id) {
    const task = id ? get().tasks[id] : undefined;
    // El resaltado sobrevive al cerrar el panel: así se puede ir a la oficina a ver al agente.
    set((s) => ({ openTaskId: id, openHistory: [], highlightedAgent: task?.assignee ?? s.highlightedAgent }));
    if (id) {
      void api
        .task(id)
        .then(({ history }) => {
          if (get().openTaskId === id) set({ openHistory: history });
        })
        .catch(() => {});
    }
  },

  highlightAgent(agent) {
    set({ highlightedAgent: agent });
  },

  patchTaskLocal(task) {
    set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
  },
}));

if (import.meta.env.DEV) (window as unknown as { __store?: typeof useOffice }).__store = useOffice;

function onMessage(msg: ServerMessage) {
  const set = useOffice.setState;
  switch (msg.type) {
    case 'event':
      set((s) => ({ events: [msg.event, ...s.events].slice(0, MAX_EVENTS), floor: followFloor(s, msg.event.sessionId) }));
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

/** Piso por defecto: la sesión abierta con actividad más reciente (o la última que hubo). */
export function pickFloor(sessions: SessionInfo[]): string | null {
  const sorted = [...sessions].sort((a, b) => b.lastEventAt - a.lastEventAt);
  return (sorted.find((s) => s.endedAt === null) ?? sorted[0])?.id ?? null;
}

/** Un evento de otra sesión se lleva la oficina solo si el piso actual terminó o está quieto. */
const FLOOR_QUIET_MS = 120_000;

function followFloor(s: OfficeState, sessionId: string): string | null {
  if (s.floor === sessionId) return s.floor;
  const current = s.sessions.find((x) => x.id === s.floor);
  return !current || current.endedAt !== null || Date.now() - current.lastEventAt > FLOOR_QUIET_MS ? sessionId : s.floor;
}

function mergeHistory(current: TaskHistoryEntry[], incoming: TaskHistoryEntry[]): TaskHistoryEntry[] {
  const byId = new Map(current.map((h) => [h.id, h]));
  for (const h of incoming) byId.set(h.id, h);
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id - b.id);
}

async function loadSnapshot() {
  const [tasks, sessions] = await Promise.all([api.tasks(), api.sessions()]);
  useOffice.setState((s) => ({
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    sessions,
    floor: s.floor ?? pickFloor(sessions),
  }));
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
