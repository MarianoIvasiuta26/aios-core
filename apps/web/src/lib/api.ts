import type { OfficeEvent, ServerMessage, SessionInfo } from '@office/shared';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  sessions: () => json<SessionInfo[]>('/sessions'),
  sessionState: (id: string) => json<{ session: SessionInfo; events: OfficeEvent[] }>(`/sessions/${encodeURIComponent(id)}/state`),
  demoStatus: () => json<{ running: boolean; sessionId: string | null }>('/demo'),
  demoStart: (speed = 1) => json<{ sessionId: string }>('/demo/start', { method: 'POST', body: JSON.stringify({ speed }) }),
  demoStop: () => json<{ running: boolean }>('/demo/stop', { method: 'POST', body: '{}' }),
};

export type ConnectionState = 'connecting' | 'open' | 'closed';

/** WebSocket con reconexión automática (backoff hasta 5 s). */
export function connectSocket(onMessage: (m: ServerMessage) => void, onState: (s: ConnectionState) => void) {
  let ws: WebSocket | null = null;
  let retry = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    onState('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      if (!stopped) onState('open');
    };
    ws.onmessage = (ev) => {
      if (!stopped) onMessage(JSON.parse(String(ev.data)) as ServerMessage);
    };
    ws.onclose = () => {
      // Una conexión descartada (p. ej. por StrictMode) no debe pisar el estado de la nueva.
      if (stopped) return;
      onState('closed');
      timer = setTimeout(open, Math.min(5000, 300 * 2 ** retry++));
    };
  };
  open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
