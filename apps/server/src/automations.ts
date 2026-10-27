import { extractTaskIds, parseColumn, VISITOR_ID, type Column, type OfficeEvent } from '@office/shared';
import type { OfficeDb } from './db.ts';
import type { HookPayload } from './normalize.ts';
import type { TaskStore } from './tasks.ts';

/** Comandos que cuentan como "correr tests". */
const TEST_COMMAND_RE =
  /\b(?:vitest|jest|go\s+test|phpunit|pest|pytest|playwright\s+test|php\s+artisan\s+test|(?:pnpm|npm|yarn)\s+(?:run\s+)?test(?::\S+)?)\b/;
const TASK_MOVE_RE = /(?:office-task|task)\s+move\s+(T-\d+)\s+(\S+)/;
/** Columnas desde las que una tarjeta pasa a "En curso" cuando arranca su agente. */
const STARTABLE: readonly Column[] = ['backlog', 'por-hacer', 'bloqueada'];
const REATTRIBUTE_WINDOW_MS = 30_000;

function input(p: HookPayload): Record<string, unknown> {
  return p.tool_input && typeof p.tool_input === 'object' ? (p.tool_input as Record<string, unknown>) : {};
}

/**
 * Reglas automáticas del tablero:
 *  - El jefe lanza un subagente con `[T-n]` en el prompt → al arrancar, la tarjeta se le asigna y pasa a "En curso".
 *  - Un comando de tests falla dentro de un subagente → su tarjeta pasa a "Bloqueada".
 *  - `office-task move` sin `--as` → el movimiento se atribuye al agente que corrió el comando.
 */
export function createAutomations(db: OfficeDb, tasks: TaskStore) {
  /** `${sessionId}|${subagent_type}` → cola de listas de tareas (puede haber varios del mismo tipo en paralelo). */
  const pending = new Map<string, string[][]>();

  function onDelegate(e: OfficeEvent, p: HookPayload) {
    const i = input(p);
    const type = typeof i.subagent_type === 'string' ? i.subagent_type : 'general-purpose';
    const ids = extractTaskIds(`${String(i.description ?? '')} ${String(i.prompt ?? '')}`);
    if (ids.length === 0) return;
    const key = `${e.sessionId}|${type}`;
    pending.set(key, [...(pending.get(key) ?? []), ids]);
  }

  function onAgentStart(e: OfficeEvent) {
    const key = `${e.sessionId}|${e.agentType ?? ''}`;
    const queue = pending.get(key);
    const ids = queue?.shift();
    if (queue && queue.length === 0) pending.delete(key);
    if (!ids) return;
    const first = ids.find((id) => tasks.exists(id));
    if (!first) return;
    db.setRunTask(e.agentId, first);
    for (const id of ids) {
      if (!tasks.exists(id)) continue;
      const t = tasks.get(id);
      const assignee = !t.assignee && e.agentName !== VISITOR_ID ? e.agentName : undefined;
      const column = STARTABLE.includes(t.column) ? 'en-curso' : undefined;
      if (assignee || column) {
        tasks.update(id, { assignee, column, actor: e.agentName, note: `Arrancó ${e.agentType ?? e.agentName}` }, e.timestamp);
      }
    }
  }

  function onToolError(e: OfficeEvent, p: HookPayload) {
    if (e.tool !== 'Bash' || p.is_interrupt) return;
    const command = String(input(p).command ?? '');
    if (!TEST_COMMAND_RE.test(command)) return;
    const taskId = db.getRun(e.agentId)?.taskId;
    if (!taskId || !tasks.exists(taskId)) return;
    const t = tasks.get(taskId);
    if (t.column === 'bloqueada' || t.column === 'hecha') return;
    tasks.update(taskId, { column: 'bloqueada', actor: e.agentName, note: `Test fallido: ${e.target ?? command}` }, e.timestamp);
  }

  function onTaskMove(e: OfficeEvent, p: HookPayload) {
    const m = TASK_MOVE_RE.exec(String(input(p).command ?? ''));
    const column = m?.[2] ? parseColumn(m[2]) : null;
    if (!m?.[1] || !column || !tasks.exists(m[1])) return;
    tasks.reattribute(m[1], column, e.agentName, e.timestamp - REATTRIBUTE_WINDOW_MS);
  }

  return (e: OfficeEvent, p: HookPayload) => {
    if (e.kind === 'tool_start' && (e.tool === 'Agent' || e.tool === 'Task')) onDelegate(e, p);
    else if (e.kind === 'agent_start') onAgentStart(e);
    else if (e.kind === 'tool_error') onToolError(e, p);
    else if (e.kind === 'tool_end' && TASK_MOVE_RE.test(String(input(p).command ?? ''))) onTaskMove(e, p);
  };
}
