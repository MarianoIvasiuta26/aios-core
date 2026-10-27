import { useEffect, useMemo, useState } from 'react';
import { AGENTS, profileFor, type OfficeEvent, type SessionInfo } from '@office/shared';
import { api, connectSocket, type ConnectionState } from '../lib/api.ts';

const MAX_EVENTS = 400;
const COLORS = new Map(AGENTS.map((a) => [a.id, a.color]));

const STATUS_ICON: Record<OfficeEvent['status'], string> = {
  running: '▶',
  ok: '✓',
  error: '✗',
  waiting: '!',
  done: '■',
};

function time(ts: number) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
}

/** Vista de diagnóstico de la fase 1: eventos crudos por WebSocket. */
export function DebugPage() {
  const [conn, setConn] = useState<ConnectionState>('connecting');
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [demo, setDemo] = useState<{ running: boolean; sessionId: string | null }>({ running: false, sessionId: null });
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void api.sessions().then(setSessions).catch(() => {});
    void api.demoStatus().then(setDemo).catch(() => {});
    return connectSocket((msg) => {
      if (msg.type === 'event') setEvents((prev) => [msg.event, ...prev].slice(0, MAX_EVENTS));
      if (msg.type === 'session') {
        setSessions((prev) => [msg.session, ...prev.filter((s) => s.id !== msg.session.id)]);
      }
    }, setConn);
  }, []);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return events;
    return events.filter((e) => `${e.agentName} ${e.kind} ${e.tool ?? ''} ${e.summary}`.toLowerCase().includes(f));
  }, [events, filter]);

  const toggleDemo = async () => {
    if (demo.running) setDemo({ ...(await api.demoStop()), sessionId: null });
    else setDemo({ running: true, sessionId: (await api.demoStart(1)).sessionId });
  };

  return (
    <div className="debug">
      <header>
        <h1>Agent Office · diagnóstico</h1>
        <span className={`conn conn-${conn}`}>WebSocket: {conn}</span>
        <button onClick={() => void toggleDemo()}>{demo.running ? 'Detener demo' : 'Iniciar demo'}</button>
        <input placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">{events.length} eventos recibidos</span>
      </header>
      <main>
        <aside>
          <h2>Sesiones (pisos)</h2>
          {sessions.length === 0 && <p className="muted">Todavía no llegó ninguna.</p>}
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <code>{s.id.slice(0, 18)}</code> {s.source === 'demo' && <em>demo</em>} {s.endedAt ? '· cerrada' : '· activa'}
                <div className="muted">{s.cwd}</div>
                {s.lastPrompt && <div className="prompt">“{s.lastPrompt}”</div>}
              </li>
            ))}
          </ul>
        </aside>
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Agente</th>
              <th>Tipo</th>
              <th />
              <th>Resumen</th>
              <th>ms</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id} className={`st-${e.status}`}>
                <td>{time(e.timestamp)}</td>
                <td>
                  <span className="dot" style={{ background: COLORS.get(e.agentName) ?? '#adb5bd' }} />
                  {e.agentName === 'visitante' ? e.agentType : profileFor(e.agentName === 'jefe' ? null : e.agentName).displayName}
                </td>
                <td>{e.kind}</td>
                <td>{STATUS_ICON[e.status]}</td>
                <td>{e.summary}</td>
                <td className="muted">{e.durationMs ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
