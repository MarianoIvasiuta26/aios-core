import { COLUMNS, type Column } from '@office/shared';
import { MAP_H, MAP_W, type OfficeMap } from './map.ts';

export interface Tile {
  x: number;
  y: number;
}

/** A* en 4 direcciones. Devuelve los tiles desde el siguiente al origen hasta el destino (vacío si ya está o no hay camino). */
export function findPath(walkable: readonly boolean[], from: Tile, to: Tile, blocked?: ReadonlySet<number>): Tile[] {
  const start = from.y * MAP_W + from.x;
  const goal = to.y * MAP_W + to.x;
  if (start === goal) return [];
  const passable = (i: number) => i === goal || i === start || (walkable[i] === true && !blocked?.has(i));
  if (!passable(goal)) return [];

  const h = (i: number) => Math.abs((i % MAP_W) - to.x) + Math.abs(Math.floor(i / MAP_W) - to.y);
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  // Cola de prioridad simple sobre un array ordenado por inserción binaria (grilla chica).
  const open: Array<[f: number, i: number]> = [[h(start), start]];
  const closed = new Set<number>();

  while (open.length > 0) {
    const [, cur] = open.shift()!;
    if (cur === goal) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % MAP_W;
    const cy = Math.floor(cur / MAP_W);
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const n = ny * MAP_W + nx;
      if (closed.has(n) || !passable(n)) continue;
      const ng = g.get(cur)! + 1;
      if (ng >= (g.get(n) ?? Infinity)) continue;
      g.set(n, ng);
      came.set(n, cur);
      const f = ng + h(n);
      let lo = 0;
      let hi = open.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (open[mid]![0] <= f) lo = mid + 1;
        else hi = mid;
      }
      open.splice(lo, 0, [f, n]);
    }
  }
  if (!came.has(goal)) return [];
  const path: Tile[] = [];
  for (let i: number | undefined = goal; i !== undefined && i !== start; i = came.get(i)) {
    path.push({ x: i % MAP_W, y: Math.floor(i / MAP_W) });
  }
  return path.reverse();
}

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface Spot extends Tile {
  facing: Facing;
}

/** Lugares de la oficina a donde van los personajes. */
export function createPlaces(map: OfficeMap) {
  const seats = new Map(map.desks.map((d) => [d.agent, d.seat]));
  const seatTiles = new Set(map.desks.map((d) => d.seat.y * MAP_W + d.seat.x));

  const cafe = map.zones.find((z) => z.id === 'cafe')!.rect;
  const cafeSpots: Spot[] = [];
  // Separados lo suficiente para que no se pisen los nombres; filas alternadas.
  for (let y = cafe.y + 3, row = 0; y < cafe.y + cafe.h - 1; y += 2, row++) {
    for (let x = cafe.x + 1 + (row % 2) * 2; x < cafe.x + cafe.w - 1; x += 4) {
      if (map.walkable[y * MAP_W + x]) cafeSpots.push({ x, y, facing: 'down' });
    }
  }

  const board = map.wallProps.find((p) => p.kind === 'task-board')!.rect;
  const meeting = [
    { x: 19, y: 10 },
    { x: 21, y: 10 },
    { x: 23, y: 10 },
    { x: 25, y: 10 },
    { x: 20, y: 4 },
    { x: 24, y: 4 },
  ];

  return {
    seatTiles,
    /** Escritorio del agente (los visitantes usan la sala de reuniones). */
    home(agent: string): Spot {
      const s = seats.get(agent);
      return s ? { ...s, facing: 'up' } : { x: 22, y: 10, facing: 'up' };
    },
    hasDesk: (agent: string) => seats.has(agent),
    /** Lugar fijo en el café por agente, para que no se amontonen. */
    coffee(agent: string): Spot {
      const i = [...map.desks.map((d) => d.agent), 'visitante'].indexOf(agent);
      return cafeSpots[(i < 0 ? 0 : i) % cafeSpots.length]!;
    },
    /** Frente a la columna del tablero central donde va la tarjeta. */
    board(column: Column | undefined): Spot {
      const ci = Math.max(0, COLUMNS.indexOf(column ?? 'en-curso'));
      const colW = board.w / COLUMNS.length;
      return { x: Math.round(board.x + colW * (ci + 0.5)), y: board.y + board.h + 1, facing: 'up' };
    },
    meeting(i: number): Spot {
      const m = meeting[i % meeting.length]!;
      return { ...m, facing: m.y > 6 ? 'up' : 'down' };
    },
    door: { ...map.pois.entrance, facing: 'down' as Facing },
    bossIdle: { x: 7, y: 11, facing: 'down' as Facing },
    /** Puerta de la oficina del jefe: ahí se le reporta. */
    bossDoor: { ...map.pois.bossDoor, facing: 'up' as Facing },
  };
}

export type Places = ReturnType<typeof createPlaces>;
