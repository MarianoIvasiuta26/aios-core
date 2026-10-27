import { profileFor } from '@office/shared';

/** Cara pixel art de 8×8 generada a partir del color del agente. */
const FACE = [
  '..HHHH..',
  '.HHHHHH.',
  '.HSSSSH.',
  '.SESSES.',
  '.SSSSSS.',
  '..SMMS..',
  '.CCCCCC.',
  'CCCCCCCC',
];

const SKIN = '#f1c27d';

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amount))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

interface Props {
  agent: string | null;
  size?: number;
  title?: string;
}

export function AgentAvatar({ agent, size = 20, title }: Props) {
  if (!agent) {
    return (
      <svg width={size} height={size} viewBox="0 0 8 8" className="avatar avatar-empty" role="img" aria-label="Sin asignar">
        <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="1 1" />
      </svg>
    );
  }
  const p = profileFor(agent);
  const colors: Record<string, string> = { H: shade(p.color, -0.45), S: SKIN, E: '#1f2430', M: '#b5574b', C: p.color };
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" className="avatar" role="img" aria-label={title ?? p.displayName}>
      <title>{title ?? p.displayName}</title>
      {FACE.flatMap((row, y) =>
        [...row].map((ch, x) => (colors[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={colors[ch]} /> : null)),
      )}
    </svg>
  );
}
