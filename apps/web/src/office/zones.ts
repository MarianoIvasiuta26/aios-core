import {
  COLUMNS,
  isOpen,
  PIPELINE_STAGES,
  posture,
  SEVERITIES,
  type BacklogStory,
  type Column,
  type Finding,
  type OfficeEvent,
  type Priority,
  type QaResult,
  type Severity,
  type WorkspaceState,
} from '@office/shared';

/** Lo que muestran las zonas de la oficina, derivado de los archivos del workspace. Puro (testeado). */
export interface ZoneModel {
  backlog: { stories: Array<Pick<BacklogStory, 'id' | 'title' | 'priority' | 'column'>>; open: number; done: number } | null;
  qa: { light: QaResult | null; detail: string | null };
  soc: {
    posture: number | null;
    counts: Record<Severity, number>;
    /** Abiertos, en el radar: ángulo fijo por id y distancia por severidad (los críticos al centro). */
    dots: Array<{ id: string; severity: Severity; angle: number; radius: number }>;
    criticals: Finding[];
  };
  funnel: Array<{ stage: string; count: number }> | null;
  opportunities: Array<{ id: string; title: string; score: number; hot: boolean }>;
  leads: { count: number; pins: Array<{ company: string; x: number; y: number; status: string }> } | null;
  approvedDrafts: string[];
}

export const HOT_SCORE = 8;
const BACKLOG_SLOTS = 9;

/** Hash estable 0..1 (FNV-1a) para ubicar cosas siempre en el mismo lugar. */
export function unit(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

const RADIUS: Record<Severity, number> = { Crítica: 0.3, Alta: 0.55, Media: 0.75, Baja: 0.92, Info: 0.92 };
const COLUMN_ORDER = new Map<Column | null, number>(COLUMNS.map((c, i) => [c, i]));
const PRIO_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function zoneModel(ws: WorkspaceState | null): ZoneModel {
  const stories = ws?.backlog?.flatMap((e) => e.stories) ?? [];
  // En el corcho: primero lo que está en curso o por hacer, después por prioridad; lo hecho al final.
  const sorted = [...stories].sort(
    (a, b) =>
      Number(a.column === 'hecha') - Number(b.column === 'hecha') ||
      PRIO_ORDER[a.priority ?? 'P3'] - PRIO_ORDER[b.priority ?? 'P3'] ||
      (COLUMN_ORDER.get(b.column) ?? 0) - (COLUMN_ORDER.get(a.column) ?? 0),
  );

  const findings = ws?.findings;
  const open = findings?.findings.filter(isOpen) ?? [];
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((f) => f.severity === s).length])) as Record<Severity, number>;

  const leads = ws?.leads;
  return {
    backlog: ws?.backlog
      ? {
          stories: sorted.slice(0, BACKLOG_SLOTS).map(({ id, title, priority, column }) => ({ id, title, priority, column })),
          open: stories.filter((s) => s.column !== 'hecha').length,
          done: stories.filter((s) => s.column === 'hecha').length,
        }
      : null,
    qa: ws?.qa
      ? {
          light: ws.qa.result,
          detail: ws.qa.passed !== null || ws.qa.failed !== null ? `${ws.qa.passed ?? 0} ok · ${ws.qa.failed ?? 0} fallan` : null,
        }
      : { light: null, detail: null },
    soc: {
      posture: findings ? posture(findings) : null,
      counts,
      dots: open.map((f) => ({ id: f.id, severity: f.severity, angle: unit(f.id) * Math.PI * 2, radius: RADIUS[f.severity] })),
      criticals: open.filter((f) => f.severity === 'Crítica'),
    },
    funnel: ws?.pipeline
      ? PIPELINE_STAGES.filter((s) => s !== 'Perdido').map((stage) => ({ stage, count: ws.pipeline![stage].length }))
      : null,
    opportunities: (ws?.opportunities ?? [])
      .filter((o) => o.score !== null)
      .map((o) => ({ id: o.id, title: o.opportunity, score: o.score!, hot: o.score! >= HOT_SCORE }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6),
    leads: leads
      ? {
          count: leads.filter((l) => l.status !== 'descartado').length,
          pins: leads
            .filter((l) => l.status !== 'descartado')
            .map((l) => ({
              company: l.company,
              x: 0.08 + unit(l.company, 1) * 0.84,
              y: 0.15 + unit(l.company, 2) * 0.7,
              status: l.status,
            })),
        }
      : null,
    approvedDrafts: (ws?.drafts ?? []).filter((d) => d.status === 'aprobado').map((d) => d.company),
  };
}

/** Lo que cambió entre dos modelos y merece una reacción de los personajes. */
export type ZoneReaction =
  | { type: 'critical'; finding: Finding }
  | { type: 'qa'; light: QaResult }
  | { type: 'hot-opportunity'; title: string }
  | { type: 'new-leads'; count: number }
  | { type: 'draft-approved'; company: string };

/** `prev = null` es la carga inicial: se dibuja el estado sin reaccionar a lo que ya estaba. */
export function zoneReactions(prev: ZoneModel | null, next: ZoneModel): ZoneReaction[] {
  if (!prev) return [];
  const out: ZoneReaction[] = [];
  const known = new Set(prev.soc.criticals.map((f) => f.id));
  for (const f of next.soc.criticals) if (!known.has(f.id)) out.push({ type: 'critical', finding: f });
  if (next.qa.light && next.qa.light !== prev.qa.light) out.push({ type: 'qa', light: next.qa.light });
  const hot = new Set(prev.opportunities.filter((o) => o.hot).map((o) => o.id));
  for (const o of next.opportunities) if (o.hot && !hot.has(o.id)) out.push({ type: 'hot-opportunity', title: o.title });
  const added = (next.leads?.count ?? 0) - (prev.leads?.count ?? 0);
  if (added > 0) out.push({ type: 'new-leads', count: added });
  for (const c of next.approvedDrafts) if (!prev.approvedDrafts.includes(c)) out.push({ type: 'draft-approved', company: c });
  return out;
}

/** Último prompt del usuario en el piso (para el pizarrón de la sala de reuniones). */
export function currentPrompt(events: readonly OfficeEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === 'prompt') return e.target ?? e.summary.replace(/^Pedido: /, '');
    if (e.kind === 'session_end') return null;
  }
  return null;
}
