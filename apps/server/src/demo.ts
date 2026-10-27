import type { Column, NewTask } from '@office/shared';
import type { HookPayload } from './normalize.ts';
import type { Ingest } from './ingest.ts';
import type { TaskStore } from './tasks.ts';
import {
  APPSEC_FINDINGS,
  backlog,
  CLOUD_FINDINGS,
  createDemoFiles,
  draft,
  findings,
  leads,
  opportunities,
  pipeline,
  qaReport,
  SUPPLY_FINDINGS,
  type DemoFiles,
} from './demo-files.ts';

/**
 * Modo demo: genera payloads con el MISMO formato que mandan los hooks de Claude Code
 * y los pasa por el mismo normalizador, para probar la UI sin Claude Code corriendo.
 * Las llamadas a `office-task` también impactan el tablero real, como lo haría la CLI.
 *
 * En prompts y comandos, `{ref}` se reemplaza por el id real de la tarjeta (`T-n`) al emitirse.
 * Los pasos que escriben archivos del workspace (backlog, hallazgos, leads…) los escriben de verdad
 * en un repo ficticio, así las zonas de la oficina reaccionan igual que con agentes reales.
 */

let CWD = '/tmp/agent-office-demo';

/** Acciones de tablero disponibles para un paso; `ref` es un nombre local del guion. */
interface Board {
  create(ref: string, task: NewTask): void;
  move(ref: string, column: Column): void;
  /** Id real (`T-n`) de una tarjeta creada en esta vuelta. */
  id(ref: string): string;
  files: DemoFiles;
  /** Suma hallazgos a docs/security/hallazgos.json (lo comparten los auditores en paralelo). */
  addFindings(list: ReturnType<typeof CLOUD_FINDINGS>, postura?: number): void;
}
type Effect = (board: Board) => void;

type Step = [tool: string, input: Record<string, unknown>, durationMs: number, error?: string, effect?: Effect];

interface Scheduled {
  at: number;
  payload: HookPayload;
  /** Efecto en el tablero; corre justo antes de emitir el PostToolUse, como haría la CLI real. */
  effect?: { run: Effect; actor: string };
}

let seq = 0;
const today = () => new Date().toISOString().slice(0, 10);
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

class Script {
  items: Scheduled[] = [];
  constructor(readonly sessionId: string) {}

  emit(at: number, payload: Omit<HookPayload, 'session_id' | 'cwd'>, effect?: Scheduled['effect']) {
    this.items.push({ at, payload: { session_id: this.sessionId, cwd: CWD, ...payload } as HookPayload, effect });
  }

  /** Ejecuta pasos de herramientas en serie; devuelve el instante en que termina. */
  tools(start: number, steps: Step[], agent?: { id: string; type: string }): number {
    let t = start;
    const actor = agent?.type ?? 'jefe';
    for (const [tool, input, dur, error, effect] of steps) {
      const tool_use_id = uid('toolu');
      const who = agent ? { agent_id: agent.id, agent_type: agent.type } : {};
      this.emit(t, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id, ...who });
      t += dur;
      if (error) {
        this.emit(t, { hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_input: input, tool_use_id, error, ...who });
      } else {
        this.emit(
          t,
          { hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: {}, tool_use_id, duration_ms: dur, ...who },
          effect ? { run: effect, actor } : undefined,
        );
      }
      t += 500 + Math.round(Math.random() * 900);
    }
    return t;
  }

  /** El jefe delega en un subagente: Agent Pre → SubagentStart → pasos → SubagentStop → Agent Post. */
  delegate(start: number, type: string, description: string, prompt: string, steps: Step[]): number {
    const agentId = uid('agent');
    const tool_use_id = uid('toolu');
    const input = { subagent_type: type, description, prompt };
    this.emit(start, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: input, tool_use_id });
    this.emit(start + 300, { hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: type });
    const end = this.tools(start + 2500, steps, { id: agentId, type });
    this.emit(end, {
      hook_event_name: 'SubagentStop',
      agent_id: agentId,
      agent_type: type,
      stop_hook_active: false,
      last_assistant_message: `${description}: listo.`,
    });
    this.emit(end + 200, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_input: input,
      tool_response: {},
      tool_use_id,
      duration_ms: end + 200 - start,
    });
    return end + 1500;
  }

  /** Varios subagentes en paralelo; devuelve cuando terminó el último. */
  parallel(start: number, runs: Array<[type: string, description: string, prompt: string, steps: Step[]]>): number {
    return Math.max(...runs.map(([type, d, p, s], i) => this.delegate(start + i * 700, type, d, p, s)));
  }
}

const read = (file_path: string, d = 900): Step => ['Read', { file_path: `${CWD}/${file_path}` }, d];
const edit = (file_path: string, d = 2200): Step => ['Edit', { file_path: `${CWD}/${file_path}`, old_string: '…', new_string: '…' }, d];
const write = (file_path: string, d = 2500): Step => ['Write', { file_path: `${CWD}/${file_path}`, content: '…' }, d];
const bash = (command: string, d = 2000, error?: string): Step => ['Bash', { command }, d, error];
const grep = (pattern: string, d = 700): Step => ['Grep', { pattern }, d];
const glob = (pattern: string, d = 500): Step => ['Glob', { pattern }, d];
const search = (query: string, d = 2500): Step => ['WebSearch', { query }, d];
const fetch = (url: string, d = 2200): Step => ['WebFetch', { url, prompt: 'resumir' }, d];
/** El mismo paso, con un efecto que corre al terminar bien (por ejemplo, escribir el archivo). */
const fx = ([tool, input, d]: Step, effect: Effect): Step => [tool, input, d, undefined, effect];

/** `office-task create` que además crea la tarjeta (o varias) en el tablero. */
const createTasks = (tasks: Record<string, NewTask>, d = 900): Step => [
  'Bash',
  {
    command: Object.values(tasks)
      .map((t) => `office-task create "${t.title}" --prio ${t.priority ?? 'P2'}`)
      .join(' && '),
  },
  d,
  undefined,
  (b) => Object.entries(tasks).forEach(([ref, t]) => b.create(ref, t)),
];
/** `office-task move` que además mueve la tarjeta. */
const moveTask = (ref: string, column: Column, d = 700): Step => [
  'Bash',
  { command: `office-task move {${ref}} ${column}` },
  d,
  undefined,
  (b) => b.move(ref, column),
];

function feature(s: Script, t0: number): number {
  s.emit(t0, { hook_event_name: 'UserPromptSubmit', prompt: '/feature Login con Google para el panel de clientes' });
  let t = s.tools(t0 + 800, [read('docs/BACKLOG.md', 600)]);
  t = s.delegate(t, 'product-owner', 'Historia de login con Google', 'Escribí la historia, criterios y tarjetas', [
    read('docs/BACKLOG.md'),
    read('docs/ROADMAP.md'),
    edit('docs/BACKLOG.md', 3000),
    createTasks(
      {
        hu: {
          title: 'HU-12 Login con Google',
          assignee: 'product-owner',
          priority: 'P1',
          related: 'HU-12',
          labels: ['auth'],
          column: 'en-curso',
        },
        design: {
          title: 'Diseño técnico OAuth',
          assignee: 'arquitecto',
          priority: 'P1',
          related: 'HU-12',
          labels: ['auth', 'diseño'],
          column: 'por-hacer',
        },
        impl: {
          title: 'Implementar callback OAuth en Go',
          assignee: 'backend',
          priority: 'P1',
          related: 'HU-12',
          labels: ['auth', 'go'],
          column: 'por-hacer',
        },
        unit: {
          title: 'Tests unitarios del login',
          assignee: 'qa-unit',
          priority: 'P2',
          related: 'HU-12',
          labels: ['tests'],
          column: 'por-hacer',
        },
        e2e: {
          title: 'E2E del login con Playwright',
          assignee: 'qa-e2e',
          priority: 'P2',
          related: 'HU-12',
          labels: ['tests', 'e2e'],
          column: 'por-hacer',
        },
        sec: {
          title: 'AppSec del flujo OAuth',
          assignee: 'sec-appsec',
          priority: 'P1',
          related: 'HU-12',
          labels: ['seguridad'],
          column: 'por-hacer',
        },
      },
      1500,
    ),
    fx(edit('docs/BACKLOG.md', 1200), (b) => b.files.write('docs/BACKLOG.md', backlog({ column: 'por-hacer', task: b.id('hu') }))),
  ]);
  t = s.delegate(t, 'arquitecto', 'Diseño técnico OAuth', '[{design}] Proponé el diseño', [
    glob('internal/**/*.go'),
    grep('func .*Auth'),
    read('internal/auth/session.go'),
    read('cmd/api/main.go'),
    moveTask('design', 'hecha'),
  ]);
  s.emit(t, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude necesita permiso para usar Bash' });
  t += 3500;
  t = s.delegate(t, 'backend', 'Implementar login con Google', '[{impl}] Implementá el diseño', [
    read('internal/auth/session.go'),
    write('internal/auth/google.go', 3500),
    edit('internal/api/routes.go'),
    edit('internal/api/users.go'),
    bash('go build ./...', 2500),
    bash('gofmt -l . && golangci-lint run', 3000),
    bash("curl -s -H 'Authorization: Bearer ya29a0AfB_byC7xQk2Lm9Pz4Rt8Uv1Ws3Yn6Hj0Kd5' localhost:8080/me", 900),
    moveTask('impl', 'en-revision'),
  ]);
  t = s.parallel(t, [
    [
      'qa-unit',
      'Tests unitarios OAuth',
      '[{unit}] Tests',
      [
        write('internal/auth/google_test.go', 3000),
        bash('go test -race ./internal/auth/...', 4000, 'Exit code 1\n--- FAIL: TestGoogleCallback/state_invalido'),
        fx(edit('internal/auth/google_test.go', 3500), (b) => b.files.write(`docs/qa/REPORTE-${today()}.md`, qaReport(1))),
        bash('go test -race ./internal/auth/...', 3500),
        fx(write(`docs/qa/REPORTE-${today()}.md`, 1500), (b) => b.files.write(`docs/qa/REPORTE-${today()}.md`, qaReport(0))),
        moveTask('unit', 'hecha'),
      ],
    ],
    [
      'qa-e2e',
      'E2E del login',
      '[{e2e}] Playwright',
      [
        read('docs/BACKLOG.md'),
        write('e2e/login-google.spec.ts', 3000),
        bash('pnpm exec playwright test e2e/login-google.spec.ts', 6000),
        moveTask('e2e', 'hecha'),
      ],
    ],
    [
      'sec-appsec',
      'Auditoría AppSec del cambio',
      '[{sec}] AppSec',
      [
        bash('semgrep scan --config auto internal/auth', 5000),
        bash('gosec ./internal/...', 3500),
        bash('govulncheck ./...', 3000),
        write(`docs/security/AUDITORIA-${today()}.md`, 2000),
        moveTask('sec', 'hecha'),
      ],
    ],
  ]);
  t = s.delegate(t, 'reviewer', 'Revisión del diff', 'Revisá el diff de [{impl}]', [
    bash('git diff main...HEAD --stat', 900),
    read('internal/auth/google.go', 1500),
    read('internal/api/routes.go'),
    moveTask('impl', 'hecha'),
  ]);
  t = s.delegate(t, 'product-owner', 'Validar criterios de aceptación', 'Validá los criterios de [{hu}]', [
    read(`docs/qa/REPORTE-${today()}.md`),
    fx(edit('docs/BACKLOG.md'), (b) => b.files.write('docs/BACKLOG.md', backlog({ column: 'hecha', task: b.id('hu') }))),
    moveTask('hu', 'hecha'),
  ]);
  s.emit(t, { hook_event_name: 'Stop', stop_hook_active: false });
  return t + 3000;
}

function auditoria(s: Script, t0: number): number {
  s.emit(t0, { hook_event_name: 'UserPromptSubmit', prompt: '/auditoria completa' });
  let t = s.tools(t0 + 800, [
    createTasks({
      app: { title: 'Auditoría AppSec', assignee: 'sec-appsec', priority: 'P1', labels: ['auditoría'], column: 'por-hacer' },
      cloud: {
        title: 'Auditoría cloud AWS + Terraform',
        assignee: 'sec-cloud',
        priority: 'P1',
        labels: ['auditoría', 'aws'],
        column: 'por-hacer',
      },
      supply: { title: 'Auditoría supply chain', assignee: 'sec-supply-chain', priority: 'P1', labels: ['auditoría'], column: 'por-hacer' },
      report: {
        title: 'Informe ejecutivo de seguridad',
        assignee: 'sec-compliance',
        priority: 'P2',
        labels: ['auditoría', 'informe'],
        column: 'backlog',
      },
    }),
  ]);
  t = s.parallel(t, [
    [
      'sec-appsec',
      'Auditoría de aplicación',
      '[{app}] AppSec',
      [
        bash('semgrep scan --config p/owasp-top-ten .', 5000),
        bash('composer audit', 2000),
        bash('npm audit --json', 2000),
        grep('password|secret'),
        fx(write('docs/security/hallazgos.json', 1500), (b) => b.addFindings(APPSEC_FINDINGS)),
        moveTask('app', 'hecha'),
      ],
    ],
    [
      'sec-cloud',
      'Auditoría cloud',
      '[{cloud}] Cloud',
      [
        bash('checkov -d infra/terraform', 5000),
        bash('trivy config infra/terraform', 4000),
        bash('prowler aws --profile auditoria-ro -M json-ocsf', 8000),
        createTasks({
          fix: {
            title: 'Cerrar acceso público del bucket de reportes',
            assignee: 'devops',
            priority: 'P0',
            related: 'SEC-03',
            labels: ['aws', 'seguridad'],
            column: 'por-hacer',
          },
        }),
        fx(write('docs/security/hallazgos.json', 1500), (b) => b.addFindings(CLOUD_FINDINGS(b.id('fix')))),
        moveTask('cloud', 'hecha'),
      ],
    ],
    [
      'sec-supply-chain',
      'Cadena de suministro',
      '[{supply}] Supply chain',
      [
        bash('gitleaks detect --redact -v', 4000),
        bash('trivy image registry.gitlab.com/demo/api:1.4.2', 5000),
        bash('syft dir:. -o cyclonedx-json > sbom.json', 3000),
        read('.gitlab-ci.yml'),
        fx(write('docs/security/hallazgos.json', 1500), (b) => b.addFindings(SUPPLY_FINDINGS)),
        moveTask('supply', 'hecha'),
      ],
    ],
  ]);
  t = s.delegate(t, 'sec-compliance', 'Consolidar informe', '[{report}] Consolidá', [
    read(`docs/security/AUDITORIA-${today()}.md`),
    fx(write('docs/security/hallazgos.json', 2500), (b) => b.addFindings([], 58)),
    write(`docs/security/INFORME-EJECUTIVO-${today()}.md`, 3500),
    moveTask('report', 'en-revision'),
  ]);
  s.emit(t, { hook_event_name: 'Stop', stop_hook_active: false });
  return t + 3000;
}

function comercial(s: Script, t0: number): number {
  s.emit(t0, { hook_event_name: 'UserPromptSubmit', prompt: '/prospectar fintech Argentina' });
  let t = s.tools(t0 + 800, [
    createTasks({
      market: {
        title: 'Investigar mercado fintech AR',
        assignee: 'analista-mercado',
        priority: 'P2',
        labels: ['mercado'],
        column: 'por-hacer',
      },
      leads: { title: 'Prospectar fintech AR', assignee: 'prospector', priority: 'P2', labels: ['leads'], column: 'backlog' },
    }),
  ]);
  t = s.delegate(t, 'analista-mercado', 'Investigar mercado fintech', '[{market}] Mercado', [
    search('fintech Argentina 2026 demanda desarrollo backend Go'),
    fetch('https://www.example.org/informe-fintech-2026'),
    search('licitaciones públicas desarrollo software 2026'),
    write(`comercial/mercado/INFORME-fintech-${today()}.md`, 3000),
    fx(edit('comercial/mercado/oportunidades.json'), (b) => b.files.write('comercial/mercado/oportunidades.json', opportunities())),
    moveTask('market', 'hecha'),
  ]);
  t = s.delegate(t, 'gerente-ventas', 'Elegir segmento', 'Elegí el segmento para [{leads}]', [
    read('comercial/mercado/oportunidades.json'),
    read('comercial/PERFIL-CLIENTE.md'),
    edit('comercial/ESTRATEGIA.md'),
  ]);
  t = s.delegate(t, 'prospector', 'Buscar leads fintech', '[{leads}] Leads', [
    search('fintech Buenos Aires equipo de ingeniería'),
    fetch('https://www.example.com/empresa'),
    fx(edit('comercial/leads.csv'), (b) => b.files.write('comercial/leads.csv', leads(2))),
    fetch('https://www.example.com/directorio-fintech'),
    fx(edit('comercial/leads.csv'), (b) => b.files.write('comercial/leads.csv', leads(5))),
    fx(write('comercial/borradores/pampa-pagos.md', 2500), (b) => b.files.write('comercial/borradores/pampa-pagos.md', draft('borrador'))),
    moveTask('leads', 'en-revision'),
  ]);
  t = s.delegate(t, 'gerente-ventas', 'Revisar borradores', 'Revisá los borradores de [{leads}]', [
    read('comercial/borradores/pampa-pagos.md'),
    fx(edit('comercial/borradores/pampa-pagos.md', 1500), (b) => b.files.write('comercial/borradores/pampa-pagos.md', draft('aprobado'))),
    fx(edit('comercial/pipeline.md'), (b) => b.files.write('comercial/pipeline.md', pipeline(true))),
    moveTask('leads', 'hecha'),
  ]);
  s.emit(t, { hook_event_name: 'Stop', stop_hook_active: false });
  return t + 3000;
}

/** Reemplaza `{ref}` por el id real en todos los strings del payload. */
function resolveRefs(payload: HookPayload, refs: Map<string, string>): HookPayload {
  if (refs.size === 0) return payload;
  const json = JSON.stringify(payload).replace(/\{([a-z]+)\}/g, (m, ref: string) => refs.get(ref) ?? m);
  return JSON.parse(json) as HookPayload;
}

export function createDemo(ingest: Ingest, tasks: TaskStore, root = CWD) {
  CWD = root;
  const files = createDemoFiles(root);
  let timers: NodeJS.Timeout[] = [];
  let running = false;
  let sessionId: string | null = null;

  function runRound(speed: number, first: boolean) {
    const s = new Script(sessionId!);
    const refs = new Map<string, string>();
    const found: ReturnType<typeof CLOUD_FINDINGS> = [];
    let postura: number | undefined;
    files.reset();
    const boardFor = (actor: string): Board => ({
      files,
      id: (ref) => refs.get(ref) ?? ref,
      addFindings: (list, p) => {
        found.push(...list);
        postura = p ?? postura;
        files.write('docs/security/hallazgos.json', findings(found, postura));
      },
      create: (ref, task) => refs.set(ref, tasks.create({ ...task, actor }).task.id),
      move: (ref, column) => {
        const id = refs.get(ref);
        if (id && tasks.exists(id) && tasks.get(id).column !== column) tasks.update(id, { column, actor });
      },
    });
    if (first) s.emit(0, { hook_event_name: 'SessionStart', source: 'startup', model: 'claude-demo' });
    let t = feature(s, 1000);
    t = auditoria(s, t);
    t = comercial(s, t);
    timers = [];
    for (const item of s.items) {
      timers.push(
        setTimeout(() => {
          try {
            item.effect?.run(boardFor(item.effect.actor));
          } catch (err) {
            console.error('[demo] efecto de tablero falló', err);
          }
          ingest.push(resolveRefs(item.payload, refs), Date.now(), 'demo');
        }, item.at / speed),
      );
    }
    timers.push(setTimeout(() => running && runRound(speed, false), t / speed));
  }

  return {
    get status() {
      return { running, sessionId };
    },
    root,
    start(speed = 1) {
      if (running) return sessionId!;
      running = true;
      sessionId = `demo-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
      runRound(Math.min(Math.max(speed, 0.25), 8), true);
      return sessionId;
    },
    stop() {
      if (!running) return;
      running = false;
      for (const t of timers) clearTimeout(t);
      timers = [];
      if (sessionId) {
        ingest.push({ session_id: sessionId, cwd: CWD, hook_event_name: 'SessionEnd', reason: 'other' }, Date.now(), 'demo');
      }
    },
  };
}
