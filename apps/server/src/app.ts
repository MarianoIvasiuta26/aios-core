import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { ServerMessage, WorkspaceState } from '@office/shared';
import { openDb } from './db.ts';
import { createIngest, resolveTimestamp } from './ingest.ts';
import { hookPayloadSchema } from './normalize.ts';
import { createDemo } from './demo.ts';
import type { OfficeDb } from './db.ts';
import type { Ingest } from './ingest.ts';
import { createTaskStore, type TaskStore } from './tasks.ts';
import { registerTaskRoutes } from './task-routes.ts';
import { createAutomations } from './automations.ts';
import { createCriticalAutomation } from './critical.ts';
import { createWorkspaces, resolveRoot } from './workspace.ts';

declare module 'fastify' {
  interface FastifyInstance {
    office: {
      db: OfficeDb;
      ingest: Ingest;
      tasks: TaskStore;
      demo: ReturnType<typeof createDemo>;
      workspaces: ReturnType<typeof createWorkspaces>;
    };
  }
}

export interface AppOptions {
  dbFile: string;
  logger?: boolean | { level: string };
  reorderWindowMs?: number;
  /** Cada cuánto se revisan los archivos del workspace (ms). */
  workspacePollMs?: number;
  /** Carpeta del repo ficticio de la demo. */
  demoRoot?: string;
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(websocket);

  const db = openDb(opts.dbFile);
  const clients = new Set<WebSocket>();
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const ingest = createIngest(db, broadcast, opts.reorderWindowMs);
  const states = new Map<string, WorkspaceState>();
  let critical: ((ws: Iterable<WorkspaceState>) => void) | null = null;
  const tasks = createTaskStore(db.raw, ({ task, entries, moved }) => {
    broadcast({ type: 'task_upsert', task, entries });
    if (moved) broadcast({ type: 'task_moved', taskId: task.id, ...moved });
    // Una tarjeta nueva o editada puede apuntar a un hallazgo crítico ya conocido.
    if (task.related) critical?.(states.values());
  });
  critical = createCriticalAutomation(db.raw, tasks);
  const workspaces = createWorkspaces((ws) => {
    states.set(ws.root, ws);
    broadcast({ type: 'workspace', workspace: ws });
    critical?.([ws]);
  }, opts.workspacePollMs);
  ingest.onEvent(createAutomations(db, tasks));
  const demo = createDemo(ingest, tasks, opts.demoRoot ?? join(tmpdir(), 'agent-office-demo'));
  app.decorate('office', { db, ingest, tasks, demo, workspaces });

  app.addHook('onClose', async () => {
    demo.stop();
    workspaces.stop();
    ingest.stop();
    db.close();
  });

  app.get('/health', async () => ({ ok: true }));

  // Archivos del repo de trabajo de una sesión. El cliente nunca manda rutas: se resuelven acá.
  app.get<{ Querystring: { session?: string } }>('/workspace', async (req, reply) => {
    const session = req.query.session ? db.getSession(req.query.session) : null;
    if (req.query.session && !session) return reply.code(404).send({ error: 'sesión inexistente' });
    // La demo siempre muestra su repo ficticio, aunque AGENT_OFFICE_WORKSPACE apunte a otro.
    const root = session?.cwd === demo.root ? demo.root : resolveRoot(session?.cwd ?? null);
    if (!root) return { workspace: null };
    return { workspace: workspaces.get(root) };
  });

  app.post('/events', async (req, reply) => {
    const parsed = hookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'payload inválido', issues: parsed.error.issues.slice(0, 5) });
    }
    const ts = resolveTimestamp(req.headers['x-emit-ts'] as string | undefined, Date.now());
    ingest.push(parsed.data, ts);
    return reply.code(202).send({ ok: true });
  });

  app.get('/sessions', async () => db.listSessions());

  app.get<{ Params: { id: string } }>('/sessions/:id/state', async (req, reply) => {
    const session = db.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'sesión inexistente' });
    return { session, runs: db.sessionRuns(session.id), events: db.sessionEvents(session.id) };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/agents/:id/history', async (req) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    return db.agentHistory(req.params.id, limit);
  });

  registerTaskRoutes(app, tasks);

  app.get('/demo', async () => demo.status);
  app.post<{ Body: { speed?: number } | undefined }>('/demo/start', async (req) => ({
    sessionId: demo.start(req.body?.speed ?? 1),
  }));
  app.post('/demo/stop', async () => {
    demo.stop();
    return demo.status;
  });

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'hello', serverTime: Date.now() } satisfies ServerMessage));
    socket.on('close', () => clients.delete(socket));
  });

  return app;
}

export type OfficeApp = Awaited<ReturnType<typeof buildApp>>;
