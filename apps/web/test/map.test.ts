import { describe, expect, it } from 'vitest';
import { AGENTS } from '@office/shared';
import { buildOfficeMap, MAP_H, MAP_W } from '../src/office/map.ts';

const map = buildOfficeMap();

/** BFS desde la entrada sobre los tiles caminables. */
function reachable(): Set<number> {
  const start = map.pois.entrance.y * MAP_W + map.pois.entrance.x;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const i = queue.shift()!;
    const x = i % MAP_W;
    const y = Math.floor(i / MAP_W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const j = ny * MAP_W + nx;
      if (!seen.has(j) && map.walkable[j]) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen;
}

describe('plano de la oficina', () => {
  const reach = reachable();

  it('tiene un escritorio por cada uno de los 16 personajes', () => {
    expect(map.desks.map((d) => d.agent).sort()).toEqual(AGENTS.map((a) => a.id).sort());
  });

  it('desde la entrada se llega a todos los escritorios y puntos de interés', () => {
    for (const d of map.desks) expect(reach.has(d.seat.y * MAP_W + d.seat.x), `asiento de ${d.agent}`).toBe(true);
    for (const [name, p] of Object.entries(map.pois)) expect(reach.has(p.y * MAP_W + p.x), `punto ${name}`).toBe(true);
  });

  it('los muebles no se superponen con paredes', () => {
    for (const f of map.furniture) {
      if (!f.solid) continue;
      for (let y = f.y; y < f.y + f.h; y++)
        for (let x = f.x; x < f.x + f.w; x++) expect(map.cells[y * MAP_W + x], `${f.kind} en ${x},${y}`).toBe('floor');
    }
  });
});
