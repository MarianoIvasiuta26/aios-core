import { create } from 'zustand';
import type { OfficeEvent, ServerMessage, SessionInfo, Task, TaskHistoryEntry } from '@office/shared';
import { api, connectSocket, type ConnectionState } from './api.ts';

const MAX_EVENTS = 1000;

export type Selection = { type: 'agent'; agent: string } | { type: 'zone'; zone: string };

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
  /** true = el usuario eligió el piso a mano y no se cambia solo. */
  floorPinned: boolean;
  /** Eventos del piso, en orden cronológico. */
  floorEvents: OfficeEvent[];
  /** Se incrementa cada vez que el piso se recarga entero (la oficina se reconstruye). */
  floorRev: number;
  /** Panel lateral de la oficina. */
  selection: Selection | null;

  setFloor(id: string | null, pinned?: boolean): void;
  select(sel: Selection | null): void;
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
  floorPinned: false,
  floorEvents: [],
  floorRev: 0,
  selection: null,

  setFloor(id, pinned = get().floorPinned) {
    const changed = id !== get().floor;
    set({ floor: id, floorPinned: pinned });
    if (changed) void loadFloor(id);
  },

  select(sel) {
    set({ selection: sel });
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
    case 'event': {
      const s = useOffice.getState();
      const floor = followFloor(s, msg.event.sessionId);
      set({ events: [msg.event, ...s.events].slice(0, MAX_EVENTS) });
      if (floor !== s.floor) s.setFloor(floor);
      else if (msg.event.sessionId === floor && !s.floorEvents.some((e) => e.id === msg.event.id)) {
        set({ floorEvents: [...s.floorEvents, msg.event].slice(-MAX_FLOOR_EVENTS) });
      }
      break;
    }
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
  if (s.floor === sessionId || (s.floorPinned && s.floor)) return s.floor;
  const current = s.sessions.find((x) => x.id === s.floor);
  return !current || current.endedAt !== null || Date.now() - current.lastEventAt > FLOOR_QUIET_MS ? sessionId : s.floor;
}

function mergeHistory(current: TaskHistoryEntry[], incoming: TaskHistoryEntry[]): TaskHistoryEntry[] {
  const byId = new Map(current.map((h) => [h.id, h]));
  for (const h of incoming) byId.set(h.id, h);
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id - b.id);
}

const MAX_FLOOR_EVENTS = 5000;
let floorRequest = 0;

/** Trae el historial del piso y le suma lo que llegó en vivo mientras tanto. */
async function loadFloor(id: string | null) {
  const req = ++floorRequest;
  if (!id) {
    useOffice.setState((s) => ({ floorEvents: [], floorRev: s.floorRev + 1 }));
    return;
  }
  useOffice.setState({ floorEvents: [] });
  const events = await api
    .sessionState(id)
    .then((r) => r.events)
    .catch(() => [] as OfficeEvent[]);
  if (req !== floorRequest) return;
  useOffice.setState((s) => {
    const max = events.reduce((m, e) => Math.max(m, e.id), 0);
    const live = s.floorEvents.filter((e) => e.sessionId === id && e.id > max);
    return { floorEvents: [...events, ...live].slice(-MAX_FLOOR_EVENTS), floorRev: s.floorRev + 1 };
  });
}

async function loadSnapshot() {
  const [tasks, sessions] = await Promise.all([api.tasks(), api.sessions()]);
  const { floor, setFloor } = useOffice.getState();
  useOffice.setState({ tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), sessions });
  // Al reconectar se recarga el piso entero por si se perdieron eventos.
  if (floor) void loadFloor(floor);
  else setFloor(pickFloor(sessions));
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
