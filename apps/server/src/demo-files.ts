import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Archivos del repo ficticio de la demo, con los mismos formatos que escriben los agentes reales
 * (claude/agents/*.md). Se reescriben en cada vuelta para que las zonas de la oficina cambien.
 */
export interface DemoFiles {
  root: string;
  reset(): void;
  write(rel: string, text: string): void;
}

export function createDemoFiles(root: string): DemoFiles {
  const write = (rel: string, text: string) => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  return {
    root,
    write,
    reset() {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(join(root, '.git'), { recursive: true });
      write('docs/BACKLOG.md', backlog(null));
      write('comercial/pipeline.md', pipeline(false));
      write('comercial/leads.csv', leads(0));
    },
  };
}

const TODAY = () => new Date().toISOString().slice(0, 10);

export function backlog(hu12: { column: string; task: string } | null): string {
  const extra = hu12
    ? `\n### HU-12 · Login con Google · P1 · ${hu12.column} · ${hu12.task}\nComo cliente quiero entrar con mi cuenta de Google para no recordar otra contraseña.\n`
    : '';
  return `# Backlog

## EP-1 · Acceso al panel de clientes
### HU-10 · Login con email y contraseña · P1 · hecha · -
### HU-11 · Recuperar contraseña · P2 · hecha · -
${extra}
## EP-2 · Reportes
### HU-20 · Exportar movimientos a CSV · P2 · por-hacer · -
### HU-21 · Filtro por fecha · P3 · backlog · -
### HU-22 · Gráfico mensual · P3 · backlog · -
`;
}

export function qaReport(failed: number): string {
  return `# Reporte de QA — ${TODAY()}
Resultado: ${failed > 0 ? 'rojo' : 'verde'}
Tests: ${failed > 0 ? 41 : 42} pasan · ${failed} falla${failed === 1 ? '' : 'n'} · 0 omitidos · cobertura 81%
`;
}

interface DemoFinding {
  id: string;
  titulo: string;
  severidad: string;
  componente: string;
  auditor: string;
  tarjeta?: string;
}

export function findings(list: DemoFinding[], postura?: number): string {
  return JSON.stringify(
    {
      actualizado: TODAY(),
      ...(postura === undefined ? {} : { postura }),
      hallazgos: list.map((f) => ({
        ...f,
        evidencia: f.componente,
        impacto: 'Ver informe',
        remediacion: 'Ver plan de remediación',
        referencia: 'OWASP / CIS',
        estado: 'abierto',
        herramienta: f.auditor === 'sec-cloud' ? 'prowler' : 'semgrep',
        detectado: TODAY(),
      })),
    },
    null,
    2,
  );
}

export const APPSEC_FINDINGS: DemoFinding[] = [
  {
    id: 'SEC-01',
    titulo: 'Falta validar el parámetro state en el callback OAuth',
    severidad: 'Alta',
    componente: 'internal/auth/google.go:48',
    auditor: 'sec-appsec',
  },
  {
    id: 'SEC-02',
    titulo: 'Cookie de sesión sin SameSite',
    severidad: 'Media',
    componente: 'internal/auth/session.go:22',
    auditor: 'sec-appsec',
  },
];
export const CLOUD_FINDINGS = (task: string): DemoFinding[] => [
  {
    id: 'SEC-03',
    titulo: 'Bucket S3 de reportes con acceso público',
    severidad: 'Crítica',
    componente: 'infra/terraform/s3.tf:12',
    auditor: 'sec-cloud',
    tarjeta: task,
  },
  {
    id: 'SEC-04',
    titulo: 'CloudTrail sin validación de integridad',
    severidad: 'Media',
    componente: 'infra/terraform/trail.tf:5',
    auditor: 'sec-cloud',
  },
];
export const SUPPLY_FINDINGS: DemoFinding[] = [
  { id: 'SEC-05', titulo: 'Imagen base con CVE de OpenSSL', severidad: 'Alta', componente: 'Dockerfile:1', auditor: 'sec-supply-chain' },
  {
    id: 'SEC-06',
    titulo: 'Job de CI sin pinning de imagen',
    severidad: 'Baja',
    componente: '.gitlab-ci.yml:14',
    auditor: 'sec-supply-chain',
  },
];

export function opportunities(): string {
  const op = (id: string, oportunidad: string, segmento: string, puntaje: number, competencia: string) => ({
    id,
    oportunidad,
    segmento,
    evidencia: 'Informe sectorial y ofertas laborales publicadas',
    fuente: 'https://www.example.org/informe-fintech-2026',
    fecha_consulta: TODAY(),
    tamano_estimado: 'Estimación propia',
    tipo_dato: 'estimación',
    competencia,
    puntaje,
    justificacion: 'Demo',
  });
  return JSON.stringify(
    [
      op('OP-1', 'Backends Go para billeteras virtuales', 'Fintech AR 20–200 empleados', 9, 'media'),
      op('OP-2', 'Auditorías de seguridad AWS para fintech', 'Fintech reguladas por BCRA', 8, 'baja'),
      op('OP-3', 'Migración PHP legado a Laravel 12', 'Comercio electrónico', 6, 'alta'),
      op('OP-4', 'Pipelines GitLab con escaneo de seguridad', 'Software factories', 5, 'alta'),
    ],
    null,
    2,
  );
}

const LEADS = [
  ['Pampa Pagos', 'Fintech', '50-100', 'https://pampapagos.example', 'Equipo Go y cuenta AWS propia'],
  ['Andes Wallet', 'Fintech', '20-50', 'https://andeswallet.example', 'Busca backend Go senior'],
  ['Río Crédito', 'Fintech', '100-200', 'https://riocredito.example', 'Auditoría SOC2 en curso'],
  ['Cuyo Cobros', 'Fintech', '20-50', 'https://cuyocobros.example', 'Stack PHP a migrar'],
  ['Patagonia Pay', 'Fintech', '50-100', 'https://patagoniapay.example', 'Usa GitLab CI'],
];

export function leads(n: number): string {
  const rows = LEADS.slice(0, n).map((l, i) =>
    [...l, 'https://www.example.com/directorio-fintech', TODAY(), i === 0 ? 'investigado' : 'nuevo'].map(csvCell).join(','),
  );
  return ['empresa,rubro,tamano,sitio_web,por_que_encaja,fuente,fecha_consulta,estado', ...rows].join('\n') + '\n';
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function draft(estado: 'borrador' | 'aprobado'): string {
  return `---
empresa: Pampa Pagos
contacto: Responsable de ingeniería (rol público en su sitio)
canal: email
estado: ${estado}
fuente: https://pampapagos.example/equipo
---
Hola, vi que están sumando pagos con QR y que su backend es Go…
`;
}

export function pipeline(withLead: boolean): string {
  const lead = withLead ? `- Pampa Pagos — próximo paso: enviar borrador aprobado — ${TODAY()}\n` : '';
  return `# Pipeline

## Lead
${lead}- Banco Demo — próximo paso: investigar — ${TODAY()}
## Contactado
- Fintech Uno — esperando respuesta
## Reunión
- Fintech Dos — martes 10:00
## Propuesta
## Ganado
- Cliente Histórico — mantenimiento mensual
## Perdido
`;
}
