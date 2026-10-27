import { redactDeep, type OfficeEvent, type ServerMessage } from '@office/shared';
import type { OfficeDb } from './db.ts';
import { normalize, type HookPayload, type NormalizedEvent } from './normalize.ts';

const RAW_LIMIT = 8 * 1024;
/** Los hooks async pueden llegar desordenados: retenemos un instante y emitimos por timestamp. */
const REORDER_WINDOW_MS = 300;
/** Si el reloj del cliente difiere más que esto, usamos la hora de llegada. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export type Broadcast = (msg: ServerMessage) => void;

interface Pending {
  event: NormalizedEvent;
  raw: string | null;
  source: 'hook' | 'demo';
  model: string | undefined;
  receivedAt: number;
}

function serializeRaw(p: HookPayload): string {
  const { transcript_path: _t, agent_transcript_path: _a, ...rest } = p as Record<string, unknown>;
  const json = JSON.stringify(redactDeep(rest));
  return json.length > RAW_LIMIT ? `${json.slice(0, RAW_LIMIT)}…[truncado]` : json;
}

export function resolveTimestamp(header: string | undefined, now: number): number {
  const n = Number(header);
  if (!Number.isFinite(n) || n <= 0) return now;
  return Math.abs(now - n) > MAX_CLOCK_SKEW_MS ? now : Math.round(n);
}

export function createIngest(db: OfficeDb, broadcast: Broadcast, windowMs = REORDER_WINDOW_MS) {
  let queue: Pending[] = [];
  let timer: NodeJS.Timeout | null = null;
  /** tool_use_id → timestamp de inicio, para calcular la duración si el hook no la trae. */
  const starts = new Map<string, number>();
  const listeners = new Set<(e: OfficeEvent) => void>();

  function commit(p: Pending) {
    const e = p.event;
    if (e.toolUseId) {
      if (e.kind === 'tool_start' || e.kind === 'task_move') starts.set(e.toolUseId, e.timestamp);
      else if (e.kind === 'tool_end' || e.kind === 'tool_error') {
        const t0 = starts.get(e.toolUseId);
        if (e.durationMs === null && t0 !== undefined) e.durationMs = e.timestamp - t0;
        starts.delete(e.toolUseId);
      }
    }
    if (starts.size > 5000) starts.clear();
    const saved = db.insertEvent(e, p.raw, p.source);
    if (p.model && e.kind === 'session_start') db.setSessionModel(e.sessionId, p.model);
    if (e.kind === 'session_start' || e.kind === 'prompt' || e.kind === 'session_end') {
      const session = db.getSession(e.sessionId);
      if (session) broadcast({ type: 'session', session });
    }
    broadcast({ type: 'event', event: saved });
    for (const l of listeners) l(saved);
  }

  function flush(force = false) {
    timer = null;
    const cutoff = Date.now() - windowMs;
    queue.sort((a, b) => a.event.timestamp - b.event.timestamp);
    const ready = force ? queue : queue.filter((p) => p.receivedAt <= cutoff);
    queue = force ? [] : queue.filter((p) => p.receivedAt > cutoff);
    for (const p of ready) commit(p);
    if (queue.length > 0) schedule();
  }

  function schedule() {
    if (!timer) timer = setTimeout(() => flush(), windowMs);
  }

  return {
    push(payload: HookPayload, timestamp: number, source: 'hook' | 'demo' = 'hook') {
      queue.push({
        event: normalize(payload, timestamp),
        raw: serializeRaw(payload),
        source,
        model: payload.model,
        receivedAt: Date.now(),
      });
      if (windowMs === 0) flush(true);
      else schedule();
    },
    flush: () => flush(true),
    onEvent(l: (e: OfficeEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    stop() {
      if (timer) clearTimeout(timer);
      flush(true);
    },
  };
}

export type Ingest = ReturnType<typeof createIngest>;
