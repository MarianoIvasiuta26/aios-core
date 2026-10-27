/**
 * Instala/desinstala Agent Office en la configuración global de Claude Code.
 *   pnpm office install | uninstall | status
 * Fusiona (nunca pisa) ~/.claude/settings.json y hace backup antes de tocarlo.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const SETTINGS = join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD = join(CLAUDE_DIR, 'CLAUDE.md');
const BIN_DIR = join(homedir(), '.local', 'bin');
const EMIT = join(REPO, 'hooks', 'emit.sh');

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
] as const;

const BLOCK_START = '<!-- agent-office:start -->';
const BLOCK_END = '<!-- agent-office:end -->';

/** Directorios del repo que se enlazan en ~/.claude. */
const LINKED_DIRS = [
  { from: join(REPO, 'claude', 'agents'), to: join(CLAUDE_DIR, 'agents') },
  { from: join(REPO, 'claude', 'commands'), to: join(CLAUDE_DIR, 'commands') },
];
const CLI_SOURCE = join(REPO, 'apps', 'cli', 'bin', 'office-task');
const CLI_LINK = join(BIN_DIR, 'office-task');

interface HookHandler {
  type: string;
  command?: string;
  [k: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}
type Settings = { hooks?: Record<string, HookGroup[]>; [k: string]: unknown };

const isOurs = (h: HookHandler) => h.type === 'command' && h.command === EMIT;

function readSettings(): Settings {
  if (!existsSync(SETTINGS)) return {};
  return JSON.parse(readFileSync(SETTINGS, 'utf8')) as Settings;
}

function writeSettings(s: Settings) {
  if (existsSync(SETTINGS)) {
    const backups = join(CLAUDE_DIR, 'backups');
    mkdirSync(backups, { recursive: true });
    const dest = join(backups, `settings.json.agent-office-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    copyFileSync(SETTINGS, dest);
    console.log(`  backup: ${dest}`);
  }
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(SETTINGS, `${JSON.stringify(s, null, 2)}\n`);
}

/** Quita nuestros handlers sin tocar los demás; elimina grupos/eventos que quedan vacíos. */
function stripOurHooks(s: Settings): Settings {
  if (!s.hooks) return s;
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(s.hooks)) {
    const kept = groups
      .map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length > 0) hooks[event] = kept;
  }
  const out = { ...s, hooks };
  if (Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

function addOurHooks(s: Settings): Settings {
  const out = stripOurHooks(s);
  const hooks = { ...(out.hooks ?? {}) };
  for (const event of HOOK_EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command: EMIT, async: true, timeout: 5 }] }];
  }
  return { ...out, hooks };
}

function linkTarget(path: string): string | null {
  try {
    return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : null;
  } catch {
    return null;
  }
}

function linkFile(from: string, to: string) {
  if (existsSync(to) || linkTarget(to) !== null) {
    if (linkTarget(to) === from) return;
    console.warn(`  ⚠ ya existe ${to} y no es nuestro; lo dejo como está`);
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  symlinkSync(from, to);
  console.log(`  enlace: ${to}`);
}

function unlinkIfOurs(path: string) {
  const target = linkTarget(path);
  if (target && target.startsWith(`${REPO}/`)) {
    unlinkSync(path);
    console.log(`  quitado: ${path}`);
  }
}

function markdownFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
}

function stripBlock(md: string): string {
  const re = new RegExp(`\\n*${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n*`, 'g');
  return md.replace(re, '\n').replace(/\n+$/, '\n');
}

function install() {
  console.log(`Instalando Agent Office en ${CLAUDE_DIR}`);
  writeSettings(addOurHooks(readSettings()));
  console.log(`  hooks: ${HOOK_EVENTS.join(', ')} → ${EMIT}`);

  for (const { from, to } of LINKED_DIRS) {
    for (const f of markdownFiles(from)) linkFile(join(from, f), join(to, f));
  }
  if (existsSync(CLI_SOURCE)) linkFile(CLI_SOURCE, CLI_LINK);

  const blockSource = join(REPO, 'claude', 'CLAUDE.office.md');
  if (existsSync(blockSource)) {
    const current = existsSync(CLAUDE_MD) ? stripBlock(readFileSync(CLAUDE_MD, 'utf8')) : '';
    const block = `${BLOCK_START}\n${readFileSync(blockSource, 'utf8').trim()}\n${BLOCK_END}\n`;
    writeFileSync(CLAUDE_MD, `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}`);
    console.log(`  CLAUDE.md: bloque agent-office actualizado`);
  }
  console.log('Listo. Las sesiones nuevas de Claude Code ya reportan a la oficina.');
}

function uninstall() {
  console.log(`Desinstalando Agent Office de ${CLAUDE_DIR}`);
  const s = readSettings();
  const stripped = stripOurHooks(s);
  if (JSON.stringify(stripped) !== JSON.stringify(s)) writeSettings(stripped);
  for (const { from, to } of LINKED_DIRS) {
    for (const f of markdownFiles(from)) unlinkIfOurs(join(to, f));
  }
  unlinkIfOurs(CLI_LINK);
  if (existsSync(CLAUDE_MD)) {
    const md = readFileSync(CLAUDE_MD, 'utf8');
    if (md.includes(BLOCK_START)) writeFileSync(CLAUDE_MD, stripBlock(md));
  }
  console.log('Listo.');
}

function status() {
  const s = readSettings();
  const installed = HOOK_EVENTS.filter((e) => s.hooks?.[e]?.some((g) => g.hooks.some(isOurs)));
  console.log(`settings: ${SETTINGS}`);
  console.log(`hooks instalados: ${installed.length}/${HOOK_EVENTS.length}${installed.length ? ` (${installed.join(', ')})` : ''}`);
  for (const { from, to } of LINKED_DIRS) {
    const files = markdownFiles(from);
    const linked = files.filter((f) => linkTarget(join(to, f)) === join(from, f));
    console.log(`${to}: ${linked.length}/${files.length} enlazados`);
  }
  console.log(`office-task: ${linkTarget(CLI_LINK) === CLI_SOURCE ? 'instalado' : 'no instalado'}`);
}

const cmd = process.argv[2];
if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else if (cmd === 'status') status();
else {
  console.log('Uso: pnpm office <install|uninstall|status>');
  process.exitCode = cmd ? 1 : 0;
}
