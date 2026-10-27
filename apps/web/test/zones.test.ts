import { describe, expect, it } from 'vitest';
import type { OfficeEvent, WorkspaceState } from '@office/shared';
import { currentPrompt, unit, zoneModel, zoneReactions } from '../src/office/zones.ts';

const ws = (p: Partial<WorkspaceState>): WorkspaceState => ({
  root: '/r',
  backlog: null,
  qa: null,
  findings: null,
  opportunities: null,
  leads: null,
  pipeline: null,
  drafts: [],
  errors: [],
  updatedAt: 0,
  ...p,
});

const finding = (id: string, severity: 'Crítica' | 'Alta' | 'Media', state: 'abierto' | 'resuelto' = 'abierto') => ({
  id,
  title: id,
  severity,
  state,
  component: null,
  evidence: null,
  reference: null,
  auditor: 'sec-cloud',
  task: null,
  detected: null,
});

describe('modelo de zonas', () => {
  it('sin workspace todo está vacío', () => {
    const m = zoneModel(null);
    expect(m.backlog).toBeNull();
    expect(m.qa.light).toBeNull();
    expect(m.soc.posture).toBeNull();
    expect(m.leads).toBeNull();
  });

  it('backlog: lo pendiente primero, por prioridad; cuenta abiertas y hechas', () => {
    const m = zoneModel(
      ws({
        backlog: [
          {
            id: 'EP-1',
            title: 'x',
            stories: [
              { id: 'HU-1', title: 'a', priority: 'P1', column: 'hecha', task: null, epic: 'EP-1' },
              { id: 'HU-2', title: 'b', priority: 'P3', column: 'backlog', task: null, epic: 'EP-1' },
              { id: 'HU-3', title: 'c', priority: 'P0', column: 'por-hacer', task: null, epic: 'EP-1' },
            ],
          },
        ],
      }),
    );
    expect(m.backlog!.stories.map((s) => s.id)).toEqual(['HU-3', 'HU-2', 'HU-1']);
    expect(m.backlog).toMatchObject({ open: 2, done: 1 });
  });

  it('SOC: solo abiertos en el radar, críticos al centro, postura calculada', () => {
    const m = zoneModel(
      ws({
        findings: {
          updated: null,
          posture: null,
          findings: [finding('SEC-1', 'Crítica'), finding('SEC-2', 'Media'), finding('SEC-3', 'Alta', 'resuelto')],
        },
      }),
    );
    expect(m.soc.dots.map((d) => d.id)).toEqual(['SEC-1', 'SEC-2']);
    expect(m.soc.dots[0]!.radius).toBeLessThan(m.soc.dots[1]!.radius);
    expect(m.soc.counts).toMatchObject({ Crítica: 1, Alta: 0, Media: 1 });
    expect(m.soc.posture).toBe(100 - 25 - 3);
    expect(m.soc.criticals.map((f) => f.id)).toEqual(['SEC-1']);
  });

  it('las posiciones son estables', () => {
    expect(unit('Acme')).toBe(unit('Acme'));
    expect(unit('Acme')).not.toBe(unit('Acme', 1));
    const a = zoneModel(
      ws({
        leads: [{ company: 'Acme', industry: null, size: null, website: null, fit: null, source: null, checkedAt: null, status: 'nuevo' }],
      }),
    );
    expect(a.leads!.pins[0]!.x).toBeGreaterThan(0);
    expect(a.leads!.pins[0]!.x).toBeLessThan(1);
  });
});

describe('reacciones', () => {
  const base = zoneModel(ws({ findings: { updated: null, posture: null, findings: [finding('SEC-1', 'Crítica')] } }));

  it('la carga inicial no dispara nada', () => {
    expect(zoneReactions(null, base)).toEqual([]);
  });

  it('crítico nuevo, QA, oportunidad caliente, leads y borrador aprobado', () => {
    const next = zoneModel(
      ws({
        findings: { updated: null, posture: null, findings: [finding('SEC-1', 'Crítica'), finding('SEC-9', 'Crítica')] },
        qa: { file: 'r.md', date: null, result: 'rojo', passed: 1, failed: 1, skipped: 0, coverage: null },
        opportunities: [
          {
            id: 'OP-1',
            opportunity: 'Pagos',
            segment: null,
            score: 9,
            competition: null,
            estimate: null,
            verified: false,
            source: null,
            checkedAt: null,
          },
        ],
        leads: [{ company: 'A', industry: null, size: null, website: null, fit: null, source: null, checkedAt: null, status: 'nuevo' }],
        drafts: [{ file: 'a.md', company: 'A', status: 'aprobado' }],
      }),
    );
    expect(zoneReactions(base, next).map((r) => r.type)).toEqual(['critical', 'qa', 'hot-opportunity', 'new-leads', 'draft-approved']);
    expect(zoneReactions(next, next)).toEqual([]);
  });
});

describe('pizarrón', () => {
  const ev = (id: number, kind: OfficeEvent['kind'], summary: string, target: string | null = null) =>
    ({ id, kind, summary, target }) as OfficeEvent;
  it('último pedido; se borra al terminar la sesión', () => {
    expect(currentPrompt([ev(1, 'prompt', 'Pedido: uno', 'uno completo'), ev(2, 'tool_start', 'x'), ev(3, 'prompt', 'Pedido: dos')])).toBe(
      'dos',
    );
    expect(currentPrompt([ev(1, 'prompt', 'Pedido: uno'), ev(2, 'session_end', 'fin')])).toBeNull();
    expect(currentPrompt([])).toBeNull();
  });
});
