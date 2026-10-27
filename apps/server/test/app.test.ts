import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { ServerMessage } from '@office/shared';
import { buildApp, type OfficeApp } from '../src/app.ts';

const EMIT = fileURLToPath(new URL('../../../hooks/emit.sh', import.meta.url));
let app: OfficeApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function start() {
  app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 0 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('sin puerto');
  return addr.port;
}

describe('server', () => {
  it('rechaza payloads inválidos', async () => {
    app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 0 });
    const res = await app.inject({ method: 'POST', url: '/events', payload: { foo: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('emit.sh → POST /events → WebSocket, y queda en la historia', async () => {
    const port = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: ServerMessage[] = [];
    ws.on('message', (d) => messages.push(JSON.parse(String(d)) as ServerMessage));
    await new Promise((r) => ws.once('open', r));

    const payload = { session_id: 's1', cwd: '/r', hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'devops', tool_name: 'Bash', tool_input: { command: 'terraform plan' }, tool_use_id: 't1' };
    const r = spawnSync(EMIT, { input: JSON.stringify(payload), env: { ...process.env, AGENT_OFFICE_URL: `http://127.0.0.1:${port}/events` } });
    expect(r.status).toBe(0);
    expect(r.stdout.toString()).toBe('');

    await expect.poll(() => messages.find((m) => m.type === 'event')).toBeTruthy();
    const ev = messages.find((m) => m.type === 'event');
    expect(ev).toMatchObject({ type: 'event', event: { agentName: 'devops', summary: 'Corriendo: terraform plan' } });

    const hist = await (await fetch(`http://127.0.0.1:${port}/agents/a1/history`)).json();
    expect(hist).toHaveLength(1);
    const state = await (await fetch(`http://127.0.0.1:${port}/sessions/s1/state`)).json();
    expect(state.runs[0]).toMatchObject({ agentName: 'devops', toolCalls: 1 });
    ws.close();
  });

  it('calcula la duración emparejando Pre/Post por tool_use_id', async () => {
    app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 0 });
    const common = { session_id: 's', tool_name: 'Read', tool_input: { file_path: 'a' }, tool_use_id: 'x' };
    await app.inject({ method: 'POST', url: '/events', headers: { 'x-emit-ts': String(Date.now() - 500) }, payload: { ...common, hook_event_name: 'PreToolUse' } });
    await app.inject({ method: 'POST', url: '/events', headers: { 'x-emit-ts': String(Date.now()) }, payload: { ...common, hook_event_name: 'PostToolUse' } });
    const events = app.office.db.sessionEvents('s');
    expect(events[1]?.durationMs).toBeGreaterThanOrEqual(450);
  });

  it('reordena eventos async que llegan desordenados', async () => {
    app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 50 });
    const now = Date.now();
    await app.inject({ method: 'POST', url: '/events', headers: { 'x-emit-ts': String(now) }, payload: { session_id: 's', hook_event_name: 'Stop' } });
    await app.inject({ method: 'POST', url: '/events', headers: { 'x-emit-ts': String(now - 100) }, payload: { session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: 'hola' } });
    await new Promise((r) => setTimeout(r, 150));
    expect(app.office.db.sessionEvents('s').map((e) => e.kind)).toEqual(['prompt', 'stop']);
  });

  it('nunca guarda secretos en el raw', async () => {
    app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 0 });
    await app.inject({ method: 'POST', url: '/events', payload: { session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789' } } });
    const raw = app.office.db.raw.prepare('SELECT raw, summary FROM events').get() as { raw: string; summary: string };
    expect(raw.raw + raw.summary).not.toContain('ghp_abcdefghijklmnop');
  });
});

describe('emit.sh con el server caído', () => {
  it('sale con 0, sin output y en menos de 1.5 s', () => {
    const t0 = Date.now();
    const r = spawnSync(EMIT, { input: '{"session_id":"x"}', env: { ...process.env, AGENT_OFFICE_URL: 'http://127.0.0.1:9/events' } });
    expect(r.status).toBe(0);
    expect(r.stdout.length + r.stderr.length).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
