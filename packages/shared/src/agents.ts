export const TEAMS = ['direccion', 'producto', 'ingenieria', 'qa', 'seguridad', 'comercial', 'externo'] as const;
export type Team = (typeof TEAMS)[number];

export const TEAM_LABELS: Record<Team, string> = {
  direccion: 'Dirección',
  producto: 'Producto',
  ingenieria: 'Ingeniería',
  qa: 'QA',
  seguridad: 'Ciberseguridad',
  comercial: 'Comercial',
  externo: 'Visitantes',
};

export interface AgentProfile {
  /** Igual al `name` del frontmatter del subagente (llega como `agent_type` en los hooks). */
  id: string;
  displayName: string;
  team: Team;
  /** Color principal del personaje (hex). */
  color: string;
}

/** Nombre reservado para la sesión principal de Claude Code. */
export const BOSS_ID = 'jefe';
/** Personaje genérico para subagentes que no están en el registro (Explore, general-purpose, etc.). */
export const VISITOR_ID = 'visitante';

export const AGENTS: readonly AgentProfile[] = [
  { id: BOSS_ID, displayName: 'Jefe', team: 'direccion', color: '#f2c14e' },
  { id: 'product-owner', displayName: 'Product Owner', team: 'producto', color: '#e76f51' },
  { id: 'arquitecto', displayName: 'Arquitecto', team: 'ingenieria', color: '#457b9d' },
  { id: 'backend', displayName: 'Backend', team: 'ingenieria', color: '#2a9d8f' },
  { id: 'devops', displayName: 'DevOps', team: 'ingenieria', color: '#f4a261' },
  { id: 'reviewer', displayName: 'Reviewer', team: 'ingenieria', color: '#8d99ae' },
  { id: 'docs', displayName: 'Docs', team: 'ingenieria', color: '#b5838d' },
  { id: 'qa-unit', displayName: 'QA Unit', team: 'qa', color: '#80b918' },
  { id: 'qa-e2e', displayName: 'QA E2E', team: 'qa', color: '#55a630' },
  { id: 'sec-appsec', displayName: 'AppSec', team: 'seguridad', color: '#d62828' },
  { id: 'sec-cloud', displayName: 'CloudSec', team: 'seguridad', color: '#9d0208' },
  { id: 'sec-supply-chain', displayName: 'Supply Chain', team: 'seguridad', color: '#e85d04' },
  { id: 'sec-compliance', displayName: 'Compliance', team: 'seguridad', color: '#6a040f' },
  { id: 'analista-mercado', displayName: 'Analista de mercado', team: 'comercial', color: '#7209b7' },
  { id: 'gerente-ventas', displayName: 'Gerente de ventas', team: 'comercial', color: '#3a0ca3' },
  { id: 'prospector', displayName: 'Prospector', team: 'comercial', color: '#4cc9f0' },
];

const VISITOR: AgentProfile = { id: VISITOR_ID, displayName: 'Visitante', team: 'externo', color: '#adb5bd' };

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

/** Resuelve el perfil a partir del `agent_type` del hook (undefined → jefe). */
export function profileFor(agentType: string | undefined | null): AgentProfile {
  if (!agentType) return BY_ID.get(BOSS_ID)!;
  // Los agentes de plugins llegan con scope ("plugin:nombre"); nos quedamos con el nombre.
  const name = agentType.includes(':') ? agentType.slice(agentType.lastIndexOf(':') + 1) : agentType;
  return BY_ID.get(name) ?? { ...VISITOR, displayName: agentType };
}
