import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  parseBacklog,
  parseDraft,
  parseFindings,
  parseLeads,
  parseOpportunities,
  parsePipeline,
  parseQaReport,
  redactDeep,
  WORKSPACE_FILES,
  type WorkspaceState,
} from '@office/shared';

/** Archivos más grandes que esto no se leen (son de los agentes, no deberían pesar). */
const MAX_BYTES = 1024 * 1024;
const POLL_MS = 1000;
const MAX_ROOTS = 4;

/** Raíz del repo de trabajo: AGENT_OFFICE_WORKSPACE o la raíz git del cwd de la sesión. */
export function resolveRoot(cwd: string | null, fixed = process.env.AGENT_OFFICE_WORKSPACE): string | null {
  if (fixed) return resolve(fixed);
  if (!cwd) return null;
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

function stat(path: string): string {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
}

function listMd(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/** Firma barata de todo lo que miramos: si no cambia, no se vuelve a leer nada. */
export function signature(root: string): string {
  const F = WORKSPACE_FILES;
  const parts = [F.backlog, F.findings, F.opportunities, F.leads, F.pipeline].map((f) => stat(join(root, f)));
  for (const dir of [F.qaDir, F.draftsDir]) for (const f of listMd(join(root, dir))) parts.push(`${f}=${stat(join(root, dir, f))}`);
  return parts.join('|');
}

/** Lee y parsea los archivos del workspace. Nunca tira: los errores quedan en `errors`. */
export function readWorkspace(root: string, now = Date.now()): WorkspaceState {
  const F = WORKSPACE_FILES;
  const errors: string[] = [];
  const read = <T>(rel: string, parse: (text: string) => T): T | null => {
    const path = join(root, rel);
    if (!existsSync(path)) return null;
    try {
      if (statSync(path).size > MAX_BYTES) throw new Error('archivo demasiado grande');
      return parse(readFileSync(path, 'utf8'));
    } catch (err) {
      errors.push(`${rel}: ${err instanceof SyntaxError ? 'formato inválido' : (err as Error).message}`);
      return null;
    }
  };

  // El reporte de QA más reciente por nombre (REPORTE-AAAA-MM-DD.md ordena por fecha).
  const reports = listMd(join(root, F.qaDir)).filter((f) => /^REPORTE-/i.test(f));
  const lastReport = reports.at(-1);
  const state: WorkspaceState = {
    root,
    backlog: read(F.backlog, parseBacklog),
    qa: lastReport ? read(`${F.qaDir}/${lastReport}`, (t) => parseQaReport(t, lastReport)) : null,
    findings: read(F.findings, parseFindings),
    opportunities: read(F.opportunities, parseOpportunities),
    leads: read(F.leads, parseLeads),
    pipeline: read(F.pipeline, parsePipeline),
    drafts: listMd(join(root, F.draftsDir))
      .map((f) => read(`${F.draftsDir}/${f}`, (t) => parseDraft(t, f)))
      .filter((d) => d !== null),
    errors,
    updatedAt: now,
  };
  // Los agentes no deberían dejar secretos, pero por las dudas todo pasa por el redactor.
  return redactDeep(state) as WorkspaceState;
}

interface Watched {
  state: WorkspaceState;
  sig: string;
  lastUsed: number;
}

export type WorkspaceListener = (next: WorkspaceState, prev: WorkspaceState | null) => void;

/** Vigila hasta MAX_ROOTS repos (los últimos pedidos) consultando las fechas de modificación. */
export function createWorkspaces(onChange: WorkspaceListener, pollMs = POLL_MS) {
  const watched = new Map<string, Watched>();

  const timer = setInterval(() => {
    for (const [root, w] of watched) {
      const sig = signature(root);
      if (sig === w.sig) continue;
      const prev = w.state;
      w.sig = sig;
      w.state = readWorkspace(root);
      onChange(w.state, prev);
    }
  }, pollMs);
  timer.unref();

  return {
    /** Estado actual del repo; empieza a vigilarlo si no lo estaba. */
    get(root: string): WorkspaceState {
      let w = watched.get(root);
      if (!w) {
        if (watched.size >= MAX_ROOTS) {
          const oldest = [...watched].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]![0];
          watched.delete(oldest);
        }
        w = { state: readWorkspace(root), sig: signature(root), lastUsed: Date.now() };
        watched.set(root, w);
        onChange(w.state, null);
      }
      w.lastUsed = Date.now();
      return w.state;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
