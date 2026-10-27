import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { COLUMNS, PRIORITIES, TEAMS, parseColumn, redact } from '@office/shared';
import { TaskError, type TaskStore } from './tasks.ts';

const column = z.string().transform((s, ctx) => {
  const c = parseColumn(s);
  if (!c) {
    ctx.addIssue({ code: 'custom', message: `columna inválida: ${s} (válidas: ${COLUMNS.join(', ')})` });
    return z.NEVER;
  }
  return c;
});
const priority = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(PRIORITIES));
const text = (max: number) => z.string().max(max).transform(redact);
const labels = z.array(z.string().trim().min(1).max(40)).max(20);
const actor = z.string().trim().min(1).max(60);

const createSchema = z.object({
  title: text(200).pipe(z.string().trim().min(1, 'el título es obligatorio')),
  description: text(10_000).optional(),
  team: z.enum(TEAMS).nullable().optional(),
  assignee: z.string().max(60).nullable().optional(),
  priority: priority.optional(),
  labels: labels.optional(),
  related: z.string().max(40).nullable().optional(),
  column: column.optional(),
  actor: actor.optional(),
});

const patchSchema = z.object({
  title: text(200).optional(),
  description: text(10_000).optional(),
  team: z.enum(TEAMS).nullable().optional(),
  assignee: z.string().max(60).nullable().optional(),
  priority: priority.optional(),
  labels: labels.optional(),
  related: z.string().max(40).nullable().optional(),
  column: column.optional(),
  position: z.number().finite().optional(),
  actor: actor.optional(),
  note: text(2000).optional(),
});

const commentSchema = z.object({ text: text(5000), actor: actor.optional() });

const listSchema = z.object({
  column: column.optional(),
  team: z.string().optional(),
  assignee: z.string().optional(),
});

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof TaskError) return reply.code(err.status).send({ error: err.message });
  if (err instanceof z.ZodError) {
    return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  }
  throw err;
}

/** La CLI se identifica con este header; sin `--as`, el actor queda `cli` hasta que llegue el hook. */
function defaultActor(headers: Record<string, unknown>): string {
  return headers['x-office-client'] === 'cli' ? 'cli' : 'usuario';
}

export function registerTaskRoutes(app: FastifyInstance, tasks: TaskStore) {
  app.get('/tasks', async (req, reply) => {
    try {
      return tasks.list(listSchema.parse(req.query));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    try {
      return { task: tasks.get(req.params.id), history: tasks.history(req.params.id) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/tasks', async (req, reply) => {
    try {
      const body = createSchema.parse(req.body);
      const { task } = tasks.create({ ...body, actor: body.actor ?? defaultActor(req.headers) });
      return reply.code(201).send(task);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    try {
      const body = patchSchema.parse(req.body);
      return tasks.update(req.params.id, { ...body, actor: body.actor ?? defaultActor(req.headers) }).task;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/comments', async (req, reply) => {
    try {
      const body = commentSchema.parse(req.body);
      const { entries } = tasks.comment(req.params.id, body.text, body.actor ?? defaultActor(req.headers));
      return reply.code(201).send(entries[0]);
    } catch (err) {
      return fail(reply, err);
    }
  });
}
