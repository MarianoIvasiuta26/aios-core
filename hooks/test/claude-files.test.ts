import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENTS, BOSS_ID } from '../../packages/shared/src/index.ts';

const root = fileURLToPath(new URL('../../claude/', import.meta.url));
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

function frontmatter(path: string): { data: Record<string, string>; body: string; raw: string } {
  const text = readFileSync(path, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${path} sin frontmatter`);
  const data: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]!] = kv[2]!;
  }
  return { data, body: m[2]!, raw: m[1]! };
}

describe('subagentes', () => {
  const files = readdirSync(`${root}agents`).filter((f) => f.endsWith('.md'));

  it('hay uno por cada agente del registro (salvo el jefe), con el mismo nombre', () => {
    expect(files.map((f) => f.replace(/\.md$/, '')).sort()).toEqual(AGENTS.filter((a) => a.id !== BOSS_ID).map((a) => a.id).sort());
  });

  it.each(files)('%s tiene frontmatter válido', (file) => {
    const { data, body, raw } = frontmatter(`${root}agents/${file}`);
    expect(data.name).toBe(file.replace(/\.md$/, ''));
    expect(data.description!.length).toBeGreaterThan(40);
    expect(data.tools).toBeTruthy();
    expect(data.disallowedTools).toBe('Agent');
    expect(COLORS).toContain(data.color);
    expect(body).toContain(`\`${data.name}\``);
    // Los que no escriben código no tienen Edit/Write.
    if (['arquitecto', 'reviewer'].includes(data.name!)) expect(data.tools).not.toMatch(/Edit|Write/);
    // Los equipos con reglas obligatorias llevan su guardia.
    if (data.name!.startsWith('sec-')) expect(raw).toContain('office-guard seguridad');
    if (['analista-mercado', 'gerente-ventas', 'prospector'].includes(data.name!)) {
      expect(raw).toContain('office-guard comercial');
      expect(body).toContain('Nunca enviás mensajes');
    }
  });
});

describe('comandos', () => {
  const files = readdirSync(`${root}commands`).filter((f) => f.endsWith('.md'));

  it('están los seis del flujo', () => {
    expect(files.sort()).toEqual(['auditoria.md', 'feature.md', 'mercado.md', 'pipeline.md', 'prospectar.md', 'remediar.md']);
  });

  it.each(files)('%s solo lo lanza el usuario y usa [T-n]', (file) => {
    const { data, body } = frontmatter(`${root}commands/${file}`);
    expect(data.description).toBeTruthy();
    expect(data['disable-model-invocation']).toBe('true');
    expect(body).toMatch(/\[T-n\]/);
    expect(body).not.toMatch(/\$\{ARGUMENTS/);
  });
});
