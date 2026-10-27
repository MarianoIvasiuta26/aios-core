import { describe, expect, it } from 'vitest';
import { mask, redact, redactDeep } from '../src/redact.ts';

describe('redact', () => {
  it.each([
    ['AWS access key', 'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['GitHub token', 'git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['GitLab token', 'export GITLAB=glpat-AbCdEfGhIjKlMnOpQrSt12', 'glpat-AbCdEfGhIjKlMnOpQrSt12'],
    ['Anthropic key', 'ANTHROPIC=sk-ant-api03-abcdefghijklmnop1234', 'sk-ant-api03-abcdefghijklmnop1234'],
    ['Bearer', "curl -H 'Authorization: Bearer abc123def456ghi789'", 'abc123def456ghi789'],
    ['env password', 'DB_PASSWORD=hunter2hunter2 php artisan migrate', 'hunter2hunter2'],
    ['flag token', 'mytool --api-key=s3cr3tv4lue run', 's3cr3tv4lue'],
    ['url credentials', 'psql postgres://admin:SuperSecreta99@db:5432/app', 'SuperSecreta99'],
    ['json secret', '{"client_secret": "zzTopSecretValue1"}', 'zzTopSecretValue1'],
    ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'eyJhbGciOiJIUzI1NiJ9'],
    ['high entropy', 'export X=Zk3Pq9Lm2Vx8Rt5Wn1Bc7Hy4Jd6Fs0Ga', 'Zk3Pq9Lm2Vx8Rt5Wn1Bc7Hy4Jd6Fs0Ga'],
  ])('enmascara %s', (_name, input, secret) => {
    const out = redact(input);
    expect(out).not.toContain(secret);
    expect(out).toContain('••••');
  });

  it('deja visible el esquema de Authorization', () => {
    expect(redact("-H 'Authorization: Bearer abc123def456ghi789'")).toBe("-H 'Authorization: Bearer ••••i789'");
  });

  it('conserva los últimos 4 caracteres', () => {
    expect(redact('DB_PASSWORD=hunter2hunter2')).toBe('DB_PASSWORD=••••ter2');
    expect(mask('abc')).toBe('••••');
  });

  it.each([
    'go test -race ./internal/auth/...',
    'Leyendo internal/api/users.go',
    'terraform plan -out tfplan',
    'git log 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39',
    'apps/web/src/components/office/AgentSpriteFactory.ts',
    'pnpm --filter @office/server add fastify',
    'max_tokens=4096',
    '/tmp/agent-office-demo/docs/security/INFORME-EJECUTIVO-2026-10-27.md',
  ])('no toca texto normal: %s', (input) => {
    expect(redact(input)).toBe(input);
  });

  it('redacta objetos anidados y claves sensibles', () => {
    const out = redactDeep({ tool_input: { command: 'export TOKEN=abcdefgh1234', env: { password: 'x1y2z3w4' } } });
    expect(JSON.stringify(out)).not.toContain('abcdefgh1234');
    expect(JSON.stringify(out)).not.toContain('x1y2z3w4');
  });
});
