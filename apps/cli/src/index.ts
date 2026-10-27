/**
 * office-task — CLI del tablero de Agent Office.
 * Los agentes la usan vía Bash para crear y mover sus tarjetas.
 */
import { parseArgs } from 'node:util';
import {
  AGENTS,
  COLUMNS,
  COLUMN_LABELS,
  PRIORITIES,
  TEAMS,
  parseColumn,
  parsePriority,
  type Task,
  type TaskHistoryEntry,
  type Team,
} from '@office/shared';

const BASE = (process.env.AGENT_OFFICE_API ?? 'http://127.0.0.1:4317').replace(/\/$/, '');

const HELP = `office-task — tablero de Agent Office

Uso:
  office-task list [--column <col>] [--team <equipo>] [--assignee <agente>] [--json]
  office-task show <T-n> [--json]
  office-task create "<título>" [--desc <texto>] [--team <equipo>] [--assign <agente>]
                     [--prio P0..P3] [--labels a,b] [--related HU-12] [--column <col>] [--as <agente>]
  office-task move <T-n> <columna> [--note <texto>] [--as <agente>]
  office-task assign <T-n> <agente|none> [--as <agente>]
  office-task comment <T-n> "<texto>" [--as <agente>]

Columnas: ${COLUMNS.join(', ')}  (también: todo, doing, review, blocked, done)
Equipos:  ${TEAMS.filter((t) => t !== 'externo').join(', ')}
Agentes:  ${AGENTS.map((a) => a.id).join(', ')}
Usá siempre --as <tu-nombre-de-agente> para que el historial sepa quién hizo el cambio.`;

class CliError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-office-client': 'cli', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new CliError(`no pude conectar con Agent Office en ${BASE} (¿está corriendo \`pnpm dev\`?)`);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new CliError(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

function line(t: Task): string {
  const who = t.assignee ? ` @${t.assignee}` : '';
  const rel = t.related ? ` (${t.related})` : '';
  const labels = t.labels.length ? ` [${t.labels.join(', ')}]` : '';
  return `${t.id.padEnd(6)} ${t.priority} ${COLUMN_LABELS[t.column].padEnd(12)} ${t.title}${rel}${who}${labels}`;
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new CliError(`falta ${what}. Ver: office-task help`);
  return v;
}

function column(v: string): string {
  const c = parseColumn(v);
  if (!c) throw new CliError(`columna inválida: ${v}. Válidas: ${COLUMNS.join(', ')}`);
  return c;
}

function team(v: string | undefined): Team | undefined {
  if (v === undefined) return undefined;
  if (!(TEAMS as readonly string[]).includes(v)) throw new CliError(`equipo inválido: ${v}. Válidos: ${TEAMS.join(', ')}`);
  return v as Team;
}

function taskId(v: string | undefined): string {
  const id = need(v, 'el id de la tarea (T-n)').toUpperCase();
  const m = /^T-?(\d+)$/.exec(id);
  if (!m) throw new CliError(`id inválido: ${v} (se espera T-<n>)`);
  return `T-${m[1]}`;
}

async function main(argv: string[]) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      column: { type: 'string', short: 'c' },
      team: { type: 'string' },
      assignee: { type: 'string' },
      assign: { type: 'string' },
      desc: { type: 'string', short: 'd' },
      prio: { type: 'string', short: 'p' },
      labels: { type: 'string' },
      related: { type: 'string' },
      note: { type: 'string' },
      as: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, a1, a2] = positionals;
  const actor = o.as ? { actor: o.as } : {};
  const print = (human: string, data: unknown) => console.log(o.json ? JSON.stringify(data, null, 2) : human);

  switch (cmd) {
    case undefined:
    case 'help':
      console.log(HELP);
      return;
    case 'list': {
      const q = new URLSearchParams();
      if (o.column) q.set('column', column(o.column));
      if (o.team) q.set('team', o.team);
      if (o.assignee) q.set('assignee', o.assignee);
      const tasks = await call<Task[]>('GET', `/tasks${q.size ? `?${q}` : ''}`);
      print(tasks.length ? tasks.map(line).join('\n') : 'No hay tarjetas.', tasks);
      return;
    }
    case 'show': {
      const id = taskId(a1);
      const { task, history } = await call<{ task: Task; history: TaskHistoryEntry[] }>('GET', `/tasks/${id}`);
      const hist = history
        .map((h) => {
          const when = new Date(h.at).toLocaleString('es-AR', { hour12: false });
          const change = h.action === 'moved' ? `${h.from} → ${h.to}` : h.action === 'assigned' ? `asignó a ${h.to ?? 'nadie'}` : h.action;
          return `  ${when}  ${h.actor}: ${change}${h.detail ? ` — ${h.detail}` : ''}`;
        })
        .join('\n');
      print(`${line(task)}\n${task.description ? `\n${task.description}\n` : ''}\nHistorial:\n${hist}`, { task, history });
      return;
    }
    case 'create': {
      const prio = o.prio ? parsePriority(o.prio) : undefined;
      if (o.prio && !prio) throw new CliError(`prioridad inválida: ${o.prio}. Válidas: ${PRIORITIES.join(', ')}`);
      const task = await call<Task>('POST', '/tasks', {
        title: need(a1, 'el título'),
        description: o.desc,
        team: team(o.team),
        assignee: o.assign,
        priority: prio ?? undefined,
        labels: o.labels ? o.labels.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        related: o.related,
        column: o.column ? column(o.column) : undefined,
        ...actor,
      });
      print(`Creada ${line(task)}`, task);
      return;
    }
    case 'move': {
      const task = await call<Task>('PATCH', `/tasks/${taskId(a1)}`, { column: column(need(a2, 'la columna')), note: o.note, ...actor });
      print(`Movida ${line(task)}`, task);
      return;
    }
    case 'assign': {
      const who = need(a2, 'el agente');
      const task = await call<Task>('PATCH', `/tasks/${taskId(a1)}`, { assignee: who === 'none' ? null : who, ...actor });
      print(`Asignada ${line(task)}`, task);
      return;
    }
    case 'comment': {
      const entry = await call<TaskHistoryEntry>('POST', `/tasks/${taskId(a1)}/comments`, { text: need(a2, 'el texto'), ...actor });
      print(`Comentario agregado a ${entry.taskId}`, entry);
      return;
    }
    default:
      throw new CliError(`comando desconocido: ${cmd}. Ver: office-task help`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const msg = err instanceof CliError || err instanceof TypeError ? err.message : String(err);
  console.error(`office-task: ${msg}`);
  process.exitCode = 1;
});
