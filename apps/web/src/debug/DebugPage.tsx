import { useMemo, useState } from 'react';
import { AGENTS, profileFor, type OfficeEvent } from '@office/shared';
import { useOffice } from '../lib/store.ts';
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

/** Vista de diagnóstico: eventos normalizados tal como llegan por WebSocket. */
export function DebugPage() {
  const events = useOffice((s) => s.events);
  const sessions = useOffice((s) => s.sessions);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return events;
    return events.filter((e) => `${e.agentName} ${e.kind} ${e.tool ?? ''} ${e.summary}`.toLowerCase().includes(f));
  }, [events, filter]);

  return (
    <div className="debug">
      <header>
        <h1>Eventos en vivo</h1>
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
