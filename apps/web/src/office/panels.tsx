import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { COLUMNS, COLUMN_LABELS, profileFor, TEAM_LABELS, type SessionInfo, type Task } from '@office/shared';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { useOffice } from '../lib/store.ts';
import { basename } from './behavior.ts';
import { agentStats, formatAgo, formatClock, formatDuration, statusLine, timeline, EMPTY_FILTER } from './insights.ts';
import type { OfficeScene } from './scene.ts';

const displayName = (agent: string) => profileFor(agent === 'jefe' ? null : agent).displayName;

/** Estado en vivo de un personaje (el director no es reactivo: se consulta seguido). */
function useStatus(scene: OfficeScene, agent: string | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(t);
  }, []);
  return agent ? statusLine(scene.status(agent), agent) : null;
}

function StatusDot({ tone }: { tone: string }) {
  return <span className={`status-dot tone-${tone}`} aria-hidden />;
}

// ── Selector de piso ────────────────────────────────────────────────────────

function floorName(s: SessionInfo): string {
  if (s.source === 'demo') return 'Demo';
  return s.cwd ? basename(s.cwd) : s.id.slice(0, 8);
}

export function FloorPicker() {
  const sessions = useOffice((s) => s.sessions);
  const floor = useOffice((s) => s.floor);
  const pinned = useOffice((s) => s.floorPinned);
  const setFloor = useOffice((s) => s.setFloor);
  const sorted = useMemo(() => [...sessions].sort((a, b) => b.lastEventAt - a.lastEventAt).slice(0, 30), [sessions]);
  const current = sessions.find((s) => s.id === floor);

  return (
    <div className="floor-picker">
      <label htmlFor="floor">Piso</label>
      <select
        id="floor"
        value={pinned ? (floor ?? '') : ''}
        onChange={(e) => (e.target.value ? setFloor(e.target.value, true) : useOffice.setState({ floorPinned: false }))}
      >
        <option value="">Seguir la sesión activa{!pinned && current ? ` (${floorName(current)})` : ''}</option>
        {sorted.map((s) => (
          <option key={s.id} value={s.id}>
            {floorName(s)} de las {formatClock(s.startedAt).slice(0, 5)} · {s.endedAt ? 'cerrada' : 'abierta'} · {formatAgo(s.lastEventAt)}
          </option>
        ))}
      </select>
      {current && (
        <span className="floor-state" title={current.lastPrompt ?? undefined}>
          <StatusDot tone={current.endedAt ? 'away' : 'working'} />
          {current.endedAt ? 'Sesión cerrada' : 'En curso'}
        </span>
      )}
    </div>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

export function AgentTooltip({ scene, hover }: { scene: OfficeScene; hover: { agent: string; x: number; y: number } }) {
  const status = useStatus(scene, hover.agent)!;
  const p = profileFor(hover.agent === 'jefe' ? null : hover.agent);
  return (
    <div className="agent-tooltip" style={{ left: hover.x, top: hover.y }} role="tooltip">
      <strong>{p.displayName}</strong>
      <span className="muted">{TEAM_LABELS[p.team]}</span>
      <span className="tooltip-status">
        <StatusDot tone={status.tone} />
        {status.text}
      </span>
    </div>
  );
}

// ── Panel lateral ───────────────────────────────────────────────────────────

function Panel({ title, avatar, onClose, children }: { title: string; avatar?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.aside
      className="office-panel"
      aria-label={title}
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <header className="panel-head">
        {avatar && <AgentAvatar agent={avatar} size={28} />}
        <h2>{title}</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Cerrar panel">
          ✕
        </button>
      </header>
      {children}
    </motion.aside>
  );
}

function TaskLine({ task }: { task: Task }) {
  const openTask = useOffice((s) => s.openTask);
  return (
    <li>
      <button type="button" className="task-line" onClick={() => openTask(task.id)}>
        <span className={`tape-inline prio-${task.priority}`}>{task.id}</span>
        <span className="task-title">{task.title}</span>
        <span className="muted">{COLUMN_LABELS[task.column]}</span>
      </button>
    </li>
  );
}

export function AgentPanel({ scene, agent, onTimeline }: { scene: OfficeScene; agent: string; onTimeline: (agent: string) => void }) {
  const select = useOffice((s) => s.select);
  const events = useOffice((s) => s.floorEvents);
  const tasks = useOffice((s) => s.tasks);
  const status = useStatus(scene, agent)!;
  const p = profileFor(agent === 'jefe' ? null : agent);
  const stats = useMemo(() => agentStats(events, agent), [events, agent]);
  const recent = useMemo(() => timeline(events, { ...EMPTY_FILTER, agents: [agent] }, 12), [events, agent]);
  const mine = Object.values(tasks)
    .filter((t) => t.assignee === agent && t.column !== 'hecha')
    .sort(
      (a, b) =>
        COLUMNS.indexOf(b.column === 'en-curso' ? 'hecha' : b.column) - COLUMNS.indexOf(a.column === 'en-curso' ? 'hecha' : a.column),
    );

  return (
    <Panel title={p.displayName} avatar={agent} onClose={() => select(null)}>
      <p className="muted panel-sub">{TEAM_LABELS[p.team]}</p>
      <p className={`panel-status tone-${status.tone}`}>
        <StatusDot tone={status.tone} />
        {status.text}
      </p>
      <div className="panel-actions">
        <button type="button" onClick={() => scene.focusAgent(agent)} disabled={status.tone === 'away'}>
          Centrar en la oficina
        </button>
        <button type="button" onClick={() => onTimeline(agent)}>
          Ver en la línea de tiempo
        </button>
      </div>

      <dl className="stats">
        <div>
          <dt>Herramientas</dt>
          <dd>{stats.toolCalls}</dd>
        </div>
        <div>
          <dt>Errores</dt>
          <dd className={stats.errors ? 'bad' : undefined}>{stats.errors}</dd>
        </div>
        <div>
          <dt>Esperas</dt>
          <dd>{stats.waits}</dd>
        </div>
        <div>
          <dt>Entradas</dt>
          <dd>{agent === 'jefe' ? '—' : stats.runs}</dd>
        </div>
      </dl>

      <section>
        <h3>Tarjetas</h3>
        {mine.length ? (
          <>
            <ul className="plain">
              {mine.slice(0, 5).map((t) => (
                <TaskLine key={t.id} task={t} />
              ))}
            </ul>
            {mine.length > 5 && <p className="muted more">y {mine.length - 5} más en el tablero</p>}
          </>
        ) : (
          <p className="muted">Sin tarjetas abiertas asignadas.</p>
        )}
      </section>

      {stats.files.length > 0 && (
        <section>
          <h3>Archivos en este piso</h3>
          <ul className="plain files">
            {stats.files.slice(0, 10).map((f) => (
              <li key={f.path} title={f.path}>
                <span className={f.edited ? 'tag edited' : 'tag'}>{f.edited ? 'editado' : 'leído'}</span>
                {f.path}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.commands.length > 0 && (
        <section>
          <h3>Comandos</h3>
          <ul className="plain commands">
            {stats.commands.map((c, i) => (
              <li key={i}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Últimos movimientos</h3>
        {recent.length ? (
          <ol className="plain recent">
            {recent.map((r) => (
              <li key={r.event.id} className={r.failed ? 'failed' : undefined}>
                <time>{formatClock(r.event.timestamp)}</time>
                <span>{r.event.summary}</span>
                {r.durationMs !== null && <span className="muted">{formatDuration(r.durationMs)}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Todavía no hizo nada en este piso.</p>
        )}
      </section>
    </Panel>
  );
}

const ZONE_INFO: Record<string, string> = {
  jefe: 'La sesión principal de Claude Code: recibe tus pedidos, arma las tarjetas y delega en el equipo.',
  reuniones: 'Acá esperan los agentes que no son del equipo (visitantes).',
  tablero: 'El tablero compartido: cada vez que alguien mueve una tarjeta, viene hasta acá.',
  producto: 'Escribe el backlog, las historias y los criterios de aceptación.',
  ingenieria: 'Diseña, implementa, despliega, revisa y documenta.',
  qa: 'Tests unitarios y end-to-end. Si fallan, la tarjeta pasa a Bloqueada.',
  soc: 'Auditorías defensivas de código, nube, dependencias y cumplimiento. Solo lectura.',
  comercial: 'Mercado, prospección y embudo de ventas. Solo datos públicos con fuente y fecha.',
  cafe: 'Donde van los agentes que terminaron su parte o llevan un minuto sin actividad.',
  lobby: 'Por esta puerta entran los agentes cuando el jefe los llama y salen al cerrar la sesión.',
};

export function ZonePanel({ scene, zone }: { scene: OfficeScene; zone: string }) {
  const select = useOffice((s) => s.select);
  const tasks = useOffice((s) => s.tasks);
  useStatus(scene, null);
  const z = scene.map.zones.find((x) => x.id === zone);
  if (!z) return null;
  const desks = scene.map.desks.filter((d) => d.zone === zone).map((d) => d.agent);
  // En las zonas sin escritorios se muestra quién está ahí ahora.
  const here = desks.length
    ? desks
    : [...scene.actors.keys()].filter((a) => {
        const s = scene.status(a);
        if (!s?.present) return false;
        return zone === 'cafe' ? s.finished || (s.idle && a !== 'jefe') : scene.pickAgentZone(a) === zone;
      });
  const zoneTasks = Object.values(tasks).filter((t) => t.assignee && desks.includes(t.assignee) && t.column !== 'hecha');

  return (
    <Panel title={z.name} onClose={() => select(null)}>
      <p className="muted panel-sub">{ZONE_INFO[zone]}</p>
      <div className="panel-actions">
        <button type="button" onClick={() => scene.focusZone(zone)}>
          Centrar en la oficina
        </button>
      </div>

      {zone === 'tablero' ? (
        <section>
          <h3>Tarjetas por columna</h3>
          <dl className="stats cols-3">
            {COLUMNS.map((c) => (
              <div key={c}>
                <dt>{COLUMN_LABELS[c]}</dt>
                <dd>{Object.values(tasks).filter((t) => t.column === c).length}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section>
          <h3>{desks.length ? 'Equipo' : 'Ahora acá'}</h3>
          {here.length ? (
            <ul className="plain people">
              {here.map((a) => {
                const st = statusLine(scene.status(a), a);
                return (
                  <li key={a}>
                    <button type="button" onClick={() => select({ type: 'agent', agent: a })}>
                      <AgentAvatar agent={a} size={20} />
                      <span>{displayName(a)}</span>
                      <span className={`person-status tone-${st.tone}`}>
                        <StatusDot tone={st.tone} />
                        {st.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No hay nadie.</p>
          )}
        </section>
      )}

      {zoneTasks.length > 0 && (
        <section>
          <h3>Tarjetas abiertas</h3>
          <ul className="plain">
            {zoneTasks.slice(0, 8).map((t) => (
              <TaskLine key={t.id} task={t} />
            ))}
          </ul>
          {zoneTasks.length > 8 && <p className="muted more">y {zoneTasks.length - 8} más en el tablero</p>}
        </section>
      )}
    </Panel>
  );
}
