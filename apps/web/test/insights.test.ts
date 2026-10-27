import { describe, expect, it } from 'vitest';
import type { OfficeEvent } from '@office/shared';
import { agentStats, EMPTY_FILTER, formatAgo, formatDuration, statusLine, timeline } from '../src/office/insights.ts';

let id = 0;
const ev = (p: Partial<OfficeEvent>): OfficeEvent => ({
  id: ++id, sessionId: 's', agentId: 'a1', agentName: 'backend', agentType: 'backend', team: 'ingenieria',
  kind: 'tool_start', tool: null, summary: '', target: null, toolUseId: null, timestamp: id * 1000,
  status: 'running', durationMs: null, cwd: '/r', ...p,
});

const events = [
  ev({ kind: 'agent_start', summary: 'Entra Backend' }),
  ev({ tool: 'Read', target: 'a.go', summary: 'Leyendo a.go', toolUseId: 't1' }),
  ev({ kind: 'tool_end', tool: 'Read', toolUseId: 't1', durationMs: 40 }),
  ev({ tool: 'Edit', target: 'a.go', summary: 'Editando a.go', toolUseId: 't2' }),
  ev({ kind: 'tool_end', tool: 'Edit', toolUseId: 't2', durationMs: 90 }),
  ev({ tool: 'Bash', summary: 'Corriendo: go test ./...', toolUseId: 't3' }),
  ev({ kind: 'tool_error', tool: 'Bash', toolUseId: 't3', summary: 'Error en Bash: Exit code 1', durationMs: 2500 }),
  ev({ agentName: 'qa-unit', agentId: 'q', team: 'qa', tool: 'Read', target: 'b.go', summary: 'Leyendo b.go' }),
  ev({ agentName: 'jefe', agentId: 's', team: 'direccion', kind: 'waiting', summary: 'Esperando permiso' }),
];

describe('timeline', () => {
  it('fusiona inicio y fin de cada herramienta y va de lo nuevo a lo viejo', () => {
    const rows = timeline(events, EMPTY_FILTER);
    expect(rows.map((r) => r.event.summary)).toEqual([
      'Esperando permiso', 'Leyendo b.go', 'Error en Bash: Exit code 1', 'Corriendo: go test ./...', 'Editando a.go', 'Leyendo a.go', 'Entra Backend',
    ]);
    expect(rows.find((r) => r.event.toolUseId === 't3' && r.event.kind === 'tool_start')).toMatchObject({ durationMs: 2500, failed: true });
    expect(rows.find((r) => r.event.toolUseId === 't2')).toMatchObject({ durationMs: 90, failed: false });
  });

  it('filtra por agente, equipo, tipo y texto', () => {
    expect(timeline(events, { ...EMPTY_FILTER, agents: ['qa-unit'] })).toHaveLength(1);
    expect(timeline(events, { ...EMPTY_FILTER, teams: ['direccion'] })).toHaveLength(1);
    expect(timeline(events, { ...EMPTY_FILTER, kinds: ['errores'] }).map((r) => r.event.kind)).toEqual(['tool_error']);
    expect(timeline(events, { ...EMPTY_FILTER, text: 'A.GO' })).toHaveLength(2);
  });
});

describe('agentStats', () => {
  it('cuenta herramientas, errores y archivos tocados', () => {
    const s = agentStats(events, 'backend');
    expect(s).toMatchObject({ runs: 1, toolCalls: 3, errors: 1, waits: 0, commands: ['go test ./...'] });
    expect(s.files).toEqual([{ path: 'a.go', edited: true }]);
    expect(s.lastSummary).toBe('Error en Bash: Exit code 1');
  });
});

describe('formatos', () => {
  it('duraciones y antigüedad', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatAgo(1_000_000, 1_000_000 + 30_000)).toBe('recién');
    expect(formatAgo(0, 3 * 3600_000)).toBe('hace 3 h');
  });
});

describe('statusLine', () => {
  const base = { present: true, where: 'desk' as const, finished: false, idle: false, activity: { kind: 'typing' as const, detail: 'a.go' } };
  it('describe cada estado', () => {
    expect(statusLine(base, 'backend')).toEqual({ text: 'Escribiendo a.go', tone: 'working' });
    expect(statusLine({ ...base, activity: { kind: 'waiting', detail: null } }, 'jefe').tone).toBe('waiting');
    expect(statusLine({ ...base, finished: true }, 'backend').tone).toBe('rest');
    expect(statusLine({ ...base, present: false }, 'backend').text).toBe('Fuera de la oficina');
    expect(statusLine(null, 'backend').tone).toBe('away');
  });
});
