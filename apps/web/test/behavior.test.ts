import { describe, expect, it } from 'vitest';
import type { OfficeEvent } from '@office/shared';
import { interpret, languageOf, reduceAgents } from '../src/office/behavior.ts';
import { buildOfficeMap, MAP_W } from '../src/office/map.ts';
import { createPlaces, findPath } from '../src/office/pathfind.ts';

let id = 0;
const ev = (p: Partial<OfficeEvent>): OfficeEvent => ({
  id: ++id, sessionId: 's', agentId: 'a1', agentName: 'backend', agentType: 'backend', team: 'ingenieria',
  kind: 'tool_start', tool: null, summary: '', target: null, toolUseId: null, timestamp: id * 1000,
  status: 'running', durationMs: null, cwd: '/r', ...p,
});

describe('interpret', () => {
  it.each([
    [{ tool: 'Read', target: 'internal/api/users.go' }, 'reading', 'users.go'],
    [{ tool: 'Grep', target: 'func .*Auth' }, 'reading', 'func .*Auth'],
    [{ tool: 'Edit', target: 'internal/api/users.go' }, 'typing', 'users.go'],
    [{ tool: 'Bash', summary: 'Corriendo: terraform plan' }, 'terminal', 'terraform plan'],
    [{ tool: 'WebFetch', target: 'https://example.com/a' }, 'web', 'example.com'],
    [{ tool: 'WebSearch', target: 'fintech argentina' }, 'web', 'fintech argentina'],
    [{ tool: 'Agent', target: 'qa-unit' }, 'delegating', '→ qa-unit'],
  ])('%o → %s', (p, kind, detail) => {
    expect(interpret(ev(p))?.activity).toMatchObject({ kind, detail });
  });

  it('presencias y estados especiales', () => {
    expect(interpret(ev({ kind: 'agent_start' }))).toMatchObject({ presence: 'enter' });
    expect(interpret(ev({ kind: 'agent_stop' }))).toMatchObject({ presence: 'finish', activity: { kind: 'done' } });
    expect(interpret(ev({ kind: 'waiting' }))?.activity.kind).toBe('waiting');
    expect(interpret(ev({ kind: 'tool_error', summary: 'Error en Bash: Exit code 1' }))?.activity).toMatchObject({ kind: 'error', detail: 'Exit code 1' });
    expect(interpret(ev({ kind: 'task_move', target: 'T-12 en-revision' }))?.activity).toMatchObject({ kind: 'card', detail: 'T-12', column: 'en-revision' });
    expect(interpret(ev({ kind: 'notification' }))).toBeNull();
  });

  it('detecta el lenguaje para el monitor', () => {
    expect(languageOf('cmd/api/main.go')).toBe('go');
    expect(languageOf('app/Http/UserController.php')).toBe('php');
    expect(languageOf('src/index.ts')).toBe('js');
    expect(languageOf('README.md')).toBeNull();
  });
});

describe('reduceAgents', () => {
  it('reconstruye presencia y última actividad', () => {
    const snap = reduceAgents([
      ev({ agentName: 'jefe', agentId: 's', kind: 'session_start' }),
      ev({ kind: 'agent_start' }),
      ev({ tool: 'Edit', target: 'a.go' }),
      ev({ agentName: 'qa-unit', agentId: 'q', kind: 'agent_start' }),
      ev({ agentName: 'qa-unit', agentId: 'q', kind: 'agent_stop' }),
    ]);
    expect(snap.get('backend')).toMatchObject({ present: true, finished: false, activity: { kind: 'typing' } });
    expect(snap.get('qa-unit')).toMatchObject({ present: true, finished: true });
    expect(snap.get('jefe')?.present).toBe(true);
  });

  it('al cerrar la sesión se van todos', () => {
    const snap = reduceAgents([ev({ kind: 'agent_start' }), ev({ agentName: 'jefe', agentId: 's', kind: 'session_end' })]);
    expect([...snap.values()].every((s) => !s.present)).toBe(true);
  });
});

describe('caminos', () => {
  const map = buildOfficeMap();
  const places = createPlaces(map);

  it('cada agente llega desde la puerta a su escritorio, al café y al tablero', () => {
    for (const d of map.desks) {
      const home = places.home(d.agent);
      const blocked = new Set([...places.seatTiles].filter((t) => t !== home.y * MAP_W + home.x));
      for (const target of [home, places.coffee(d.agent), places.board('hecha'), places.meeting(2)]) {
        const path = findPath(map.walkable, places.door, target, blocked);
        expect(path.length, `${d.agent} → ${target.x},${target.y}`).toBeGreaterThan(0);
        expect(path.at(-1)).toEqual({ x: target.x, y: target.y });
      }
    }
  });

  it('los caminos son contiguos y no atraviesan muebles', () => {
    const path = findPath(map.walkable, places.door, places.home('sec-compliance'));
    let prev = places.door;
    for (const t of path) {
      expect(Math.abs(t.x - prev.x) + Math.abs(t.y - prev.y)).toBe(1);
      expect(map.walkable[t.y * MAP_W + t.x]).toBe(true);
      prev = t;
    }
  });
});
