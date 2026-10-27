import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage, Task, TaskHistoryEntry } from '@office/shared';
import { buildApp, type OfficeApp } from '../src/app.ts';

let app: OfficeApp;

beforeEach(async () => {
  app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 0 });
});
afterEach(async () => {
  await app.close();
});

async function create(body: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/tasks', payload: body });
  expect(res.statusCode).toBe(201);
  return res.json<Task>();
}
const patch = (id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: 'PATCH', url: `/tasks/${id}`, payload: body, headers });
const history = async (id: string) => (await app.inject({ url: `/tasks/${id}` })).json<{ history: TaskHistoryEntry[] }>().history;
const hook = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/events', payload: { session_id: 's1', cwd: '/r', ...payload } });

describe('API de tareas', () => {
  it('crea con defaults y deriva el equipo del asignado', async () => {
    const t = await create({ title: 'Implementar login', assignee: 'backend', priority: 'p1', labels: ['auth'] });
    expect(t).toMatchObject({ id: 'T-1', column: 'backlog', team: 'ingenieria', priority: 'P1', labels: ['auth'] });
    expect((await history('T-1'))[0]).toMatchObject({ action: 'created', actor: 'usuario' });
  });

  it('valida el input', async () => {
    expect((await app.inject({ method: 'POST', url: '/tasks', payload: { title: '  ' } })).statusCode).toBe(400);
    await create({ title: 'x' });
    expect((await patch('T-1', { column: 'cualquiera' })).statusCode).toBe(400);
    expect((await patch('T-99', { column: 'hecha' })).statusCode).toBe(404);
  });

  it('mover registra historial, fechas y acepta alias de columnas', async () => {
    await create({ title: 'x' });
    const r1 = await patch('T-1', { column: 'En curso', actor: 'backend' });
    expect(r1.json<Task>()).toMatchObject({ column: 'en-curso' });
    expect(r1.json<Task>().startedAt).not.toBeNull();
    const done = (await patch('T-1', { column: 'done', actor: 'reviewer' })).json<Task>();
    expect(done.closedAt).not.toBeNull();
    const reopened = (await patch('T-1', { column: 'review' })).json<Task>();
    expect(reopened).toMatchObject({ column: 'en-revision', closedAt: null });
    const moves = (await history('T-1')).filter((h) => h.action === 'moved');
    expect(moves.map((m) => [m.actor, m.from, m.to])).toEqual([
      ['backend', 'backlog', 'en-curso'],
      ['reviewer', 'en-curso', 'hecha'],
      ['usuario', 'hecha', 'en-revision'],
    ]);
  });

  it('filtra por columna, equipo y asignado', async () => {
    await create({ title: 'a', assignee: 'backend', column: 'en-curso' });
    await create({ title: 'b', assignee: 'qa-unit' });
    expect((await app.inject({ url: '/tasks?team=qa' })).json<Task[]>().map((t) => t.title)).toEqual(['b']);
    expect((await app.inject({ url: '/tasks?column=en-curso' })).json<Task[]>().map((t) => t.title)).toEqual(['a']);
    expect((await app.inject({ url: '/tasks?assignee=backend' })).json<Task[]>()).toHaveLength(1);
  });

  it('comentarios y redacción de secretos', async () => {
    await create({ title: 'x', description: 'usar API_KEY=abcd1234efgh5678' });
    const r = await app.inject({ method: 'POST', url: '/tasks/T-1/comments', payload: { text: 'listo', actor: 'docs' } });
    expect(r.statusCode).toBe(201);
    const { task } = (await app.inject({ url: '/tasks/T-1' })).json<{ task: Task }>();
    expect(task.description).not.toContain('abcd1234efgh5678');
    expect((await history('T-1')).at(-1)).toMatchObject({ action: 'commented', actor: 'docs', detail: 'listo' });
  });

  it('difunde los cambios por WebSocket', async () => {
    const sent: ServerMessage[] = [];
    await create({ title: 'x' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('sin puerto');
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
    ws.on('message', (d) => sent.push(JSON.parse(String(d)) as ServerMessage));
    await new Promise((r) => ws.once('open', r));
    await patch('T-1', { column: 'en-curso', actor: 'backend' });
    await expect.poll(() => sent.find((m) => m.type === 'task_moved')).toMatchObject({ taskId: 'T-1', from: 'backlog', to: 'en-curso', by: 'backend' });
    expect(sent.find((m) => m.type === 'task_upsert')).toBeTruthy();
    ws.close();
  });
});

describe('automatizaciones', () => {
  it('al arrancar un subagente con [T-n] en el prompt, la tarjeta se asigna y pasa a En curso', async () => {
    await create({ title: 'impl', column: 'por-hacer' });
    await hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'u1', tool_input: { subagent_type: 'backend', description: 'Implementar', prompt: '[T-1] hacelo' } });
    await hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'backend' });
    const { task } = (await app.inject({ url: '/tasks/T-1' })).json<{ task: Task }>();
    expect(task).toMatchObject({ column: 'en-curso', assignee: 'backend', team: 'ingenieria' });
    expect(app.office.db.getRun('a1')?.taskId).toBe('T-1');
  });

  it('un test fallido del subagente bloquea su tarjeta; otros errores no', async () => {
    await create({ title: 'tests', assignee: 'qa-unit', column: 'por-hacer' });
    await hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'u1', tool_input: { subagent_type: 'qa-unit', prompt: '[T-1]' } });
    await hook({ hook_event_name: 'SubagentStart', agent_id: 'q1', agent_type: 'qa-unit' });
    await hook({ hook_event_name: 'PostToolUseFailure', agent_id: 'q1', agent_type: 'qa-unit', tool_name: 'Bash', tool_input: { command: 'ls nope' }, error: 'Exit code 2' });
    expect(app.office.tasks.get('T-1').column).toBe('en-curso');
    await hook({ hook_event_name: 'PostToolUseFailure', agent_id: 'q1', agent_type: 'qa-unit', tool_name: 'Bash', tool_input: { command: 'go test -race ./...' }, error: 'Exit code 1\nFAIL' });
    expect(app.office.tasks.get('T-1').column).toBe('bloqueada');
    expect((await history('T-1')).at(-1)).toMatchObject({ actor: 'qa-unit', to: 'bloqueada' });
  });

  it('atribuye al agente un move de la CLI sin --as', async () => {
    await create({ title: 'x' });
    await patch('T-1', { column: 'hecha' }, { 'x-office-client': 'cli' });
    expect((await history('T-1')).at(-1)).toMatchObject({ actor: 'cli' });
    await hook({ hook_event_name: 'PostToolUse', agent_id: 'd1', agent_type: 'docs', tool_name: 'Bash', tool_input: { command: 'office-task move T-1 hecha' } });
    expect((await history('T-1')).at(-1)).toMatchObject({ actor: 'docs', to: 'hecha' });
  });
});
