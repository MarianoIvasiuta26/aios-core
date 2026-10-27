import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp, type OfficeApp } from '../../server/src/app.ts';

const BIN = fileURLToPath(new URL('../bin/office-task', import.meta.url));
let app: OfficeApp;
let api: string;

beforeAll(async () => {
  app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 0 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('sin puerto');
  api = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => app.close());

/** Async a propósito: spawnSync bloquearía el event loop del server que corre en este mismo proceso. */
const exec = (args: string[], url: string) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(BIN, args, { env: { ...process.env, AGENT_OFFICE_API: url } }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout.trim(), err: stderr.trim() });
    });
  });
const run = (...args: string[]) => exec(args, api);

describe('office-task', () => {
  it('create, move, assign, comment, list y show', async () => {
    expect((await run('create', 'Login con Google', '--assign', 'backend', '--prio', 'p1', '--labels', 'auth,go', '--as', 'product-owner')).out).toMatch(/^Creada T-1 +P1 Backlog/);
    expect((await run('move', 'T-1', 'doing', '--as', 'backend')).out).toMatch(/En curso/);
    expect((await run('assign', 't1', 'qa-unit', '--as', 'product-owner')).out).toMatch(/@qa-unit/);
    expect((await run('comment', 'T-1', 'listo para QA', '--as', 'backend')).code).toBe(0);
    expect((await run('list', '--column', 'en-curso')).out).toContain('T-1');
    const show = JSON.parse((await run('show', 'T-1', '--json')).out) as { history: Array<{ actor: string; action: string }> };
    expect(show.history.map((h) => `${h.actor}:${h.action}`)).toEqual([
      'product-owner:created',
      'backend:moved',
      'product-owner:assigned',
      'backend:commented',
    ]);
  }, 30_000);

  it('errores claros y exit 1', async () => {
    const bad = await run('move', 'T-1', 'cualquiera');
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/columna inválida/);
    expect((await run('move', 'T-99', 'hecha')).err).toMatch(/no existe la tarea T-99/);
    const down = await exec(['list'], 'http://127.0.0.1:9');
    expect(down.code).toBe(1);
    expect(down.err).toMatch(/no pude conectar/);
  }, 30_000);
});
