import type { Team } from './agents.ts';

export const EVENT_KINDS = [
  'session_start',
  'prompt',
  'tool_start',
  'tool_end',
  'tool_error',
  'waiting',
  'agent_start',
  'agent_stop',
  'stop',
  'session_end',
  'task_move',
  'notification',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type EventStatus = 'ok' | 'running' | 'error' | 'waiting' | 'done';

/** Evento normalizado: lo que guarda el server y consume la UI. */
export interface OfficeEvent {
  id: number;
  sessionId: string;
  /** `agent_id` del subagente, o el sessionId para el jefe. */
  agentId: string;
  /** Perfil del registro (`jefe`, `backend`, `visitante`…). */
  agentName: string;
  /** `agent_type` tal cual llegó (útil para visitantes). */
  agentType: string | null;
  team: Team;
  kind: EventKind;
  tool: string | null;
  /** Una línea legible y sin secretos. */
  summary: string;
  /** Archivo, comando, URL o tarea objetivo, ya redactado. */
  target: string | null;
  toolUseId: string | null;
  /** Epoch ms del momento en que ocurrió (header x-emit-ts o llegada). */
  timestamp: number;
  status: EventStatus;
  durationMs: number | null;
  cwd: string | null;
}

/** Mensajes del WebSocket servidor → cliente. */
export type ServerMessage =
  | { type: 'hello'; serverTime: number }
  | { type: 'event'; event: OfficeEvent }
  | { type: 'session'; session: SessionInfo };

export interface SessionInfo {
  id: string;
  cwd: string | null;
  model: string | null;
  startedAt: number;
  lastEventAt: number;
  endedAt: number | null;
  lastPrompt: string | null;
  source: 'hook' | 'demo';
}
