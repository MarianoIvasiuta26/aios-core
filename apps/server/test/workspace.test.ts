import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage, WorkspaceState } from '@office/shared';
import { buildApp, type OfficeApp } from '../src/app.ts';
import { readWorkspace, resolveRoot } from '../src/workspace.ts';

let root: string;
let app: OfficeApp | null = null;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'office-ws-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'docs/security'), { recursive: true });
  mkdirSync(join(root, 'services/api'), { recursive: true });
});

afterEach(async () => {
  await app?.close();
  app = null;
  rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const findings = (estado: string, extra: object = {}) =>
  JSON.stringify({ hallazgos: [{ id: 'SEC-07', titulo: 'Bucket público', severidad: 'Crítica', estado, auditor: 'sec-cloud', ...extra }] });

async function session(cwd: string) {
  await app!.inject({
    method: 'POST',
    url: '/events',
    payload: { session_id: 's1', cwd, hook_event_name: 'SessionStart', source: 'startup' },
  });
  await new Promise((r) => setTimeout(r, 20));
}

describe('workspace', () => {
  it('la raíz es la del repo git aunque la sesión esté en una subcarpeta (o la fija por variable)', () => {
    expect(resolveRoot(join(root, 'services/api'), undefined)).toBe(root);
    expect(resolveRoot('/x', '/fijo')).toBe('/fijo');
    expect(resolveRoot(null, undefined)).toBeNull();
  });

  it('lee todo, marca los archivos rotos y nunca expone secretos', () => {
    write('docs/BACKLOG.md', '## EP-1 · Login\n### HU-1 · Entrar · P1 · en-curso · T-1\n');
    write('docs/qa/REPORTE-2026-10-26.md', 'Resultado: verde\n');
    write('docs/qa/REPORTE-2026-10-27.md', 'Resultado: rojo\nTests: 3 pasan · 1 falla\n');
    write('docs/security/hallazgos.json', '{ roto');
    write('comercial/leads.csv', 'empresa,estado\nAcme,nuevo\n');
    write(
      'comercial/borradores/acme.md',
      '---\nempresa: Acme\nestado: aprobado\n---\nToken ghp_aB3dE6gH9jK2mN5pQ8rS1tU4vW7xY0zA1bC2 por error\n',
    );
    write('comercial/pipeline.md', '## Lead\n- Acme — ver password=SuperSecreta123 — 2026-11-01\n');
    const ws = readWorkspace(root, 1);
    expect(ws.backlog?.[0]?.stories[0]).toMatchObject({ id: 'HU-1', column: 'en-curso' });
    expect(ws.qa).toMatchObject({ file: 'REPORTE-2026-10-27.md', result: 'rojo', failed: 1 });
    expect(ws.findings).toBeNull();
    expect(ws.errors).toEqual(['docs/security/hallazgos.json: formato inválido']);
    expect(ws.leads).toHaveLength(1);
    expect(ws.drafts).toEqual([{ file: 'acme.md', company: 'Acme', status: 'aprobado' }]);
    expect(JSON.stringify(ws)).not.toContain('SuperSecreta123');
    expect(ws.opportunities).toBeNull();
  });

  it('GET /workspace por sesión, cambios por WebSocket y un Crítico bloquea su tarjeta una sola vez', async () => {
    app = await buildApp({ dbFile: ':memory:', reorderWindowMs: 0, workspacePollMs: 30 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const updates: WorkspaceState[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      if (m.type === 'workspace') updates.push(m.workspace);
    });
    await new Promise((r) => ws.once('open', r));
    await session(join(root, 'services/api'));

    expect((await app.inject({ url: '/workspace?session=nope' })).statusCode).toBe(404);
    const first = (await app.inject({ url: '/workspace?session=s1' })).json() as { workspace: WorkspaceState };
    expect(first.workspace).toMatchObject({ root, findings: null });

    const { tasks } = app.office;
    const card = tasks.create({ title: 'Arreglar bucket', related: 'SEC-07', column: 'en-curso' }).task;

    // Aparece el Crítico → la tarjeta relacionada pasa a Bloqueada.
    write('docs/security/hallazgos.json', findings('abierto'));
    await expect.poll(() => updates.at(-1)?.findings?.findings.length, { timeout: 2000 }).toBe(1);
    await expect.poll(() => tasks.get(card.id).column).toBe('bloqueada');
    expect(tasks.history(card.id).at(-1)).toMatchObject({ actor: 'sec-cloud', detail: 'Hallazgo crítico SEC-07: Bucket público' });

    // El usuario la desbloquea para trabajar: un cambio en el archivo no la vuelve a bloquear.
    tasks.update(card.id, { column: 'en-curso' });
    write('docs/security/hallazgos.json', findings('en curso'));
    await expect.poll(() => updates.at(-1)?.findings?.findings[0]?.state, { timeout: 2000 }).toBe('en curso');
    expect(tasks.get(card.id).column).toBe('en-curso');

    // Una tarjeta creada después con el mismo hallazgo también se bloquea.
    const late = tasks.create({ title: 'Rotar credenciales', related: 'SEC-07', column: 'por-hacer' }).task;
    expect(tasks.get(late.id).column).toBe('bloqueada');

    // Resuelto no bloquea nada.
    const other = tasks.create({ title: 'Otro', related: 'SEC-08', column: 'por-hacer' }).task;
    write('docs/security/hallazgos.json', JSON.stringify({ hallazgos: [{ id: 'SEC-08', severidad: 'Crítica', estado: 'resuelto' }] }));
    await expect.poll(() => updates.at(-1)?.findings?.findings[0]?.id, { timeout: 2000 }).toBe('SEC-08');
    expect(tasks.get(other.id).column).toBe('por-hacer');
    ws.close();
  });
});
