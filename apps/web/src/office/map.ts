/**
 * Plano de la oficina en tiles de 16 px. Todo se define acá: zonas, paredes, puertas,
 * muebles y escritorios. El pintor (paint.ts) y la escena (scene.ts) solo leen este plano.
 */

export const TILE = 16;
export const MAP_W = 80;
export const MAP_H = 50;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export type Floor = 'pasillo' | 'madera' | 'alfombra' | 'alfombra-azul' | 'cocina' | 'soc' | 'lab' | 'lobby' | 'comercial';

/** cap = tapa de pared (vista desde arriba), face = frente de pared visible. */
export type Cell = 'floor' | 'wall' | 'face' | 'window' | 'glass' | 'door';

export type ZoneId =
  | 'jefe'
  | 'reuniones'
  | 'tablero'
  | 'producto'
  | 'ingenieria'
  | 'qa'
  | 'soc'
  | 'comercial'
  | 'cafe'
  | 'lobby';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone {
  id: ZoneId;
  name: string;
  rect: Rect;
  floor: Floor;
  /** Dónde va el cartel con el nombre (tile). */
  sign: { x: number; y: number };
}

export type FurnitureKind =
  | 'desk'
  | 'boss-desk'
  | 'chair'
  | 'plant'
  | 'tall-plant'
  | 'sofa'
  | 'meeting-table'
  | 'counter'
  | 'coffee-machine'
  | 'fridge'
  | 'bookshelf'
  | 'cabinet'
  | 'server-rack'
  | 'water-cooler'
  | 'rug'
  | 'printer'
  | 'radar-console'
  | 'pinboard-map'
  | 'armchair'
  | 'side-table'
  | 'reception';

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bloquea el paso (para la caminata de la fase 4). */
  solid: boolean;
  variant?: number;
}

/** Elementos montados en paredes; se dibujan en la capa dinámica porque se animan. */
export type WallPropKind = 'task-board' | 'backlog-board' | 'whiteboard' | 'funnel' | 'chart-wall' | 'traffic-light' | 'screen-wall' | 'window-view';

export interface WallProp {
  kind: WallPropKind;
  rect: Rect;
  zone: ZoneId;
}

export interface Desk {
  agent: string;
  /** Tile donde se sienta (mirando hacia arriba, al monitor). */
  seat: { x: number; y: number };
  zone: ZoneId;
}

export interface OfficeMap {
  cells: Cell[];
  floors: Floor[];
  zoneOf: (ZoneId | null)[];
  zones: Zone[];
  furniture: Furniture[];
  wallProps: WallProp[];
  desks: Desk[];
  pois: Record<'entrance' | 'coffee' | 'board' | 'bossDoor' | 'meeting', { x: number; y: number }>;
  /** true si el tile se puede caminar. */
  walkable: boolean[];
}

const idx = (x: number, y: number) => y * MAP_W + x;

interface RoomSpec {
  rect: Rect;
  /** Puertas sobre el perímetro: lado y tile de inicio (2 de ancho). */
  doors?: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; at: number; len?: number }>;
  /** Filas de frente de pared debajo de la pared superior (paredes altas para colgar cosas). */
  tallTop?: number;
  glassSides?: Array<'right' | 'bottom'>;
}

export function buildOfficeMap(): OfficeMap {
  const cells: Cell[] = new Array(MAP_W * MAP_H).fill('floor');
  const floors: Floor[] = new Array(MAP_W * MAP_H).fill('pasillo');
  const zoneOf: (ZoneId | null)[] = new Array(MAP_W * MAP_H).fill(null);

  const set = (x: number, y: number, c: Cell) => {
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) cells[idx(x, y)] = c;
  };
  const fill = (r: Rect, fn: (x: number, y: number) => void) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) fn(x, y);
  };

  const zones: Zone[] = [
    { id: 'jefe', name: 'Oficina del jefe', rect: { x: 1, y: 1, w: 13, h: 12 }, floor: 'madera', sign: { x: 7, y: 12 } },
    { id: 'reuniones', name: 'Sala de reuniones', rect: { x: 15, y: 1, w: 15, h: 12 }, floor: 'alfombra', sign: { x: 22, y: 12 } },
    { id: 'tablero', name: 'Tablero central', rect: { x: 31, y: 1, w: 22, h: 13 }, floor: 'pasillo', sign: { x: 42, y: 12 } },
    { id: 'comercial', name: 'Comercial', rect: { x: 55, y: 1, w: 24, h: 21 }, floor: 'comercial', sign: { x: 72, y: 21 } },
    { id: 'producto', name: 'Producto', rect: { x: 1, y: 18, w: 13, h: 12 }, floor: 'madera', sign: { x: 7, y: 29 } },
    { id: 'cafe', name: 'Café', rect: { x: 1, y: 31, w: 13, h: 18 }, floor: 'cocina', sign: { x: 7, y: 47 } },
    { id: 'ingenieria', name: 'Ingeniería', rect: { x: 16, y: 17, w: 29, h: 20 }, floor: 'alfombra-azul', sign: { x: 30, y: 36 } },
    { id: 'qa', name: 'Laboratorio de QA', rect: { x: 47, y: 23, w: 12, h: 14 }, floor: 'lab', sign: { x: 53, y: 36 } },
    { id: 'soc', name: 'SOC', rect: { x: 61, y: 23, w: 18, h: 26 }, floor: 'soc', sign: { x: 70, y: 47 } },
    { id: 'lobby', name: 'Entrada', rect: { x: 15, y: 39, w: 45, h: 10 }, floor: 'lobby', sign: { x: 38, y: 47 } },
  ];

  for (const z of zones) {
    fill(z.rect, (x, y) => {
      floors[idx(x, y)] = z.floor;
      zoneOf[idx(x, y)] = z.id;
    });
  }

  // Paredes exteriores: la superior es doble (tapa + frente).
  fill({ x: 0, y: 0, w: MAP_W, h: 1 }, (x, y) => set(x, y, 'wall'));
  fill({ x: 0, y: 1, w: MAP_W, h: 1 }, (x, y) => set(x, y, 'face'));
  fill({ x: 0, y: MAP_H - 1, w: MAP_W, h: 1 }, (x, y) => set(x, y, 'wall'));
  fill({ x: 0, y: 0, w: 1, h: MAP_H }, (x, y) => set(x, y, 'wall'));
  fill({ x: MAP_W - 1, y: 0, w: 1, h: MAP_H }, (x, y) => set(x, y, 'wall'));
  // Puerta de entrada.
  fill({ x: 36, y: MAP_H - 1, w: 4, h: 1 }, (x, y) => set(x, y, 'door'));

  const room = (spec: RoomSpec) => {
    const { x, y, w, h } = spec.rect;
    for (let i = x; i < x + w; i++) {
      set(i, y, cells[idx(i, y)] === 'face' ? 'face' : 'wall');
      set(i, y + h - 1, spec.glassSides?.includes('bottom') ? 'glass' : 'face');
    }
    for (let j = y; j < y + h; j++) {
      set(x, j, 'wall');
      set(x + w - 1, j, spec.glassSides?.includes('right') ? 'glass' : 'wall');
    }
    // El tile inferior de una pared vertical se ve de frente.
    if (!spec.glassSides?.includes('bottom')) {
      set(x, y + h - 1, 'face');
      set(x + w - 1, y + h - 1, spec.glassSides?.includes('right') ? 'glass' : 'face');
    }
    for (let k = 1; k <= (spec.tallTop ?? 0); k++) for (let i = x + 1; i < x + w - 1; i++) set(i, y + k, 'face');
    for (const d of spec.doors ?? []) {
      const len = d.len ?? 2;
      for (let k = 0; k < len; k++) {
        if (d.side === 'top') set(d.at + k, y, 'door');
        if (d.side === 'bottom') set(d.at + k, y + h - 1, 'door');
        if (d.side === 'left') set(x, d.at + k, 'door');
        if (d.side === 'right') set(x + w - 1, d.at + k, 'door');
      }
    }
  };

  // Habitaciones (el perímetro es pared).
  room({ rect: { x: 0, y: 0, w: 15, h: 14 }, doors: [{ side: 'bottom', at: 10 }], tallTop: 2 });
  room({ rect: { x: 14, y: 0, w: 17, h: 14 }, doors: [{ side: 'bottom', at: 21 }], tallTop: 2 });
  room({ rect: { x: 54, y: 0, w: 26, h: 23 }, doors: [{ side: 'left', at: 15 }], tallTop: 2 });
  room({ rect: { x: 0, y: 17, w: 15, h: 14 }, doors: [{ side: 'right', at: 22 }], tallTop: 1 });
  room({ rect: { x: 0, y: 30, w: 15, h: 20 }, doors: [{ side: 'right', at: 37 }, { side: 'right', at: 33 }], tallTop: 1 });
  room({ rect: { x: 46, y: 22, w: 14, h: 16 }, doors: [{ side: 'left', at: 30 }, { side: 'bottom', at: 52 }], tallTop: 1 });
  room({ rect: { x: 60, y: 22, w: 20, h: 28 }, doors: [{ side: 'left', at: 40 }], tallTop: 2 });
  // Oficina vidriada del gerente dentro de Comercial.
  room({ rect: { x: 54, y: 0, w: 13, h: 12 }, doors: [{ side: 'bottom', at: 59 }], glassSides: ['right', 'bottom'], tallTop: 2 });
  // Pared alta del tablero central.
  for (let k = 2; k <= 6; k++) for (let i = 31; i < 54; i++) set(i, k, 'face');
  // Ventanal del jefe y vista nocturna.
  for (let i = 3; i <= 11; i++) for (let k = 1; k <= 2; k++) set(i, k, 'window');

  const furniture: Furniture[] = [];
  const add = (kind: FurnitureKind, x: number, y: number, w: number, h: number, solid = true, variant?: number) =>
    furniture.push({ kind, x, y, w, h, solid, variant });

  const desks: Desk[] = [];
  /** Escritorio de 3×2 con el asiento debajo, al centro. */
  const desk = (agent: string, zone: ZoneId, sx: number, sy: number, kind: FurnitureKind = 'desk') => {
    add(kind, sx - 1, sy - 2, 3, 2);
    add('chair', sx, sy, 1, 1, false);
    desks.push({ agent, zone, seat: { x: sx, y: sy } });
  };

  // Jefe
  add('rug', 3, 6, 9, 5, false);
  desk('jefe', 'jefe', 7, 7, 'boss-desk');
  add('bookshelf', 1, 3, 2, 1);
  add('bookshelf', 12, 3, 2, 1);
  add('tall-plant', 1, 11, 1, 1);
  add('armchair', 5, 10, 1, 1);
  add('armchair', 9, 10, 1, 1);
  add('side-table', 7, 10, 1, 1);

  // Reuniones
  add('meeting-table', 18, 6, 9, 3);
  add('plant', 15, 3, 1, 1);
  add('plant', 29, 11, 1, 1);
  add('water-cooler', 29, 3, 1, 1);

  // Tablero central
  add('plant', 31, 12, 1, 1);
  add('plant', 52, 12, 1, 1);
  add('armchair', 33, 11, 1, 1);
  add('armchair', 50, 11, 1, 1);

  // Producto
  desk('product-owner', 'producto', 7, 25);
  add('cabinet', 1, 20, 1, 2);
  add('plant', 12, 28, 1, 1);
  add('bookshelf', 11, 20, 2, 1);

  // Café
  add('coffee-machine', 2, 32, 1, 1);
  add('counter', 3, 32, 4, 1);
  add('fridge', 8, 32, 1, 2);
  add('sofa', 2, 44, 4, 1);
  add('sofa', 8, 44, 4, 1);
  add('side-table', 6, 42, 2, 1);
  add('tall-plant', 13, 47, 1, 1);
  add('rug', 2, 39, 10, 4, false);

  // Ingeniería (open space)
  desk('arquitecto', 'ingenieria', 21, 23);
  desk('backend', 'ingenieria', 27, 23);
  desk('devops', 'ingenieria', 33, 23);
  desk('reviewer', 'ingenieria', 24, 31);
  desk('docs', 'ingenieria', 30, 31);
  add('bookshelf', 40, 18, 2, 1);
  add('printer', 43, 18, 1, 1);
  add('tall-plant', 16, 17, 1, 1);
  add('tall-plant', 44, 35, 1, 1);
  add('plant', 38, 28, 1, 1);
  add('sofa', 38, 33, 4, 1, true, 0);
  add('side-table', 39, 31, 2, 1);
  add('cabinet', 16, 26, 1, 2);
  add('water-cooler', 44, 26, 1, 1);

  // QA
  desk('qa-unit', 'qa', 50, 29);
  desk('qa-e2e', 'qa', 55, 29);
  add('cabinet', 47, 33, 1, 2);
  add('plant', 58, 35, 1, 1);

  // SOC
  desk('sec-appsec', 'soc', 65, 31);
  desk('sec-cloud', 'soc', 70, 31);
  desk('sec-supply-chain', 'soc', 75, 31);
  desk('sec-compliance', 'soc', 70, 41);
  add('radar-console', 63, 38, 3, 3);
  add('server-rack', 77, 37, 1, 2);
  add('server-rack', 77, 40, 1, 2);
  add('server-rack', 77, 43, 1, 2);

  // Comercial
  desk('gerente-ventas', 'comercial', 60, 7);
  add('plant', 55, 3, 1, 1);
  desk('analista-mercado', 'comercial', 72, 7);
  desk('prospector', 'comercial', 70, 18);
  add('pinboard-map', 74, 13, 4, 2);
  add('tall-plant', 77, 20, 1, 1);
  add('sofa', 57, 19, 4, 1);

  // Entrada
  add('reception', 33, 42, 6, 2);
  add('tall-plant', 15, 39, 1, 1);
  add('tall-plant', 58, 47, 1, 1);
  add('plant', 30, 47, 1, 1);
  add('plant', 43, 47, 1, 1);
  add('sofa', 18, 44, 4, 1, true, 1);
  add('armchair', 23, 42, 1, 1);
  add('sofa', 50, 44, 4, 1, true, 2);
  add('armchair', 48, 42, 1, 1);
  add('rug', 17, 41, 8, 5, false);

  const wallProps: WallProp[] = [
    { kind: 'window-view', rect: { x: 3, y: 1, w: 9, h: 2 }, zone: 'jefe' },
    { kind: 'whiteboard', rect: { x: 18, y: 1, w: 9, h: 2 }, zone: 'reuniones' },
    { kind: 'task-board', rect: { x: 32, y: 1, w: 21, h: 6 }, zone: 'tablero' },
    { kind: 'funnel', rect: { x: 56, y: 1, w: 9, h: 2 }, zone: 'comercial' },
    { kind: 'chart-wall', rect: { x: 68, y: 1, w: 9, h: 2 }, zone: 'comercial' },
    { kind: 'backlog-board', rect: { x: 3, y: 18, w: 8, h: 1 }, zone: 'producto' },
    { kind: 'traffic-light', rect: { x: 52, y: 23, w: 2, h: 1 }, zone: 'qa' },
    { kind: 'screen-wall', rect: { x: 62, y: 23, w: 16, h: 2 }, zone: 'soc' },
  ];

  const walkable = cells.map((c) => c === 'floor' || c === 'door');
  for (const f of furniture) {
    if (!f.solid) continue;
    fill({ x: f.x, y: f.y, w: f.w, h: f.h }, (x, y) => (walkable[idx(x, y)] = false));
  }

  return {
    cells,
    floors,
    zoneOf,
    zones,
    furniture,
    wallProps,
    desks,
    walkable,
    pois: {
      entrance: { x: 37, y: 48 },
      coffee: { x: 2, y: 33 },
      board: { x: 42, y: 9 },
      bossDoor: { x: 10, y: 14 },
      meeting: { x: 22, y: 10 },
    },
  };
}

export const cellAt = (m: OfficeMap, x: number, y: number): Cell =>
  x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 'wall' : m.cells[idx(x, y)]!;
