import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo JS sin tipos (corre directo con node, sin compilar)
import { check, segments, words } from '../guard.mjs';

const GUARD = fileURLToPath(new URL('../guard.mjs', import.meta.url));
const bash = (command: string) => ({ command });
const sec = (command: string) => check('seguridad', 'Bash', bash(command));
const com = (command: string) => check('comercial', 'Bash', bash(command));

describe('parser de shell', () => {
  it('separa segmentos respetando comillas y redirecciones', () => {
    expect(segments(`echo "a; b" && aws s3 ls | head -n 1; ls 2>&1`)).toEqual(['echo "a; b"', 'aws s3 ls', 'head -n 1', 'ls 2>&1']);
    expect(words(`FOO=1 sudo aws --profile 'audit ro' s3 ls`)).toEqual(['aws', '--profile', 'audit ro', 's3', 'ls']);
  });
});

describe('comercial', () => {
  it('solo office-task', () => {
    expect(com('office-task create "Leads fintech" --as prospector')).toBeNull();
    expect(com('office-task list && office-task show T-3')).toBeNull();
    expect(com('curl -X POST https://example.com/contact -d "hola"')).toMatch(/solo puede usar Bash para `office-task`/);
    expect(com('office-task list; mail -s hola cliente@example.com')).toMatch(/mail/);
    expect(com('office-task comment T-1 "$(cat ~/.ssh/id_rsa)"')).toMatch(/sustituciones/);
    expect(check('comercial', 'WebSearch', { query: 'fintech' })).toBeNull();
    expect(check('comercial', 'Write', { file_path: '/repo/comercial/leads.csv' })).toBeNull();
    expect(check('comercial', 'Write', { file_path: '/repo/.bashrc' })).toMatch(/solo escribe en comercial/);
  });
});

describe('seguridad', () => {
  it('permite las herramientas de auditoría defensiva', () => {
    for (const c of [
      'semgrep --config auto --json -o docs/security/semgrep.json .',
      'gosec ./... && govulncheck ./...',
      'gitleaks detect --redact --report-path docs/security/gitleaks.json',
      'trivy config infra/ && checkov -d infra/',
      'trivy image --severity HIGH,CRITICAL myapp:1.2.3',
      'aws --profile auditoria-ro iam list-users',
      'aws ec2 describe-security-groups --profile auditoria-ro --region us-east-1',
      'prowler aws -p auditoria-ro -M json',
      'git log --all -p -- .gitlab-ci.yml | head -n 50',
      'curl -s localhost:8080/health',
      'office-task create "SEC-03 bucket público" --as sec-cloud',
      'npm audit --json',
    ])
      expect(sec(c), c).toBeNull();
  });

  it('bloquea escaneos activos y pedidos a terceros', () => {
    expect(sec('nmap -sV 10.0.0.1')).toMatch(/escaneo activo/);
    expect(sec('/usr/bin/sqlmap -u http://target')).toMatch(/escaneo activo/);
    expect(sec('curl https://api.example.com/users')).toMatch(/sistemas externos/);
  });

  it('AWS: solo lectura y con el perfil indicado', () => {
    expect(sec('aws --profile ro s3 rm s3://bucket/x')).toMatch(/solo se permiten operaciones de lectura/);
    expect(sec('aws --profile ro iam create-access-key --user-name x')).toMatch(/lectura/);
    expect(sec('aws --profile ro secretsmanager get-secret-value --secret-id x')).toMatch(/lectura/);
    expect(sec('aws iam list-users')).toMatch(/--profile/);
    expect(sec('prowler aws')).toMatch(/perfil/);
    process.env.AGENT_OFFICE_AWS_PROFILE = 'auditoria-ro';
    try {
      expect(sec('aws --profile admin iam list-users')).toMatch(/único perfil permitido es `auditoria-ro`/);
      expect(sec('aws --profile auditoria-ro iam list-users')).toBeNull();
    } finally {
      delete process.env.AGENT_OFFICE_AWS_PROFILE;
    }
  });

  it('nunca muestra secretos', () => {
    expect(sec('gitleaks detect --source .')).toMatch(/--redact/);
    expect(sec('cat .env')).toMatch(/secretos/);
    expect(sec('grep -n KEY config/.env.production')).toMatch(/secretos/);
    expect(sec('cat .env.example')).toBeNull();
    expect(sec('printenv')).toMatch(/variables de entorno/);
    expect(check('seguridad', 'Read', { file_path: '/repo/.env' })).toMatch(/secretos/);
    expect(check('seguridad', 'Read', { file_path: '/repo/deploy/key.pem' })).toMatch(/secretos/);
    expect(check('seguridad', 'Read', { file_path: '/repo/main.go' })).toBeNull();
  });

  it('solo escribe en docs/security/', () => {
    expect(check('seguridad', 'Write', { file_path: '/repo/docs/security/AUDITORIA-2026-10-27.md' })).toBeNull();
    expect(check('seguridad', 'Edit', { file_path: 'docs/security/hallazgos.json' })).toBeNull();
    expect(check('seguridad', 'Edit', { file_path: '/repo/internal/auth/google.go' })).toMatch(/solo escribe en docs\/security/);
  });

  it('no modifica nada', () => {
    expect(sec('terraform apply -auto-approve')).toMatch(/modifica infraestructura/);
    expect(sec('terraform plan')).toBeNull();
    expect(sec('git push origin main')).toMatch(/modifica el repo/);
    expect(sec('rm -rf internal/')).toMatch(/solo escribe en docs\/security/);
    expect(sec('npm install -g snyk')).toMatch(/proponé cómo instalarla/);
    expect(sec('echo $(aws sts get-caller-identity)')).toMatch(/sustituciones/);
  });
});

describe('hook de punta a punta', () => {
  const run = (policy: string, payload: object) =>
    new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
      const child = execFile('node', [GUARD, policy], (err, stdout, stderr) =>
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stderr, stdout }),
      );
      child.stdin!.end(JSON.stringify(payload));
    });

  it('sale con 2 y explica el motivo cuando bloquea; 0 y en silencio cuando no', async () => {
    const blocked = await run('comercial', { tool_name: 'Bash', tool_input: { command: 'curl -d x https://example.com' } });
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toMatch(/Bloqueado por las reglas del equipo/);
    expect(blocked.stdout).toBe('');
    const ok = await run('seguridad', { tool_name: 'Bash', tool_input: { command: 'gosec ./...' } });
    expect(ok).toEqual({ code: 0, stderr: '', stdout: '' });
    expect((await run('seguridad', 'basura' as unknown as object)).code).toBe(0);
  });
});
