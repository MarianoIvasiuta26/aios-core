import { MAP_H, MAP_W, TILE, WORLD_H, WORLD_W, cellAt, type Floor, type Furniture, type OfficeMap, type ZoneId } from './map.ts';

/** Pinta todo lo estático de la oficina en un único canvas: un solo sprite, cero costo por frame. */

type Ctx = CanvasRenderingContext2D;

/** Ruido determinístico 0..1 por coordenada. */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

const FLOOR: Record<Floor, (ctx: Ctx, px: number, py: number, tx: number, ty: number) => void> = {
  pasillo(ctx, px, py, tx, ty) {
    rect(ctx, px, py, TILE, TILE, '#cdc4b1');
    rect(ctx, px, py + TILE - 1, TILE, 1, '#bfb5a0');
    rect(ctx, px + TILE - 1, py, 1, TILE, '#c5bba7');
    if (hash(tx, ty) > 0.7) rect(ctx, px + Math.floor(hash(tx, ty, 1) * 14), py + Math.floor(hash(tx, ty, 2) * 14), 1, 1, '#bdb39e');
  },
  madera(ctx, px, py, tx, ty) {
    for (let r = 0; r < 4; r++) {
      const shade = hash(tx >> 1, ty * 4 + r) > 0.5 ? '#9b6a43' : '#916240';
      rect(ctx, px, py + r * 4, TILE, 4, shade);
      rect(ctx, px, py + r * 4 + 3, TILE, 1, '#77502f');
      const seam = Math.floor(hash(ty * 4 + r, tx >> 1, 3) * 16);
      if ((tx + r) % 2 === 0) rect(ctx, px + seam, py + r * 4, 1, 3, '#7f5634');
    }
  },
  alfombra(ctx, px, py, tx, ty) {
    rect(ctx, px, py, TILE, TILE, '#6b5878');
    for (let i = 0; i < 6; i++) rect(ctx, px + Math.floor(hash(tx, ty, i) * 16), py + Math.floor(hash(ty, tx, i) * 16), 1, 1, '#76638a');
  },
  'alfombra-azul'(ctx, px, py, tx, ty) {
    rect(ctx, px, py, TILE, TILE, '#3d5671');
    for (let i = 0; i < 7; i++) rect(ctx, px + Math.floor(hash(tx, ty, i) * 16), py + Math.floor(hash(ty, tx, i + 9) * 16), 1, 1, '#47607d');
    if ((tx + ty) % 2 === 0) rect(ctx, px, py, TILE, 1, '#3a526c');
  },
  comercial(ctx, px, py, tx, ty) {
    rect(ctx, px, py, TILE, TILE, '#857e70');
    for (let i = 0; i < 6; i++) rect(ctx, px + Math.floor(hash(tx, ty, i) * 16), py + Math.floor(hash(ty, tx, i + 3) * 16), 1, 1, '#8f887a');
  },
  cocina(ctx, px, py) {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) rect(ctx, px + i * 8, py + j * 8, 8, 8, (i + j) % 2 ? '#c6bfae' : '#ebe6da');
  },
  soc(ctx, px, py, tx, ty) {
    rect(ctx, px, py, TILE, TILE, '#182030');
    rect(ctx, px, py, TILE, 1, '#202a3d');
    rect(ctx, px, py, 1, TILE, '#202a3d');
    if (hash(tx, ty, 5) > 0.93) rect(ctx, px + 7, py + 7, 2, 2, '#2c5d6e');
  },
  lab(ctx, px, py) {
    rect(ctx, px, py, TILE, TILE, '#d7e0e1');
    rect(ctx, px, py + 7, TILE, 1, '#c3cecf');
    rect(ctx, px + 7, py, 1, TILE, '#c3cecf');
  },
  lobby(ctx, px, py, tx, ty) {
    const base = hash(tx, ty, 7) > 0.5 ? '#b8b2a5' : '#b1ab9d';
    rect(ctx, px, py, TILE, TILE, base);
    rect(ctx, px, py, TILE, 1, '#c9c3b6');
    rect(ctx, px, py, 1, TILE, '#c9c3b6');
    rect(ctx, px, py + TILE - 1, TILE, 1, '#9e9789');
    rect(ctx, px + TILE - 1, py, 1, TILE, '#9e9789');
  },
};

/** Zona de la habitación a la que mira una pared (para colorear el frente). */
function zoneBelow(m: OfficeMap, x: number, y: number): ZoneId | null {
  for (let k = 1; k <= 7 && y + k < MAP_H; k++) {
    const z = m.zoneOf[(y + k) * MAP_W + x];
    if (z) return z;
  }
  return null;
}

const FACE_COLORS: Partial<Record<ZoneId, [base: string, shadow: string, board: string]>> = {
  soc: ['#262e40', '#1d2433', '#141a26'],
  comercial: ['#cdd6cf', '#b7c1b9', '#7c8a80'],
  qa: ['#dfe7e8', '#c8d2d4', '#8a979a'],
};

function paintWall(ctx: Ctx, m: OfficeMap, x: number, y: number) {
  const px = x * TILE;
  const py = y * TILE;
  const c = cellAt(m, x, y);
  if (c === 'wall') {
    rect(ctx, px, py, TILE, TILE, '#2c3245');
    rect(ctx, px, py, TILE, 2, '#3a425a');
    if (cellAt(m, x, y + 1) !== 'wall') rect(ctx, px, py + TILE - 2, TILE, 2, '#232838');
    return;
  }
  if (c === 'face') {
    const [base, shadow, board] = FACE_COLORS[zoneBelow(m, x, y) ?? 'lobby'] ?? ['#d9cdb4', '#c4b79c', '#8b7a5e'];
    rect(ctx, px, py, TILE, TILE, base);
    if (cellAt(m, x, y - 1) === 'wall') rect(ctx, px, py, TILE, 2, shadow);
    if (cellAt(m, x, y + 1) !== 'face') {
      rect(ctx, px, py + TILE - 3, TILE, 3, board);
      rect(ctx, px, py + TILE - 3, TILE, 1, shadow);
    }
    return;
  }
  if (c === 'window') {
    const top = cellAt(m, x, y - 1) !== 'window';
    rect(ctx, px, py, TILE, TILE, '#2c3245');
    // La ciudad por la ventana: de noche con luces encendidas, de día con cielo y nubes.
    const sky = NIGHT ? (top ? '#1d2a4a' : '#2a3a62') : top ? '#7fb8f0' : '#a7d0f5';
    rect(ctx, px + 1, py + (top ? 2 : 0), TILE - 2, TILE - (top ? 2 : 1), sky);
    if (!top) {
      for (let i = 0; i < 4; i++) {
        const bh = 4 + Math.floor(hash(x, i) * 9);
        const bx = px + 1 + i * 4;
        rect(ctx, bx, py + TILE - 1 - bh, 3, bh, NIGHT ? '#141c30' : '#7d8ca3');
        if (NIGHT && hash(x, i, 3) > 0.4) rect(ctx, bx + 1, py + TILE - bh + 1, 1, 1, '#f6d67a');
        if (!NIGHT && bh > 6) rect(ctx, bx + 1, py + TILE - bh + 2, 1, 1, '#c9d6e6');
      }
      rect(ctx, px, py + TILE - 1, TILE, 1, '#2c3245');
    } else if (NIGHT && hash(x, y, 9) > 0.6) {
      rect(ctx, px + 4 + Math.floor(hash(x, 1) * 8), py + 5, 1, 1, '#dfe6ff');
    } else if (!NIGHT && hash(x, y, 9) > 0.55) {
      rect(ctx, px + 3 + Math.floor(hash(x, 1) * 7), py + 6, 5, 2, '#f4f8ff');
    }
    if (x === 8 && top) {
      rect(ctx, px + 6, py + 4, 4, 4, NIGHT ? '#f4ecc8' : '#ffd84d');
      if (NIGHT) rect(ctx, px + 8, py + 4, 2, 2, '#1d2a4a');
    }
    rect(ctx, px + TILE - 1, py, 1, TILE, '#3a425a');
    return;
  }
  if (c === 'glass') {
    const z = m.zoneOf[y * MAP_W + x - 1] ?? m.zoneOf[(y - 1) * MAP_W + x];
    FLOOR[z === 'tablero' ? 'pasillo' : 'comercial'](ctx, px, py, x, y);
    ctx.fillStyle = 'rgba(170, 220, 235, 0.45)';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(px + 3, py + 2, 1, 6);
    ctx.fillRect(px + 5, py + 2, 1, 3);
    rect(ctx, px, py, TILE, 1, '#e8f3f6');
    if ((x + y) % 3 === 0) rect(ctx, px, py, 1, TILE, '#d6e6ea');
    return;
  }
  if (c === 'door') {
    const neighborFloor = (m.floors[y * MAP_W + Math.max(0, x - 1)] ?? 'pasillo') as Floor;
    FLOOR[neighborFloor](ctx, px, py, x, y);
    const vertical = cellAt(m, x, y - 1) === 'wall' || cellAt(m, x, y + 1) === 'wall' || cellAt(m, x, y - 1) === 'door';
    if (y === MAP_H - 1) {
      rect(ctx, px, py, TILE, TILE, '#6d5a43');
      rect(ctx, px + 1, py + 2, TILE - 2, TILE - 4, '#8a7155');
    } else if (vertical && cellAt(m, x - 1, y) !== 'floor') {
      rect(ctx, px + 6, py, 4, TILE, '#a08a6a');
    } else {
      rect(ctx, px, py + 6, TILE, 4, '#a08a6a');
    }
  }
}

// ——— Muebles ———

function shadow(ctx: Ctx, x: number, y: number, w: number) {
  ctx.fillStyle = 'rgba(20, 16, 30, 0.22)';
  ctx.fillRect(x + 2, y, w - 2, 3);
}

function plantLeaves(ctx: Ctx, cx: number, top: number, h: number, seed: number) {
  const greens = ['#3f7d4a', '#4f9a57', '#2f6339', '#5fae64'];
  for (let i = 0; i < 26; i++) {
    const a = hash(seed, i) * Math.PI * 2;
    const r = hash(i, seed) * 6;
    const lx = Math.round(cx + Math.cos(a) * r);
    const ly = Math.round(top + h / 2 + Math.sin(a) * (h / 2));
    rect(ctx, lx - 1, ly, 3, 2, greens[i % greens.length]!);
  }
}

/** Monitor sobre un escritorio: devuelve el rectángulo de la pantalla (lo anima la escena). */
export function monitorScreen(f: Furniture): { x: number; y: number; w: number; h: number } {
  const px = f.x * TILE;
  const py = f.y * TILE;
  return f.kind === 'boss-desk'
    ? { x: px + 16, y: py + 3, w: 16, h: 10 }
    : { x: px + 17, y: py + 2, w: 14, h: 10 };
}

const BOOK_COLORS = ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e', '#8064a2', '#e8a87c'];

function paintFurniture(ctx: Ctx, f: Furniture) {
  const px = f.x * TILE;
  const py = f.y * TILE;
  const w = f.w * TILE;
  const h = f.h * TILE;
  switch (f.kind) {
    case 'desk':
    case 'boss-desk': {
      const boss = f.kind === 'boss-desk';
      const top = boss ? '#7a4330' : '#b98a5a';
      const edge = boss ? '#5a2f21' : '#8c6239';
      const front = boss ? '#4a261b' : '#7a5532';
      shadow(ctx, px, py + h - 1, w);
      rect(ctx, px, py + 6, w, h - 14, top);
      rect(ctx, px, py + 6, w, 1, boss ? '#9a5a40' : '#cfa274');
      rect(ctx, px, py + h - 9, w, 1, edge);
      rect(ctx, px, py + h - 8, w, 6, front);
      rect(ctx, px + 2, py + h - 2, 2, 2, front);
      rect(ctx, px + w - 4, py + h - 2, 2, 2, front);
      if (boss) rect(ctx, px, py + h - 8, w, 1, '#c9a227');
      // Monitor
      const s = monitorScreen(f);
      rect(ctx, s.x - 1, s.y - 1, s.w + 2, s.h + 2, '#1f222a');
      rect(ctx, s.x, s.y, s.w, s.h, '#0f141d');
      rect(ctx, s.x + s.w / 2 - 1, s.y + s.h + 1, 2, 3, '#2a2e38');
      rect(ctx, s.x + s.w / 2 - 3, s.y + s.h + 3, 6, 1, '#2a2e38');
      // Teclado y taza
      rect(ctx, px + 18, py + 18, 12, 3, '#d9d9d9');
      rect(ctx, px + 18, py + 18, 12, 1, '#f0f0f0');
      const mug = ['#e85d5d', '#5d8de8', '#f2c14e', '#ffffff'][Math.floor(hash(f.x, f.y) * 4)]!;
      rect(ctx, px + 38, py + 13, 4, 4, mug);
      rect(ctx, px + 42, py + 14, 1, 2, mug);
      // Papeles
      rect(ctx, px + 4, py + 12, 8, 6, '#f4f1e8');
      rect(ctx, px + 5, py + 13, 6, 1, '#c7c2b5');
      rect(ctx, px + 5, py + 15, 5, 1, '#c7c2b5');
      return;
    }
    case 'plant':
    case 'tall-plant': {
      const tall = f.kind === 'tall-plant';
      shadow(ctx, px, py + h - 1, w);
      rect(ctx, px + 4, py + h - 7, 8, 6, '#a85b3b');
      rect(ctx, px + 4, py + h - 7, 8, 1, '#c26f4c');
      rect(ctx, px + 5, py + h - 1, 6, 1, '#7e4229');
      plantLeaves(ctx, px + 8, tall ? py - 14 : py - 2, tall ? 22 : 10, f.x * 31 + f.y);
      return;
    }
    case 'sofa': {
      const c = ['#5f7e9c', '#9c5f6f', '#6f9c5f'][f.variant ?? Math.floor(hash(f.x, f.y) * 3)]!;
      shadow(ctx, px, py + h, w);
      rect(ctx, px, py - 2, w, 8, c);
      rect(ctx, px, py - 2, w, 1, '#ffffff33');
      rect(ctx, px, py + 6, w, 9, c);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 1; i < f.w; i++) ctx.fillRect(px + i * TILE, py + 6, 1, 8);
      rect(ctx, px - 2, py + 2, 3, 12, c);
      rect(ctx, px + w - 1, py + 2, 3, 12, c);
      return;
    }
    case 'armchair': {
      shadow(ctx, px, py + h, w);
      rect(ctx, px + 1, py, 14, 6, '#8a4f3a');
      rect(ctx, px + 1, py + 6, 14, 8, '#a35e46');
      rect(ctx, px, py + 3, 2, 10, '#8a4f3a');
      rect(ctx, px + 14, py + 3, 2, 10, '#8a4f3a');
      return;
    }
    case 'side-table': {
      rect(ctx, px + 2, py + 4, w - 4, 8, '#8c6239');
      rect(ctx, px + 2, py + 4, w - 4, 1, '#b98a5a');
      rect(ctx, px + 6, py + 5, 4, 3, '#f2f2f2');
      return;
    }
    case 'meeting-table': {
      // Sillas alrededor
      for (let i = 0; i < 4; i++) {
        const cx = px + 12 + i * 32;
        rect(ctx, cx, py - 6, 10, 6, '#3d4458');
        rect(ctx, cx, py + h, 10, 6, '#3d4458');
        rect(ctx, cx, py + h + 5, 10, 1, '#2a3040');
      }
      shadow(ctx, px, py + h, w);
      rect(ctx, px, py, w, h - 6, '#8c6239');
      rect(ctx, px + 2, py + 2, w - 4, h - 10, '#a87a4c');
      rect(ctx, px, py + h - 6, w, 6, '#6e4a2e');
      rect(ctx, px + 30, py + 10, 10, 7, '#f4f1e8');
      rect(ctx, px + 90, py + 12, 14, 9, '#2b2f3a');
      rect(ctx, px + 91, py + 13, 12, 6, '#4e7ab5');
      return;
    }
    case 'counter': {
      rect(ctx, px, py, w, 6, '#e3ddd2');
      rect(ctx, px, py, w, 1, '#f3efe8');
      rect(ctx, px, py + 6, w, 10, '#b5aa98');
      for (let i = 0; i < f.w; i++) {
        rect(ctx, px + i * TILE + 1, py + 7, TILE - 2, 8, '#c3b9a8');
        rect(ctx, px + i * TILE + 7, py + 10, 2, 1, '#8e8473');
      }
      rect(ctx, px + 20, py + 1, 10, 4, '#9aa7b0');
      return;
    }
    case 'coffee-machine': {
      rect(ctx, px, py + 6, w, 10, '#b5aa98');
      rect(ctx, px + 2, py - 8, 12, 16, '#3a3a3f');
      rect(ctx, px + 2, py - 8, 12, 2, '#55555c');
      rect(ctx, px + 4, py - 4, 8, 5, '#1d1d21');
      rect(ctx, px + 11, py - 6, 2, 1, '#ff5a5a');
      rect(ctx, px + 6, py + 3, 4, 3, '#ffffff');
      return;
    }
    case 'fridge': {
      shadow(ctx, px, py + h, w);
      rect(ctx, px + 1, py - 8, 14, h + 8, '#e9ecef');
      rect(ctx, px + 1, py - 8, 14, 1, '#ffffff');
      rect(ctx, px + 1, py + 6, 14, 1, '#c9cdd2');
      rect(ctx, px + 12, py - 4, 1, 6, '#9aa0a8');
      rect(ctx, px + 12, py + 10, 1, 8, '#9aa0a8');
      return;
    }
    case 'bookshelf': {
      rect(ctx, px, py - 10, w, h + 10, '#6e4a2e');
      for (let shelf = 0; shelf < 2; shelf++) {
        const sy = py - 8 + shelf * 12;
        rect(ctx, px + 2, sy, w - 4, 9, '#4a3020');
        let bx = px + 3;
        while (bx < px + w - 4) {
          const bw = 2 + Math.floor(hash(bx, sy) * 2);
          const bh = 6 + Math.floor(hash(sy, bx) * 3);
          rect(ctx, bx, sy + 9 - bh, bw, bh, BOOK_COLORS[Math.floor(hash(bx, sy, 4) * BOOK_COLORS.length)]!);
          bx += bw + 1;
        }
      }
      return;
    }
    case 'cabinet': {
      rect(ctx, px + 1, py - 4, 14, h + 2, '#8c96a3');
      for (let i = 0; i < f.h * 2; i++) {
        rect(ctx, px + 2, py - 3 + i * 8, 12, 7, '#a2acb8');
        rect(ctx, px + 6, py + i * 8, 4, 1, '#5d6670');
      }
      return;
    }
    case 'server-rack': {
      rect(ctx, px + 1, py - 6, 14, h + 4, '#141925');
      rect(ctx, px + 1, py - 6, 14, 1, '#2a3245');
      for (let i = 0; i < 7; i++) {
        rect(ctx, px + 3, py - 4 + i * 5, 10, 3, '#1f2636');
        rect(ctx, px + 4 + (i % 3) * 3, py - 3 + i * 5, 1, 1, i % 2 ? '#4cd97b' : '#3fb6ff');
      }
      return;
    }
    case 'water-cooler': {
      rect(ctx, px + 4, py + 4, 8, 11, '#e1e6ea');
      rect(ctx, px + 5, py - 6, 6, 10, '#8fc6ee');
      rect(ctx, px + 5, py - 6, 2, 10, '#b4dcf6');
      return;
    }
    case 'rug': {
      rect(ctx, px, py, w, h, '#7c3f45');
      rect(ctx, px + 2, py + 2, w - 4, h - 4, '#93525a');
      ctx.fillStyle = '#b8786f';
      for (let i = 4; i < w - 4; i += 6) ctx.fillRect(px + i, py + 4, 2, 2);
      for (let i = 4; i < w - 4; i += 6) ctx.fillRect(px + i, py + h - 6, 2, 2);
      return;
    }
    case 'printer': {
      rect(ctx, px + 1, py, 14, 12, '#d4d8dd');
      rect(ctx, px + 1, py, 14, 3, '#b8bdc4');
      rect(ctx, px + 3, py - 2, 10, 3, '#ffffff');
      rect(ctx, px + 11, py + 6, 2, 1, '#4cd97b');
      return;
    }
    case 'radar-console': {
      shadow(ctx, px, py + h, w);
      rect(ctx, px, py + 4, w, h - 4, '#1d2433');
      rect(ctx, px, py + 4, w, 1, '#323d55');
      rect(ctx, px + 2, py + h - 8, w - 4, 4, '#141a26');
      for (let i = 0; i < 6; i++) rect(ctx, px + 4 + i * 6, py + h - 7, 3, 2, i % 2 ? '#ffb347' : '#3fb6ff');
      return;
    }
    case 'pinboard-map': {
      rect(ctx, px, py, w, h, '#6e4a2e');
      rect(ctx, px + 2, py + 2, w - 4, h - 4, '#c59a6b');
      // Mapa del mundo esquemático
      const land = '#7a9f6a';
      rect(ctx, px + 6, py + 6, 12, 8, land);
      rect(ctx, px + 12, py + 14, 6, 10, land);
      rect(ctx, px + 26, py + 5, 10, 6, land);
      rect(ctx, px + 28, py + 11, 8, 12, land);
      rect(ctx, px + 40, py + 6, 16, 8, land);
      rect(ctx, px + 50, py + 18, 8, 5, land);
      return;
    }
    case 'reception': {
      shadow(ctx, px, py + h, w);
      rect(ctx, px, py + 2, w, 8, '#e3ddd2');
      rect(ctx, px, py + 10, w, h - 10, '#3d5671');
      rect(ctx, px, py + 10, w, 1, '#f2c14e');
      rect(ctx, px + 8, py - 2, 12, 6, '#2b2f3a');
      rect(ctx, px + 70, py + 1, 6, 5, '#5fae64');
      return;
    }
    case 'chair':
      return; // la escena dibuja las sillas por encima de los personajes
  }
}

let NIGHT = true;

export function paintOffice(m: OfficeMap, night = true): HTMLCanvasElement {
  NIGHT = night;
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_W;
  canvas.height = WORLD_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = m.cells[y * MAP_W + x];
      if (c === 'floor') FLOOR[m.floors[y * MAP_W + x]!](ctx, x * TILE, y * TILE, x, y);
      else paintWall(ctx, m, x, y);
    }
  }
  // Sombra de contacto bajo paredes que dan al piso.
  ctx.fillStyle = 'rgba(20, 16, 30, 0.18)';
  for (let y = 0; y < MAP_H - 1; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = m.cells[y * MAP_W + x];
      if ((c === 'face' || c === 'wall') && m.cells[(y + 1) * MAP_W + x] === 'floor') ctx.fillRect(x * TILE, (y + 1) * TILE, TILE, 3);
    }
  }
  // Muebles de arriba hacia abajo para que se superpongan bien.
  const sorted = [...m.furniture].sort((a, b) => (a.kind === 'rug' ? -1 : b.kind === 'rug' ? 1 : a.y + a.h - (b.y + b.h)));
  for (const f of sorted) paintFurniture(ctx, f);
  return canvas;
}
