import { describe, expect, it } from 'vitest';
import { normalize, type HookPayload } from '../src/normalize.ts';

const base = { session_id: 's1', cwd: '/repo' };
const n = (p: Partial<HookPayload> & { hook_event_name: string }) => normalize({ ...base, ...p } as HookPayload, 1000);

describe('normalize', () => {
  it('sin agent_type es el jefe', () => {
    const e = n({ hook_event_name: 'UserPromptSubmit', prompt: '/feature login' });
    expect(e).toMatchObject({ agentName: 'jefe', agentId: 's1', team: 'direccion', kind: 'prompt', summary: 'Pedido: /feature login' });
  });

  it('identifica al subagente por agent_type y usa rutas relativas', () => {
    const e = n({
      hook_event_name: 'PreToolUse',
      agent_id: 'a1',
      agent_type: 'backend',
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/internal/api/users.go' },
      tool_use_id: 't1',
    });
    expect(e).toMatchObject({ agentName: 'backend', agentId: 'a1', team: 'ingenieria', kind: 'tool_start', status: 'running' });
    expect(e.summary).toBe('Editando internal/api/users.go');
  });

  it('subagentes desconocidos son visitantes', () => {
    const e = n({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Explore' });
    expect(e).toMatchObject({ agentName: 'visitante', agentType: 'Explore', kind: 'agent_start' });
  });

  it('Bash: resume el comando y enmascara secretos', () => {
    const e = n({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'AWS_SECRET_ACCESS_KEY=abcd1234efgh5678 terraform plan' } });
    expect(e.summary).toMatch(/^Corriendo: AWS_SECRET_ACCESS_KEY=••••5678 terraform plan$/);
  });

  it('detecta movimientos del tablero', () => {
    for (const command of ['office-task move T-12 en-curso --as backend', 'pnpm task move T-12 en-curso', 'cd x && pnpm -C ~/aios task move T-12 en-curso']) {
      const e = n({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
      expect(e.kind).toBe('task_move');
      expect(e.summary).toBe('Moviendo T-12 → en-curso');
    }
  });

  it('errores de herramientas', () => {
    const e = n({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'go test ./...' }, error: 'Exit code 1\nFAIL' });
    expect(e).toMatchObject({ kind: 'tool_error', status: 'error', summary: 'Error en Bash: Exit code 1' });
  });

  it('notificaciones de permiso → esperando', () => {
    const e = n({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    expect(e).toMatchObject({ kind: 'waiting', status: 'waiting' });
  });

  it.each([
    ['WebSearch', { query: 'fintech argentina' }, 'Buscando en la web: fintech argentina'],
    ['WebFetch', { url: 'https://example.com/a/b' }, 'Leyendo web: example.com'],
    ['Agent', { subagent_type: 'qa-unit', description: 'tests' }, 'Delegando a qa-unit: tests'],
    ['Glob', { pattern: '**/*.go' }, 'Buscando archivos **/*.go'],
    ['mcp__github__create_issue', {}, 'MCP github: create_issue'],
  ])('describe %s', (tool_name, tool_input, summary) => {
    expect(n({ hook_event_name: 'PreToolUse', tool_name, tool_input }).summary).toBe(summary);
  });
});
