import { describe, expect, it } from 'vitest';
import {
  parseBacklog,
  parseCsv,
  parseDraft,
  parseFindings,
  parseLeads,
  parseOpportunities,
  parsePipeline,
  parseQaReport,
  posture,
} from '../src/workspace.ts';

describe('backlog', () => {
  it('lee épicas e historias con prioridad, columna y tarjeta', () => {
    const md = `# Backlog

## EP-1 · Login social
Objetivo.

### HU-12 · Login con Google · P1 · por-hacer · T-23
Como usuario...

### HU-13 · Logout · P3 · Hecha · -

## EP-2 · Reportes
### HU-20 · Exportar CSV · P2 · en curso
`;
    const epics = parseBacklog(md);
    expect(epics.map((e) => [e.id, e.title, e.stories.length])).toEqual([
      ['EP-1', 'Login social', 2],
      ['EP-2', 'Reportes', 1],
    ]);
    expect(epics[0]!.stories[0]).toEqual({
      id: 'HU-12',
      title: 'Login con Google',
      priority: 'P1',
      column: 'por-hacer',
      task: 'T-23',
      epic: 'EP-1',
    });
    expect(epics[0]!.stories[1]).toMatchObject({ column: 'hecha', task: null });
    expect(epics[1]!.stories[0]).toMatchObject({ column: 'en-curso', priority: 'P2' });
  });
});

describe('reporte de QA', () => {
  it('lee el encabezado', () => {
    const md = '# Reporte de QA — 2026-10-27\nResultado: rojo\nTests: 42 pasan · 1 falla · 0 omitidos · cobertura 78%\n';
    expect(parseQaReport(md, 'REPORTE-2026-10-27.md')).toEqual({
      file: 'REPORTE-2026-10-27.md',
      date: '2026-10-27',
      result: 'rojo',
      passed: 42,
      failed: 1,
      skipped: 0,
      coverage: 78,
    });
  });
  it('sin la línea de resultado lo deduce de las fallas', () => {
    expect(parseQaReport('Tests: 10 pasan · 0 fallan', 'x.md').result).toBe('verde');
    expect(parseQaReport('nada', 'x.md').result).toBeNull();
  });
});

describe('hallazgos', () => {
  const json = JSON.stringify({
    actualizado: '2026-10-27',
    hallazgos: [
      {
        id: 'SEC-07',
        titulo: 'Bucket público',
        severidad: 'Critica',
        estado: 'abierto',
        auditor: 'sec-cloud',
        tarjeta: 't-31',
        evidencia: 'infra/s3.tf:14',
      },
      { id: 'SEC-08', titulo: 'Header faltante', severidad: 'media', estado: 'Resuelto' },
      { id: 'SEC-09', titulo: 'Dep vulnerable', severidad: 'Alta', estado: 'en curso' },
      { titulo: 'sin id' },
    ],
  });
  it('normaliza severidad, estado y tarjeta', () => {
    const f = parseFindings(json);
    expect(f.findings.map((x) => [x.id, x.severity, x.state, x.task])).toEqual([
      ['SEC-07', 'Crítica', 'abierto', 'T-31'],
      ['SEC-08', 'Media', 'resuelto', null],
      ['SEC-09', 'Alta', 'en curso', null],
    ]);
  });
  it('postura: la de compliance o calculada con los abiertos', () => {
    expect(posture(parseFindings(json))).toBe(100 - 25 - 10);
    expect(posture(parseFindings(JSON.stringify({ postura: 64, hallazgos: [] })))).toBe(64);
    expect(posture(parseFindings('[]'))).toBe(100);
  });
  it('JSON inválido tira error (lo maneja el watcher)', () => {
    expect(() => parseFindings('{')).toThrow();
  });
});

describe('comercial', () => {
  it('oportunidades', () => {
    const ops = parseOpportunities(
      JSON.stringify([
        { id: 'OP-4', oportunidad: 'Pagos', puntaje: 8, tipo_dato: 'verificado', fuente: 'https://x' },
        { oportunidad: 'Otra', puntaje: 'n/a' },
      ]),
    );
    expect(ops.map((o) => [o.id, o.score, o.verified])).toEqual([
      ['OP-4', 8, true],
      ['OP-2', null, false],
    ]);
  });
  it('CSV con comillas, comas y saltos', () => {
    expect(parseCsv('a,b\n"x, y","dijo ""hola""\nchau"\r\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'dijo "hola"\nchau'],
    ]);
  });
  it('leads', () => {
    const leads = parseLeads(
      'empresa,rubro,tamano,sitio_web,por_que_encaja,fuente,fecha_consulta,estado\nAcme SA,Fintech,20-50,https://acme,"Pagos, Go",https://src,2026-10-27,investigado\nBeta,,,,,,,raro\n,,,,,,,nuevo\n',
    );
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ company: 'Acme SA', fit: 'Pagos, Go', status: 'investigado' });
    expect(leads[1]!.status).toBe('nuevo');
  });
  it('pipeline', () => {
    const p = parsePipeline(
      '# Pipeline\n## Lead\n- **Acme SA** — próximo paso: investigar — 2026-10-30\n- Beta\n## Contactado\n## Reunion\n- Gamma — martes\n## Ganado\n',
    );
    expect(p.Lead).toEqual([
      { company: 'Acme SA', detail: 'próximo paso: investigar — 2026-10-30' },
      { company: 'Beta', detail: null },
    ]);
    expect(p['Reunión']).toHaveLength(1);
    expect(p.Ganado).toHaveLength(0);
  });
  it('borradores', () => {
    expect(parseDraft('---\nempresa: Acme SA\nestado: Aprobado\n---\nHola', 'acme.md')).toEqual({
      file: 'acme.md',
      company: 'Acme SA',
      status: 'aprobado',
    });
    expect(parseDraft('sin frontmatter', 'beta.md')).toEqual({ file: 'beta.md', company: 'beta', status: 'borrador' });
  });
});
