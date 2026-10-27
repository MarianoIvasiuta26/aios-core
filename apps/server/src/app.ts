import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { ServerMessage } from '@office/shared';
import { openDb } from './db.ts';
import { createIngest, resolveTimestamp } from './ingest.ts';
import { hookPayloadSchema } from './normalize.ts';
import { createDemo } from './demo.ts';
import type { OfficeDb } from './db.ts';
import type { Ingest } from './ingest.ts';

declare module 'fastify' {
  interface FastifyInstance {
    office: { db: OfficeDb; ingest: Ingest; demo: ReturnType<typeof createDemo> };
  }
}

export interface AppOptions {
  dbFile: string;
  logger?: boolean | { level: string };
  reorderWindowMs?: number;
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
  const demo = createDemo(ingest);
  app.decorate('office', { db, ingest, demo });

  app.addHook('onClose', async () => {
    demo.stop();
    ingest.stop();
    db.close();
  });

  app.get('/health', async () => ({ ok: true }));

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
