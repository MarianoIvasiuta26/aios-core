import { useMemo } from 'react';
import { AGENTS, profileFor, TEAMS, TEAM_LABELS, type Team } from '@office/shared';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { useOffice } from '../lib/store.ts';
import {
  formatClock,
  formatDuration,
  timeline,
  TIMELINE_KIND_LABELS,
  TIMELINE_KINDS,
  type TimelineFilter,
  type TimelineKind,
} from './insights.ts';

const KINDS = Object.keys(TIMELINE_KINDS) as TimelineKind[];

interface Props {
  open: boolean;
  onToggle: () => void;
  filter: TimelineFilter;
  onFilter: (f: TimelineFilter) => void;
  onPickAgent: (agent: string) => void;
}

export function Timeline({ open, onToggle, filter, onFilter, onPickAgent }: Props) {
  const events = useOffice((s) => s.floorEvents);
  const rows = useMemo(() => (open ? timeline(events, filter) : []), [open, events, filter]);
  const last = events.at(-1);
  const active = filter.agents.length + filter.teams.length + filter.kinds.length + (filter.text ? 1 : 0);

  const toggleKind = (k: TimelineKind) =>
    onFilter({ ...filter, kinds: filter.kinds.includes(k) ? filter.kinds.filter((x) => x !== k) : [...filter.kinds, k] });

  return (
    <section className={`timeline${open ? ' open' : ''}`} aria-label="Línea de tiempo">
      <header className="timeline-head">
        <button type="button" className="ghost timeline-toggle" onClick={onToggle} aria-expanded={open}>
          <span aria-hidden>{open ? '▾' : '▸'}</span> Línea de tiempo
        </button>
        {!open && last && (
          <span className="timeline-last">
            <AgentAvatar agent={last.agentName} size={14} />
            <span>{profileFor(last.agentName === 'jefe' ? null : last.agentName).displayName}:</span>
            <span className="muted">{last.summary}</span>
          </span>
        )}
        {open && (
          <div className="timeline-filters" role="group" aria-label="Filtros">
            {KINDS.map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={filter.kinds.includes(k)} onClick={() => toggleKind(k)}>
                {TIMELINE_KIND_LABELS[k]}
              </button>
            ))}
            <select
              aria-label="Equipo"
              value={filter.teams[0] ?? ''}
              onChange={(e) => onFilter({ ...filter, teams: e.target.value ? [e.target.value as Team] : [] })}
            >
              <option value="">Todos los equipos</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {TEAM_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              aria-label="Agente"
              value={filter.agents[0] ?? ''}
              onChange={(e) => onFilter({ ...filter, agents: e.target.value ? [e.target.value] : [] })}
            >
              <option value="">Todos los agentes</option>
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Buscar archivo, comando…"
              aria-label="Buscar en la línea de tiempo"
              value={filter.text}
              onChange={(e) => onFilter({ ...filter, text: e.target.value })}
            />
            {active > 0 && (
              <button type="button" className="ghost" onClick={() => onFilter({ agents: [], teams: [], kinds: [], text: '' })}>
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </header>
      {open && (
        <ol className="timeline-rows">
          {rows.length === 0 && (
            <li className="muted empty">{events.length ? 'Nada coincide con los filtros.' : 'Este piso todavía no tiene actividad.'}</li>
          )}
          {rows.map(({ event: e, durationMs, failed }) => (
            <li key={e.id} className={`kind-${e.kind}${failed ? ' failed' : ''}`}>
              <time>{formatClock(e.timestamp)}</time>
              <button type="button" className="who" onClick={() => onPickAgent(e.agentName)}>
                <AgentAvatar agent={e.agentName} size={16} />
                {profileFor(e.agentName === 'jefe' ? null : e.agentName).displayName}
              </button>
              <span className="what">{e.summary}</span>
              <span className="dur">{formatDuration(durationMs)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
