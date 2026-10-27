/**
 * Enmascara cualquier cosa que parezca un secreto. Nunca devuelve el valor:
 * solo `••••` + los últimos 4 caracteres, para poder identificarlo sin exponerlo.
 */

const MASK = '••••';

export function mask(secret: string): string {
  const tail = secret.length > 8 ? secret.slice(-4) : '';
  return `${MASK}${tail}`;
}

/** Nombres de variable/campo que se consideran sensibles. */
const SENSITIVE_KEY =
  '[A-Za-z0-9_.-]*(?:passw(?:or)?d|pwd|[_.-]pass|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?token|authorization|credential|session[_-]?key|signing[_-]?key|dsn)(?:[_.-][A-Za-z0-9_.-]*)?';

interface Rule {
  re: RegExp;
  /** Índice del grupo que contiene el secreto (0 = todo el match). */
  group: number;
}

const RULES: Rule[] = [
  // Bloques de claves privadas completos.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, group: 0 },
  // Proveedores conocidos.
  { re: /\b((?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16})\b/g, group: 1 },
  { re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, group: 1 },
  { re: /\b(github_pat_[A-Za-z0-9_]{20,})\b/g, group: 1 },
  { re: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g, group: 1 },
  { re: /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,})\b/g, group: 1 },
  { re: /\b(xox[abposr]-[A-Za-z0-9-]{10,})\b/g, group: 1 },
  { re: /\b(AIza[0-9A-Za-z_-]{35})\b/g, group: 1 },
  { re: /\b((?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,})\b/g, group: 1 },
  { re: /\b(npm_[A-Za-z0-9]{30,})\b/g, group: 1 },
  // JWT.
  { re: /\b(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, group: 1 },
  // Authorization headers.
  { re: /\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{8,})/gi, group: 1 },
  // Credenciales embebidas en URLs: scheme://user:pass@host
  { re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]+)@/gi, group: 1 },
  // KEY=valor, KEY: valor, "key": "valor", --password valor, --token=valor
  {
    re: new RegExp(`(?:^|[\\s"'{,;(])["']?${SENSITIVE_KEY}["']?\\s*[:=]\\s*["']?([^\\s"',;}]{4,})`, 'gim'),
    group: 1,
  },
  { re: new RegExp(`--${SENSITIVE_KEY}(?:=|\\s+)["']?([^\\s"']{4,})`, 'gi'), group: 1 },
];

/** Esquemas de Authorization: el valor real es el que sigue, que ya enmascara la regla de headers. */
const AUTH_SCHEME = /^(?:Bearer|Basic|Token)$/i;

/** Shannon entropy en bits por carácter. */
function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const CANDIDATE = /[A-Za-z0-9+/_=-]{32,}/g;

function looksRandom(token: string): boolean {
  if (token.includes('/') && /^\/?[\w.-]+(?:\/[\w.-]+)+$/.test(token) && !/[+=]/.test(token)) {
    // Parece una ruta (a/b/c o /a/b/c), no base64.
    const segments = token.split('/').filter(Boolean);
    // Segmentos cortos, o largos pero hechos de palabras con guiones (INFORME-EJECUTIVO-2026-10-27).
    if (segments.every((s) => s.length < 24 || s.split(/[-_.]/).every((w) => w.length <= 12))) return false;
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(token)).length;
  return classes === 3 && entropy(token) >= 4.2;
}

export function redact(input: string): string {
  let out = input;
  for (const { re, group } of RULES) {
    out = out.replace(re, (match: string, ...groups: unknown[]) => {
      const secret = group === 0 ? match : (groups[group - 1] as string | undefined);
      if (!secret || secret.startsWith(MASK) || AUTH_SCHEME.test(secret)) return match;
      if (group === 0) return mask(secret);
      const idx = match.lastIndexOf(secret);
      return match.slice(0, idx) + mask(secret) + match.slice(idx + secret.length);
    });
  }
  out = out.replace(CANDIDATE, (tok) => (looksRandom(tok) ? mask(tok) : tok));
  return out;
}

/** Redacta recursivamente todos los strings de un valor JSON. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && new RegExp(`^${SENSITIVE_KEY}$`, 'i').test(k) && v.length >= 4) {
        out[k] = mask(v);
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as T;
  }
  return value;
}
