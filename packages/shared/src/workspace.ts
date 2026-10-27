import { parseColumn, parsePriority, type Column, type Priority } from './tasks.ts';

/**
 * Archivos que mantienen los agentes en el repo de trabajo y que la oficina muestra.
 * Los formatos están definidos en claude/agents/*.md; los parsers son tolerantes: lo que no
 * entienden lo saltean en vez de fallar.
 */
export const WORKSPACE_FILES = {
  backlog: 'docs/BACKLOG.md',
  qaDir: 'docs/qa',
  findings: 'docs/security/hallazgos.json',
  opportunities: 'comercial/mercado/oportunidades.json',
  leads: 'comercial/leads.csv',
  pipeline: 'comercial/pipeline.md',
  draftsDir: 'comercial/borradores',
} as const;

// ── Backlog ─────────────────────────────────────────────────────────────────

export interface BacklogStory {
  id: string;
  title: string;
  priority: Priority | null;
  column: Column | null;
  task: string | null;
  epic: string | null;
}

export interface BacklogEpic {
  id: string;
  title: string;
  stories: BacklogStory[];
}

const SEP = /\s+[·|•-]\s+/;

/** `## EP-1 · Título` y `### HU-12 · Título · P1 · por-hacer · T-23`. */
export function parseBacklog(md: string): BacklogEpic[] {
  const epics: BacklogEpic[] = [];
  let current: BacklogEpic | null = null;
  for (const line of md.split('\n')) {
    const epic = /^##\s+(EP-\d+)\s*(?:[·|•:-]\s*)?(.*)$/.exec(line.trim());
    if (epic) {
      current = { id: epic[1]!, title: epic[2]!.trim(), stories: [] };
      epics.push(current);
      continue;
    }
    const story = /^###\s+(HU-\d+)\s*(?:[·|•:-]\s*)?(.*)$/.exec(line.trim());
    if (!story) continue;
    const parts = story[2]!.split(SEP).map((p) => p.trim());
    const s: BacklogStory = { id: story[1]!, title: parts[0] ?? '', priority: null, column: null, task: null, epic: current?.id ?? null };
    for (const p of parts.slice(1)) {
      s.priority ??= /^P[0-3]$/i.test(p) ? parsePriority(p.toUpperCase()) : null;
      if (/^T-\d+$/i.test(p)) s.task = p.toUpperCase();
      else if (!/^P[0-3]$/i.test(p)) s.column ??= parseColumn(p);
    }
    if (!current) {
      current = { id: 'EP-?', title: 'Sin épica', stories: [] };
      epics.push(current);
    }
    current.stories.push(s);
  }
  return epics;
}

// ── QA ──────────────────────────────────────────────────────────────────────

export type QaResult = 'verde' | 'amarillo' | 'rojo';

export interface QaReport {
  file: string;
  date: string | null;
  result: QaResult | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  coverage: number | null;
}

export function parseQaReport(md: string, file: string): QaReport {
  const date = /REPORTE-(\d{4}-\d{2}-\d{2})/.exec(file)?.[1] ?? null;
  const result = /^Resultado:\s*(verde|amarillo|rojo)/im.exec(md)?.[1]?.toLowerCase() as QaResult | undefined;
  const num = (re: RegExp) => {
    const m = re.exec(md);
    return m ? Number(m[1]) : null;
  };
  const failed = num(/(\d+)\s+fall(?:a|an)\b/i);
  return {
    file,
    date,
    // Si no dice el resultado pero hay fallas contadas, es rojo.
    result: result ?? (failed !== null ? (failed > 0 ? 'rojo' : 'verde') : null),
    passed: num(/(\d+)\s+pasan?\b/i),
    failed,
    skipped: num(/(\d+)\s+omitidos?\b/i),
    coverage: num(/cobertura\s+(\d+(?:\.\d+)?)\s*%/i),
  };
}

// ── Hallazgos de seguridad ─────────────────────────────────────────────────

export const SEVERITIES = ['Crítica', 'Alta', 'Media', 'Baja', 'Info'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const FINDING_STATES = ['abierto', 'en curso', 'resuelto', 'aceptado'] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  state: FindingState;
  component: string | null;
  evidence: string | null;
  reference: string | null;
  auditor: string | null;
  task: string | null;
  detected: string | null;
}

export interface Findings {
  updated: string | null;
  posture: number | null;
  findings: Finding[];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function parseSeverity(v: unknown): Severity {
  const s = fold(String(v ?? ''));
  if (s.startsWith('crit')) return 'Crítica';
  if (s.startsWith('alt') || s === 'high') return 'Alta';
  if (s.startsWith('med')) return 'Media';
  if (s.startsWith('baj') || s === 'low') return 'Baja';
  return 'Info';
}

export function parseFindingState(v: unknown): FindingState {
  const s = fold(String(v ?? ''));
  if (s.startsWith('resuel') || s === 'resolved' || s === 'fixed') return 'resuelto';
  if (s.startsWith('acept') || s === 'accepted') return 'aceptado';
  if (s.includes('curso') || s === 'in progress') return 'en curso';
  return 'abierto';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

export function parseFindings(json: string): Findings {
  const data = JSON.parse(json) as unknown;
  const root = (Array.isArray(data) ? { hallazgos: data } : data) as Record<string, unknown>;
  const list = Array.isArray(root.hallazgos) ? root.hallazgos : Array.isArray(root.findings) ? root.findings : [];
  const findings: Finding[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.id);
    if (!id) continue;
    findings.push({
      id,
      title: str(raw.titulo ?? raw.title) ?? id,
      severity: parseSeverity(raw.severidad ?? raw.severity),
      state: parseFindingState(raw.estado ?? raw.state),
      component: str(raw.componente ?? raw.component),
      evidence: str(raw.evidencia ?? raw.evidence),
      reference: str(raw.referencia ?? raw.reference),
      auditor: str(raw.auditor),
      task: str(raw.tarjeta ?? raw.task)?.toUpperCase() ?? null,
      detected: str(raw.detectado ?? raw.detected),
    });
  }
  const posture = typeof root.postura === 'number' ? root.postura : typeof root.posture === 'number' ? root.posture : null;
  return {
    updated: str(root.actualizado ?? root.updated),
    posture: posture === null ? null : Math.max(0, Math.min(100, posture)),
    findings,
  };
}

export const isOpen = (f: Finding) => f.state === 'abierto' || f.state === 'en curso';

const PENALTY: Record<Severity, number> = { Crítica: 25, Alta: 10, Media: 3, Baja: 1, Info: 0 };

/** Postura 0–100: la que calculó compliance o, si no hay, 100 menos penalizaciones por abiertos. */
export function posture(f: Findings): number {
  if (f.posture !== null) return f.posture;
  return Math.max(0, 100 - f.findings.filter(isOpen).reduce((n, x) => n + PENALTY[x.severity], 0));
}

// ── Comercial ───────────────────────────────────────────────────────────────

export interface Opportunity {
  id: string;
  opportunity: string;
  segment: string | null;
  score: number | null;
  competition: string | null;
  estimate: string | null;
  verified: boolean;
  source: string | null;
  checkedAt: string | null;
}

export function parseOpportunities(json: string): Opportunity[] {
  const data = JSON.parse(json) as unknown;
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { oportunidades?: unknown })?.oportunidades)
      ? (data as { oportunidades: unknown[] }).oportunidades
      : [];
  return (list as Array<Record<string, unknown>>)
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => {
      const score = Number(r.puntaje ?? r.score);
      return {
        id: str(r.id) ?? `OP-${i + 1}`,
        opportunity: str(r.oportunidad ?? r.opportunity) ?? 'Sin título',
        segment: str(r.segmento ?? r.segment),
        score: Number.isFinite(score) ? Math.max(1, Math.min(10, score)) : null,
        competition: str(r.competencia ?? r.nivel_competencia ?? r.competition),
        estimate: str(r.tamano_estimado ?? r.tamaño_estimado ?? r.size),
        verified: fold(String(r.tipo_dato ?? '')) === 'verificado',
        source: str(r.fuente ?? r.source),
        checkedAt: str(r.fecha_consulta ?? r.fecha),
      };
    });
}

/** CSV con comillas dobles (RFC 4180). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export const LEAD_STATES = ['nuevo', 'investigado', 'contactado', 'descartado'] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export interface Lead {
  company: string;
  industry: string | null;
  size: string | null;
  website: string | null;
  fit: string | null;
  source: string | null;
  checkedAt: string | null;
  status: LeadState;
}

export function parseLeads(csv: string): Lead[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  const cols = header.map(fold);
  const at = (row: string[], ...names: string[]) => {
    for (const n of names) {
      const i = cols.indexOf(n);
      if (i >= 0 && row[i]?.trim()) return row[i]!.trim();
    }
    return null;
  };
  return rows
    .map((r) => {
      const status = fold(at(r, 'estado', 'status') ?? 'nuevo') as LeadState;
      return {
        company: at(r, 'empresa', 'company') ?? '',
        industry: at(r, 'rubro', 'industry'),
        size: at(r, 'tamano', 'tamanio', 'size'),
        website: at(r, 'sitio_web', 'sitio web', 'website'),
        fit: at(r, 'por_que_encaja', 'por que encaja', 'fit'),
        source: at(r, 'fuente', 'source'),
        checkedAt: at(r, 'fecha_consulta', 'fecha'),
        status: (LEAD_STATES as readonly string[]).includes(status) ? status : 'nuevo',
      };
    })
    .filter((l) => l.company);
}

export const PIPELINE_STAGES = ['Lead', 'Contactado', 'Reunión', 'Propuesta', 'Ganado', 'Perdido'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineItem {
  company: string;
  detail: string | null;
}

export type Pipeline = Record<PipelineStage, PipelineItem[]>;

export function parsePipeline(md: string): Pipeline {
  const out = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, []])) as unknown as Pipeline;
  let stage: PipelineStage | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      const name = fold(h[1]!.replace(/\(.*\)/, ''));
      stage = PIPELINE_STAGES.find((s) => name.startsWith(fold(s).slice(0, 5))) ?? null;
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (!stage || !item) continue;
    const [company, ...rest] = item[1]!.split(/\s+[—–-]\s+/);
    out[stage].push({ company: company!.replace(/\*\*/g, '').trim(), detail: rest.join(' — ').trim() || null });
  }
  return out;
}

export type DraftState = 'borrador' | 'aprobado' | 'cambios';

export interface Draft {
  file: string;
  company: string;
  status: DraftState;
}

export function parseDraft(md: string, file: string): Draft {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'mi').exec(fm)?.[1]?.trim() ?? null;
  const status = fold(field('estado') ?? 'borrador');
  return {
    file,
    company: field('empresa') ?? file.replace(/\.md$/, ''),
    status: status.startsWith('aprob') ? 'aprobado' : status.startsWith('cambio') ? 'cambios' : 'borrador',
  };
}

// ── Estado completo ─────────────────────────────────────────────────────────

export interface WorkspaceState {
  root: string;
  /** null = el archivo todavía no existe. */
  backlog: BacklogEpic[] | null;
  qa: QaReport | null;
  findings: Findings | null;
  opportunities: Opportunity[] | null;
  leads: Lead[] | null;
  pipeline: Pipeline | null;
  drafts: Draft[];
  /** Archivos que existen pero no se pudieron leer (formato inválido). */
  errors: string[];
  updatedAt: number;
}
