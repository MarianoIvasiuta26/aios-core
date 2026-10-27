import type { HookPayload } from './normalize.ts';
import type { Ingest } from './ingest.ts';

/**
 * Modo demo: genera payloads con el MISMO formato que mandan los hooks de Claude Code
 * y los pasa por el mismo normalizador, para probar la UI sin Claude Code corriendo.
 */

const CWD = '/home/demo/proyecto-demo';

type Step = [tool: string, input: Record<string, unknown>, durationMs: number, error?: string];

interface Scheduled {
  at: number;
  payload: HookPayload;
}

let seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

class Script {
  items: Scheduled[] = [];
  constructor(readonly sessionId: string) {}

  emit(at: number, payload: Omit<HookPayload, 'session_id' | 'cwd'>) {
    this.items.push({ at, payload: { session_id: this.sessionId, cwd: CWD, ...payload } as HookPayload });
  }

  /** Ejecuta pasos de herramientas en serie; devuelve el instante en que termina. */
  tools(start: number, steps: Step[], agent?: { id: string; type: string }): number {
    let t = start;
    for (const [tool, input, dur, error] of steps) {
      const tool_use_id = uid('toolu');
      const who = agent ? { agent_id: agent.id, agent_type: agent.type } : {};
      this.emit(t, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id, ...who });
      t += dur;
      if (error) {
        this.emit(t, { hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_input: input, tool_use_id, error, ...who });
      } else {
        this.emit(t, {
          hook_event_name: 'PostToolUse',
          tool_name: tool,
          tool_input: input,
          tool_response: {},
          tool_use_id,
          duration_ms: dur,
          ...who,
        });
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

function feature(s: Script, t0: number): number {
  s.emit(t0, { hook_event_name: 'UserPromptSubmit', prompt: '/feature Login con Google para el panel de clientes' });
  let t = s.tools(t0 + 800, [read('docs/BACKLOG.md', 600)]);
  t = s.delegate(t, 'product-owner', 'Historia de login con Google', '[T-101] Escribí la historia y criterios', [
    read('docs/BACKLOG.md'),
    read('docs/ROADMAP.md'),
    edit('docs/BACKLOG.md', 3000),
    bash('office-task create "HU-12 Login con Google" --team producto --prio P1 --as product-owner', 900),
    bash('office-task move T-101 en-curso --as product-owner', 700),
  ]);
  t = s.delegate(t, 'arquitecto', 'Diseño técnico OAuth', '[T-102] Proponé el diseño', [
    glob('internal/**/*.go'),
    grep('func .*Auth'),
    read('internal/auth/session.go'),
    read('cmd/api/main.go'),
  ]);
  s.emit(t, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude necesita permiso para usar Bash' });
  t += 3500;
  t = s.delegate(t, 'backend', 'Implementar login con Google', '[T-103] Implementá el diseño', [
    read('internal/auth/session.go'),
    write('internal/auth/google.go', 3500),
    edit('internal/api/routes.go'),
    edit('internal/api/users.go'),
    bash('go build ./...', 2500),
    bash('gofmt -l . && golangci-lint run', 3000),
    bash("curl -s -H 'Authorization: Bearer ya29a0AfB_byC7xQk2Lm9Pz4Rt8Uv1Ws3Yn6Hj0Kd5' localhost:8080/me", 900),
  ]);
  t = s.parallel(t, [
    ['qa-unit', 'Tests unitarios OAuth', '[T-104] Tests', [
      write('internal/auth/google_test.go', 3000),
      bash('go test -race ./internal/auth/...', 4000, 'Exit code 1\n--- FAIL: TestGoogleCallback/state_invalido'),
      edit('internal/auth/google_test.go'),
      bash('go test -race ./internal/auth/...', 3500),
      write('docs/qa/REPORTE-2026-10-27.md', 1500),
    ]],
    ['qa-e2e', 'E2E del login', '[T-105] Playwright', [
      read('docs/BACKLOG.md'),
      write('e2e/login-google.spec.ts', 3000),
      bash('pnpm exec playwright test e2e/login-google.spec.ts', 6000),
    ]],
    ['sec-appsec', 'Auditoría AppSec del cambio', '[T-106] AppSec', [
      bash('semgrep scan --config auto internal/auth', 5000),
      bash('gosec ./internal/...', 3500),
      bash('govulncheck ./...', 3000),
      write('docs/security/AUDITORIA-2026-10-27.md', 2000),
    ]],
  ]);
  t = s.delegate(t, 'reviewer', 'Revisión del diff', '[T-107] Revisá el diff', [
    bash('git diff main...HEAD --stat', 900),
    read('internal/auth/google.go', 1500),
    read('internal/api/routes.go'),
  ]);
  t = s.delegate(t, 'product-owner', 'Validar criterios de aceptación', '[T-101] Validá y cerrá', [
    read('docs/qa/REPORTE-2026-10-27.md'),
    edit('docs/BACKLOG.md'),
    bash('office-task move T-101 hecha --as product-owner', 700),
  ]);
  s.emit(t, { hook_event_name: 'Stop', stop_hook_active: false });
  return t + 3000;
}

function auditoria(s: Script, t0: number): number {
  s.emit(t0, { hook_event_name: 'UserPromptSubmit', prompt: '/auditoria completa' });
  let t = s.parallel(t0 + 1500, [
    ['sec-appsec', 'Auditoría de aplicación', '[T-110] AppSec', [
      bash('semgrep scan --config p/owasp-top-ten .', 5000),
      bash('composer audit', 2000),
      bash('npm audit --json', 2000),
      grep('password|secret'),
    ]],
    ['sec-cloud', 'Auditoría cloud', '[T-111] Cloud', [
      bash('checkov -d infra/terraform', 5000),
      bash('trivy config infra/terraform', 4000),
      bash('prowler aws --profile auditoria-ro -M json-ocsf', 8000),
    ]],
    ['sec-supply-chain', 'Cadena de suministro', '[T-112] Supply chain', [
      bash('gitleaks detect --redact -v', 4000),
      bash('trivy image registry.gitlab.com/demo/api:1.4.2', 5000),
      bash('syft dir:. -o cyclonedx-json > sbom.json', 3000),
      read('.gitlab-ci.yml'),
    ]],
  ]);
  t = s.delegate(t, 'sec-compliance', 'Consolidar informe', '[T-113] Consolidá', [
    read('docs/security/AUDITORIA-2026-10-27.md'),
    write('docs/security/hallazgos.json', 2500),
    write('docs/security/INFORME-EJECUTIVO-2026-10-27.md', 3500),
  ]);
  s.emit(t, { hook_event_name: 'Stop', stop_hook_active: false });
  return t + 3000;
}

function comercial(s: Script, t0: number): number {
  s.emit(t0, { hook_event_name: 'UserPromptSubmit', prompt: '/prospectar fintech Argentina' });
  let t = s.delegate(t0 + 1500, 'analista-mercado', 'Investigar mercado fintech', '[T-120] Mercado', [
    search('fintech Argentina 2026 demanda desarrollo backend Go'),
    fetch('https://www.example.org/informe-fintech-2026'),
    search('licitaciones públicas desarrollo software 2026'),
    write('comercial/mercado/INFORME-fintech-2026-10-27.md', 3000),
    edit('comercial/mercado/oportunidades.json'),
  ]);
  t = s.delegate(t, 'gerente-ventas', 'Elegir segmento', '[T-121] Segmento', [
    read('comercial/mercado/oportunidades.json'),
    read('comercial/PERFIL-CLIENTE.md'),
    edit('comercial/ESTRATEGIA.md'),
  ]);
  t = s.delegate(t, 'prospector', 'Buscar leads fintech', '[T-122] Leads', [
    search('fintech Buenos Aires equipo de ingeniería'),
    fetch('https://www.example.com/empresa'),
    edit('comercial/leads.csv'),
    edit('comercial/leads.csv'),
    write('comercial/borradores/fintech-ejemplo.md', 2500),
  ]);
  t = s.delegate(t, 'gerente-ventas', 'Revisar borradores', '[T-122] Revisión', [
    read('comercial/borradores/fintech-ejemplo.md'),
    edit('comercial/pipeline.md'),
  ]);
  s.emit(t, { hook_event_name: 'Stop', stop_hook_active: false });
  return t + 3000;
}

export function createDemo(ingest: Ingest) {
  let timers: NodeJS.Timeout[] = [];
  let running = false;
  let sessionId: string | null = null;

  function runRound(speed: number) {
    const s = new Script(sessionId!);
    const isFirst = timers.length === 0;
    if (isFirst) s.emit(0, { hook_event_name: 'SessionStart', source: 'startup', model: 'claude-demo' });
    let t = feature(s, 1000);
    t = auditoria(s, t);
    t = comercial(s, t);
    timers = [];
    for (const item of s.items) {
      timers.push(setTimeout(() => ingest.push(item.payload, Date.now(), 'demo'), item.at / speed));
    }
    timers.push(setTimeout(() => running && runRound(speed), t / speed));
  }

  return {
    get status() {
      return { running, sessionId };
    },
    start(speed = 1) {
      if (running) return sessionId!;
      running = true;
      sessionId = `demo-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
      timers = [];
      runRound(Math.min(Math.max(speed, 0.25), 8));
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
