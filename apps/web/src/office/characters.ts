import { profileFor } from '@office/shared';
import { hash } from './paint.ts';

/**
 * Personajes pixel art generados por código. Cada agente tiene una hoja de 16×24 por cuadro:
 * filas = direcciones (abajo, izquierda, derecha, arriba), columnas = quieto, paso A, paso B.
 */

export const CHAR_W = 16;
export const CHAR_H = 24;
export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const FRAMES = 3;

const BODY = [
  '....CCCCCCCC....',
  '...DCCCCCCCCD...',
  '...DCCCCCCCCD...',
  '...DCCCCCCCCD...',
  '...DCCCCCCCCD...',
  '...SCCCCCCCCS...',
  '....PPPPPPPP....',
  '....PPPPPPPP....',
  '....PPP..PPP....',
  '....PPP..PPP....',
  '....PPP..PPP....',
  '....BBB..BBB....',
];

const HEAD_DOWN = [
  '................',
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....SSESSESS....',
  '....SSSSSSSS....',
  '.....SSSSSS.....',
  '......SSSS......',
];

const HEAD_UP = [
  '................',
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....SHHHHHHS....',
  '.....SSSSSS.....',
  '......SSSS......',
];

const SIDE = [
  '................',
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HHHHHHHH....',
  '....SSSSHHHH....',
  '....SESSSHHH....',
  '....SSSSSSHH....',
  '.....SSSSSS.....',
  '......SSSS......',
  '.....CCCCCC.....',
  '.....CCDCCC.....',
  '.....CCDCCC.....',
  '.....CCDCCC.....',
  '.....CCSCCC.....',
  '.....CCCCCC.....',
  '.....PPPPPP.....',
  '.....PPPPPP.....',
  '.....PPPPPP.....',
  '.....PPPPPP.....',
  '.....PPPPPP.....',
  '.....BBBBBB.....',
  '................',
  '................',
];

const SIDE_WALK_A = ['.....PPPPPP.....', '....PPP..PPP....', '...PPP....PPP...', '...BBB....BBB...'];
const SIDE_WALK_B = ['.....PPPPPP.....', '.....PPPPPP.....', '.....PP.PPP.....', '.....BB.BBB.....'];

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d4a373'];
const HAIRS = ['#2b1d14', '#5a3a22', '#8b5a2b', '#c49a5a', '#1c1c1c', '#7a2e1f', '#d9c08b', '#4a4a4a'];

type Accessory = 'tie' | 'glasses' | 'cap' | 'coat' | 'headset' | 'long-hair' | 'badge';

interface Look {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  accessories: Accessory[];
  tie?: string;
}

const ACCESSORIES: Record<string, Accessory[]> = {
  jefe: ['tie'],
  'product-owner': ['long-hair'],
  arquitecto: ['glasses'],
  devops: ['cap'],
  reviewer: ['glasses'],
  docs: ['long-hair'],
  'qa-unit': ['coat'],
  'qa-e2e': ['coat', 'long-hair'],
  'sec-appsec': ['headset'],
  'sec-cloud': ['headset', 'long-hair'],
  'sec-supply-chain': ['headset'],
  'sec-compliance': ['glasses'],
  'analista-mercado': ['glasses', 'long-hair'],
  'gerente-ventas': ['tie'],
  visitante: ['badge'],
};

function seedOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function lookFor(agent: string): Look {
  const p = profileFor(agent === 'jefe' ? null : agent);
  const seed = seedOf(agent);
  return {
    skin: SKINS[Math.floor(hash(seed, 1) * SKINS.length)]!,
    hair: agent === 'jefe' ? '#9a9a9a' : HAIRS[Math.floor(hash(seed, 2) * HAIRS.length)]!,
    shirt: agent === 'jefe' ? '#2d3346' : p.color,
    pants: hash(seed, 3) > 0.5 ? '#2f3542' : '#4a4e69',
    accessories: ACCESSORIES[agent] ?? ACCESSORIES.visitante!,
    tie: agent === 'jefe' ? '#f2c14e' : '#c0392b',
  };
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amount))));
  return `#${((f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}

/** Construye las 24 filas del cuadro pedido como strings de leyenda. */
function template(dir: Direction, frame: number): string[] {
  if (dir === 'left' || dir === 'right') {
    const rows = [...SIDE];
    if (frame === 1) rows.splice(18, 4, ...SIDE_WALK_A);
    if (frame === 2) rows.splice(18, 4, ...SIDE_WALK_B);
    return dir === 'right' ? rows.map((r) => [...r].reverse().join('')) : rows;
  }
  const rows = [...(dir === 'down' ? HEAD_DOWN : HEAD_UP), ...BODY, '................', '................'];
  if (frame > 0) {
    // Una pierna adelante, la otra atrás: se acorta una y se balancean los brazos.
    const [short, long] = frame === 1 ? [[9, 10, 11], [4, 5, 6]] : [[4, 5, 6], [9, 10, 11]];
    const r = rows.map((row) => [...row]);
    for (const c of short) {
      r[21]![c] = '.';
      r[20]![c] = 'B';
    }
    for (const c of long) r[22]![c] = 'B';
    for (const c of long) r[21]![c] = 'P';
    const handRow = 15;
    const [up, down] = frame === 1 ? [3, 12] : [12, 3];
    r[handRow]![up] = 'D';
    r[handRow - 1]![up] = 'S';
    r[handRow + 1]![down] = 'S';
    return r.map((row) => row.join(''));
  }
  return rows;
}

function drawFrame(ctx: CanvasRenderingContext2D, ox: number, oy: number, look: Look, dir: Direction, frame: number) {
  const coat = look.accessories.includes('coat');
  const colors: Record<string, string> = {
    H: look.hair,
    S: look.skin,
    E: '#1f2430',
    C: coat ? '#f4f6f8' : look.shirt,
    D: coat ? '#d5dbe0' : shade(look.shirt, -0.25),
    P: look.pants,
    B: '#2a2522',
  };
  const rows = template(dir, frame);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = colors[ch];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    });
  });
  const px = (x: number, y: number, c: string, w = 1, h = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox + x, oy + y, w, h);
  };
  const front = dir === 'down';
  const side = dir === 'left' || dir === 'right';
  const flip = (x: number) => (dir === 'right' ? 15 - x : x);

  for (const acc of look.accessories) {
    switch (acc) {
      case 'long-hair':
        if (front) {
          px(4, 6, look.hair, 1, 5);
          px(11, 6, look.hair, 1, 5);
        } else if (dir === 'up') {
          px(4, 8, look.hair, 8, 3);
        } else {
          px(flip(10), 7, look.hair, 1, 4);
          px(flip(11), 6, look.hair, 1, 5);
        }
        break;
      case 'glasses':
        if (front) {
          px(5, 6, '#1f2430', 3, 1);
          px(8, 6, '#1f2430', 3, 1);
          px(6, 6, '#9fd3ff');
          px(9, 6, '#9fd3ff');
        } else if (side) {
          px(flip(4), 6, '#1f2430', 3, 1);
          px(flip(5), 6, '#9fd3ff');
        }
        break;
      case 'cap': {
        const capColor = shade(look.shirt, -0.35);
        px(4, 2, capColor, 8, 3);
        if (front) px(4, 5, capColor, 8, 1);
        if (side) px(dir === 'left' ? 2 : 10, 4, capColor, 4, 1);
        break;
      }
      case 'headset':
        px(4, 2, '#1c1f26', 8, 1);
        if (front || dir === 'up') {
          px(3, 5, '#1c1f26', 1, 3);
          px(12, 5, '#1c1f26', 1, 3);
          if (front) px(12, 8, '#1c1f26', 1, 1);
          if (front) px(10, 9, '#1c1f26', 2, 1);
        } else {
          px(flip(9), 5, '#1c1f26', 2, 3);
          px(flip(6), 8, '#1c1f26', 3, 1);
        }
        break;
      case 'coat':
        if (front) {
          px(6, 10, look.shirt, 4, 1);
          px(7, 11, look.shirt, 2, 3);
        }
        break;
      case 'tie':
        if (front) {
          px(7, 10, '#f4f6f8', 2, 1);
          px(7, 11, look.tie ?? '#c0392b', 2, 4);
          px(7, 15, look.tie ?? '#c0392b', 1, 1);
        }
        break;
      case 'badge':
        if (front) px(9, 12, '#f2c14e', 2, 2);
        break;
    }
  }
}

/** Hoja de sprites de un agente: 3 cuadros × 4 direcciones. */
export function drawCharacterSheet(agent: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CHAR_W * FRAMES;
  canvas.height = CHAR_H * DIRECTIONS.length;
  const ctx = canvas.getContext('2d')!;
  const look = lookFor(agent);
  DIRECTIONS.forEach((dir, row) => {
    for (let f = 0; f < FRAMES; f++) drawFrame(ctx, f * CHAR_W, row * CHAR_H, look, dir, f);
  });
  return canvas;
}

/** Silla de oficina vista de atrás; va por delante del personaje sentado y le tapa de la cintura para abajo. */
export const CHAIR_H = 13;

export function drawChair(boss: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = CHAIR_H;
  const ctx = c.getContext('2d')!;
  const main = boss ? '#5a2f21' : '#3d4458';
  const light = boss ? '#7a4330' : '#525b74';
  const p = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  p(4, 0, 8, 5, main);
  p(5, 1, 6, 1, light);
  p(3, 5, 10, 3, main);
  p(3, 5, 10, 1, light);
  p(7, 8, 2, 3, '#2a2e38');
  p(3, 11, 10, 1, '#2a2e38');
  p(3, 12, 2, 1, '#15171c');
  p(11, 12, 2, 1, '#15171c');
  return c;
}
