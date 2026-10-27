import { z } from 'zod';
import { profileFor, redact, type EventKind, type EventStatus, type OfficeEvent } from '@office/shared';

/** Payload que Claude Code manda por stdin a los hooks (solo los campos que usamos). */
export const hookPayloadSchema = z
  .object({
    session_id: z.string().min(1),
    hook_event_name: z.string().min(1),
    cwd: z.string().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
    source: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_response: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    duration_ms: z.number().optional(),
    error: z.string().optional(),
    is_interrupt: z.boolean().optional(),
    message: z.string().optional(),
    notification_type: z.string().optional(),
    reason: z.string().optional(),
    last_assistant_message: z.string().optional(),
  })
  .loose();

export type HookPayload = z.infer<typeof hookPayloadSchema>;

export type NormalizedEvent = Omit<OfficeEvent, 'id'>;

const TASK_MOVE_RE = /(?:^|[\s;&|(])(?:office-task|pnpm\s+(?:-\S+\s+(?:\S+\s+)?)*task)\s+move\s+(\S+)\s+(\S+)/;

const MAX_LINE = 120;

function oneLine(s: string, max = MAX_LINE): string {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function rel(path: string, cwd: string | undefined): string {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface ToolDescription {
  summary: string;
  target: string | null;
  kind?: EventKind;
}

/** Describe una invocación de herramienta en una línea legible. */
export function describeTool(tool: string, input: unknown, cwd: string | undefined): ToolDescription {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const path = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path);
  switch (tool) {
    case 'Read':
      return { summary: `Leyendo ${rel(path ?? '?', cwd)}`, target: path ? rel(path, cwd) : null };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { summary: `Editando ${rel(path ?? '?', cwd)}`, target: path ? rel(path, cwd) : null };
    case 'Write':
      return { summary: `Escribiendo ${rel(path ?? '?', cwd)}`, target: path ? rel(path, cwd) : null };
    case 'Grep': {
      const pattern = str(i.pattern) ?? '';
      return { summary: `Buscando «${oneLine(pattern, 60)}»${path ? ` en ${rel(path, cwd)}` : ''}`, target: pattern };
    }
    case 'Glob': {
      const pattern = str(i.pattern) ?? '';
      return { summary: `Buscando archivos ${oneLine(pattern, 80)}`, target: pattern };
    }
    case 'Bash': {
      const cmd = str(i.command) ?? '';
      const move = TASK_MOVE_RE.exec(cmd);
      if (move) {
        return { summary: `Moviendo ${move[1]} → ${move[2]}`, target: `${move[1]} ${move[2]}`, kind: 'task_move' };
      }
      return { summary: `Corriendo: ${oneLine(cmd, 100)}`, target: oneLine(cmd, 300) };
    }
    case 'WebSearch': {
      const q = str(i.query) ?? '';
      return { summary: `Buscando en la web: ${oneLine(q, 90)}`, target: q };
    }
    case 'WebFetch': {
      const url = str(i.url) ?? '';
      return { summary: `Leyendo web: ${host(url)}`, target: url };
    }
    case 'Agent':
    case 'Task': {
      const who = str(i.subagent_type) ?? 'general-purpose';
      const what = str(i.description);
      return { summary: `Delegando a ${who}${what ? `: ${oneLine(what, 80)}` : ''}`, target: who };
    }
    case 'TodoWrite':
      return { summary: 'Actualizando su lista de pendientes', target: null };
    default: {
      if (tool.startsWith('mcp__')) {
        const [, server, name] = tool.split('__');
        return { summary: `MCP ${server ?? '?'}: ${name ?? '?'}`, target: tool };
      }
      return { summary: `Usando ${tool}`, target: null };
    }
  }
}

/** Convierte el payload crudo del hook en un evento de la oficina (sin id). */
export function normalize(p: HookPayload, timestamp: number): NormalizedEvent {
  const profile = profileFor(p.agent_type);
  const base = {
    sessionId: p.session_id,
    agentId: p.agent_id ?? p.session_id,
    agentName: profile.id,
    agentType: p.agent_type ?? null,
    team: profile.team,
    tool: p.tool_name ?? null,
    toolUseId: p.tool_use_id ?? null,
    timestamp,
    durationMs: p.duration_ms ?? null,
    cwd: p.cwd ?? null,
  };
  const make = (kind: EventKind, summary: string, status: EventStatus, target: string | null = null): NormalizedEvent => ({
    ...base,
    kind,
    summary: redact(summary),
    target: target === null ? null : redact(target),
    status,
  });

  switch (p.hook_event_name) {
    case 'SessionStart':
      return make('session_start', `Sesión iniciada (${p.source ?? 'startup'})`, 'ok');
    case 'UserPromptSubmit':
      return make('prompt', `Pedido: ${oneLine(p.prompt ?? '')}`, 'ok', p.prompt ? oneLine(p.prompt, 500) : null);
    case 'PreToolUse': {
      const d = describeTool(p.tool_name ?? '?', p.tool_input, p.cwd);
      return make(d.kind ?? 'tool_start', d.summary, 'running', d.target);
    }
    case 'PostToolUse': {
      const d = describeTool(p.tool_name ?? '?', p.tool_input, p.cwd);
      return make('tool_end', d.summary, 'ok', d.target);
    }
    case 'PostToolUseFailure': {
      const d = describeTool(p.tool_name ?? '?', p.tool_input, p.cwd);
      if (p.is_interrupt) return make('tool_error', `Interrumpido: ${d.summary}`, 'error', d.target);
      const firstLine = (p.error ?? 'falló').split('\n')[0] ?? 'falló';
      return make('tool_error', `Error en ${p.tool_name ?? '?'}: ${oneLine(firstLine, 90)}`, 'error', d.target);
    }
    case 'Notification': {
      const type = p.notification_type ?? '';
      const msg = oneLine(p.message ?? '');
      if (type === 'permission_prompt' || type === 'agent_needs_input' || type === 'elicitation_dialog') {
        return make('waiting', msg ? `Esperando permiso: ${msg}` : 'Esperando permiso', 'waiting');
      }
      if (type === 'idle_prompt') return make('waiting', 'Esperando tu respuesta', 'waiting');
      return make('notification', msg || `Notificación (${type || 'sin tipo'})`, 'ok');
    }
    case 'SubagentStart':
      return make('agent_start', `${profile.displayName} entra a la oficina`, 'running');
    case 'SubagentStop':
      return make(
        'agent_stop',
        `${profile.displayName} terminó`,
        'done',
        p.last_assistant_message ? oneLine(p.last_assistant_message, 300) : null,
      );
    case 'Stop':
      return make('stop', 'Terminó de responder', 'done');
    case 'SessionEnd':
      return make('session_end', `Sesión cerrada (${p.reason ?? 'other'})`, 'done');
    default:
      return make('notification', `Evento ${p.hook_event_name}`, 'ok');
  }
}
