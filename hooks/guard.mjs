#!/usr/bin/env node
// Guardia de los equipos de seguridad y comercial: hook PreToolUse en el frontmatter de esos subagentes.
// Lee el JSON del hook por stdin; si la llamada viola las reglas del equipo, sale con código 2 y el
// motivo en stderr (Claude Code bloquea la herramienta y le muestra el motivo al agente).
// Uso: office-guard <seguridad|comercial>

/** Separa un comando de shell en segmentos (;, &&, ||, |, &, saltos de línea) respetando comillas. */
export function segments(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '\\' && i + 1 < cmd.length) {
      cur += c + cmd[++i];
      continue;
    }
    // Redirecciones como 2>&1 o &>archivo no separan comandos.
    if (c === '&' && (cmd[i - 1] === '>' || cmd[i + 1] === '>')) {
      cur += c;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === ';' || c === '|' || c === '\n' || c === '&') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Palabras de un segmento, sin comillas, salteando asignaciones de variables al principio (FOO=1 cmd). */
export function words(segment) {
  const ws = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const c of segment) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has || cur) ws.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += c;
  }
  if (has || cur) ws.push(cur);
  while (ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0])) ws.shift();
  // sudo/env/time/timeout no esconden el comando real.
  while (ws.length && ['sudo', 'env', 'time', 'nice', 'nohup', 'command', 'exec'].includes(ws[0])) ws.shift();
  if (ws[0] === 'timeout') ws.splice(0, 2);
  return ws;
}

const SUBSTITUTION = /\$\(|`|<\(|>\(/;

function flagValue(ws, ...names) {
  for (let i = 0; i < ws.length; i++) {
    for (const n of names) {
      if (ws[i] === n) return ws[i + 1] ?? '';
      if (ws[i].startsWith(`${n}=`)) return ws[i].slice(n.length + 1);
    }
  }
  return null;
}

// ── Comercial: Bash solo para el tablero ───────────────────────────────────

function checkComercial(tool, input) {
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const path = String(input.file_path ?? input.notebook_path ?? '');
    if (!/(?:^|\/)comercial\//.test(path)) return `El equipo comercial solo escribe en comercial/ (intentaste ${path}).`;
    return null;
  }
  if (tool !== 'Bash') return null;
  const cmd = String(input.command ?? '');
  if (SUBSTITUTION.test(cmd)) return 'El equipo comercial solo puede usar Bash para `office-task`, sin sustituciones de comandos.';
  for (const seg of segments(cmd)) {
    const ws = words(seg);
    if (ws[0] !== 'office-task')
      return `El equipo comercial solo puede usar Bash para \`office-task\` (intentaste \`${ws[0] ?? seg}\`). No envía mensajes, no se registra y no completa formularios: eso lo hace el usuario.`;
  }
  return null;
}

// ── Seguridad: auditoría defensiva y de solo lectura ───────────────────────

const OFFENSIVE = new Set([
  'nmap', 'masscan', 'zmap', 'nuclei', 'sqlmap', 'nikto', 'hydra', 'medusa', 'ffuf', 'gobuster', 'dirb', 'dirbuster',
  'wfuzz', 'wpscan', 'msfconsole', 'msfvenom', 'zap', 'zap.sh', 'zaproxy', 'burpsuite', 'amass', 'subfinder', 'httpx',
  'naabu', 'responder', 'crackmapexec', 'netexec', 'john', 'hashcat', 'aircrack-ng', 'nc', 'ncat', 'netcat', 'socat',
  'hping3', 'slowloris', 'ab', 'wrk', 'siege', 'vegeta',
]);

const LOCAL_URL = /^(?:https?:\/\/)?(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i;

const SECRET_FILE = /(?:^|\/)(?:\.env(?:\.[\w.-]+)?|\.envrc|id_(?:rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(?:pem|key|p12|pfx|jks|keystore)|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc|\.git-credentials|terraform\.tfstate(?:\.backup)?|[\w.-]+\.tfvars)$/i;
const SECRET_FILE_OK = /\.(?:example|sample|template|dist)$/i;

const isSecretFile = (path) => SECRET_FILE.test(path) && !SECRET_FILE_OK.test(path);

const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'strings', 'xxd', 'od', 'hexdump', 'base64', 'cp', 'scp', 'rsync', 'grep', 'rg', 'egrep', 'awk', 'sed', 'jq', 'yq', 'source', '.']);

/** Operaciones de AWS que no modifican nada. */
function awsReadOnly(ws) {
  const args = ws.slice(1).filter((w, i, all) => !w.startsWith('-') && !(i > 0 && all[i - 1].startsWith('--') && !all[i - 1].includes('=')));
  const [service, op, sub] = args;
  if (!service) return true;
  if (['help', '--version', 'configure'].includes(service)) return service !== 'configure' || op === 'list' || op === 'get';
  if (service === 'sts') return op === 'get-caller-identity';
  if (service === 's3') return op === 'ls';
  if (!op) return true;
  if (op === 'help' || sub === 'help') return true;
  return /^(?:describe|list|get|lookup|search|batch-get|scan|query|check|simulate|generate-credential-report|generate-service-last-accessed-details)(?:-|$)/.test(op) && !/^get-(?:secret-value|parameter|parameters|password-data|session-token|federation-token)/.test(op);
}

function profileRule(ws, label) {
  const wanted = process.env.AGENT_OFFICE_AWS_PROFILE;
  const given = flagValue(ws, '--profile', '-p');
  if (!given) return `${label}: indicá explícitamente el perfil de solo lectura con --profile. Si el usuario no te lo dio, preguntale cuál usar.`;
  if (wanted && given !== wanted) return `${label}: el único perfil permitido es \`${wanted}\` (AGENT_OFFICE_AWS_PROFILE); intentaste \`${given}\`.`;
  return null;
}

function checkSeguridad(tool, input) {
  if (tool === 'Read' || tool === 'NotebookRead' || tool === 'Grep') {
    const path = String(input.file_path ?? input.notebook_path ?? input.path ?? '');
    if (isSecretFile(path))
      return `No se leen archivos que suelen tener secretos (${path}). Usá gitleaks con --redact y reportá solo archivo, línea, tipo y últimos 4 caracteres.`;
    return null;
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const path = String(input.file_path ?? input.notebook_path ?? '');
    if (!/(?:^|\/)docs\/security\//.test(path)) return `El equipo de seguridad solo escribe en docs/security/ (intentaste ${path}). Los arreglos los hacen devops o backend.`;
    return null;
  }
  if (tool !== 'Bash') return null;
  const cmd = String(input.command ?? '');
  if (SUBSTITUTION.test(cmd)) return 'El equipo de seguridad no usa sustituciones de comandos ($(...) o backticks): corré cada comando por separado.';

  for (const seg of segments(cmd)) {
    const ws = words(seg);
    const bin = (ws[0] ?? '').split('/').at(-1);
    if (!bin) continue;
    if (OFFENSIVE.has(bin)) return `\`${bin}\` es una herramienta de escaneo activo o ataque. Las auditorías son 100% defensivas y sin pruebas contra sistemas.`;

    if (bin === 'curl' || bin === 'wget' || bin === 'http' || bin === 'https') {
      const urls = ws.slice(1).filter((w) => /^(?:https?:\/\/|[\w.-]+\.[a-z]{2,}(?:[:/]|$))/i.test(w));
      if (urls.some((u) => !LOCAL_URL.test(u)))
        return 'El equipo de seguridad no hace pedidos a sistemas externos. Si necesitás instalar una herramienta, proponé el comando al usuario.';
    }

    if (READERS.has(bin) && ws.slice(1).some((w) => !w.startsWith('-') && isSecretFile(w)))
      return 'No se muestran archivos que suelen tener secretos. Usá gitleaks con --redact y reportá solo archivo, línea, tipo y últimos 4 caracteres.';
    if (['env', 'printenv', 'export', 'set'].includes(bin) && ws.length === 1) return 'No se listan variables de entorno: pueden contener secretos.';

    if (bin === 'aws') {
      if (!awsReadOnly(ws)) return 'En AWS solo se permiten operaciones de lectura (describe/list/get…). La remediación la hace devops o backend después del OK del usuario.';
      const p = profileRule(ws, 'AWS');
      if (p && !ws.includes('help') && ws[1] !== '--version') return p;
    }
    if (bin === 'prowler') {
      const p = profileRule(ws, 'Prowler');
      if (p) return p;
    }
    if (bin === 'gitleaks' && !ws.includes('--redact') && !ws.some((w) => w.startsWith('--redact='))) {
      if (!['version', 'help', '--version', '--help', '-h'].includes(ws[1] ?? '')) return 'gitleaks siempre con --redact: nunca se muestra el valor de un secreto.';
    }
    if (bin === 'trufflehog' && !ws.includes('--no-verification')) return 'trufflehog verifica secretos contra servicios externos; usalo con --no-verification (o usá gitleaks --redact).';
    if (bin === 'terraform' && /^(?:apply|destroy|import|taint|untaint|state|force-unlock|login|console)$/.test(ws[1] ?? ''))
      return `\`terraform ${ws[1]}\` modifica infraestructura o estado. El equipo de seguridad solo lee (plan/validate/show).`;
    if (bin === 'kubectl' && !/^(?:get|describe|version|api-resources|auth|explain|config)$/.test(ws[1] ?? '')) return 'Con kubectl solo se permite leer (get/describe).';
    if (bin === 'git' && /^(?:push|commit|reset|rebase|clean|checkout|switch|merge|tag|filter-branch|filter-repo|gc|prune)$/.test(ws[1] ?? ''))
      return `\`git ${ws[1]}\` modifica el repo. El equipo de seguridad solo lee (log, show, diff, grep).`;
    if (bin === 'docker' && /^(?:push|rm|rmi|kill|stop|run|exec|login|system)$/.test(ws[1] ?? ''))
      return `\`docker ${ws[1]}\` no es una operación de auditoría. Escaneá imágenes con Trivy.`;
    if (['rm', 'shred', 'chmod', 'chown', 'mv', 'dd', 'mkfs'].includes(bin) && !ws.slice(1).every((w) => w.startsWith('-') || /^(?:\/tmp\/|docs\/security\/)/.test(w)))
      return `\`${bin}\` modifica archivos del repo. El equipo de seguridad solo escribe en docs/security/.`;
    if (['npm', 'pnpm', 'yarn', 'composer', 'pip', 'pip3', 'go', 'brew', 'apt', 'apt-get'].includes(bin) && /^(?:install|i|add|update|upgrade|remove|uninstall|publish|get)$/.test(ws[1] ?? ''))
      return `\`${bin} ${ws[1]}\` cambia dependencias o instala software. Si falta una herramienta, informalo y proponé cómo instalarla.`;
  }
  return null;
}

export function check(policy, tool, input = {}) {
  if (policy === 'comercial') return checkComercial(tool, input);
  if (policy === 'seguridad') return checkSeguridad(tool, input);
  return null;
}

// ── Entrada del hook ───────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const policy = process.argv[2];
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
    const reason = check(policy, payload.tool_name, payload.tool_input ?? {});
    if (reason) {
      process.stderr.write(`Bloqueado por las reglas del equipo: ${reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
