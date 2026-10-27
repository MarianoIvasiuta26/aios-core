import { describe, expect, it } from 'vitest';
import type { Task } from '@office/shared';
import { byColumn, dropPosition, matches, positionBetween, EMPTY_FILTERS } from '../src/board/logic.ts';

const t = (id: string, position: number, extra: Partial<Task> = {}): Task => ({
  id, title: id, description: '', team: null, assignee: null, priority: 'P2', labels: [], related: null,
  column: 'backlog', position, createdAt: 0, startedAt: null, closedAt: null, updatedAt: 0, ...extra,
});

describe('posiciones', () => {
  it('entre vecinos y en extremos', () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(2048, null)).toBe(3072);
    expect(positionBetween(null, null)).toBe(1024);
  });

  it('drop dentro de la misma columna ignora la tarjeta arrastrada', () => {
    const list = [t('a', 1024), t('b', 2048), t('c', 3072)];
    expect(dropPosition(list, 'a', 2)).toBe(4096); // a al final
    expect(dropPosition(list, 'c', 0)).toBe(0); // c al principio
    expect(dropPosition(list, 'a', 1)).toBe(2560); // a entre b y c
  });
});

describe('filtros', () => {
  const task = t('T-1', 1, { title: 'Login', assignee: 'backend', team: 'ingenieria', priority: 'P1', labels: ['auth'], related: 'HU-12' });
  it.each([
    [{ team: 'ingenieria' }, true],
    [{ team: 'qa' }, false],
    [{ assignee: 'backend' }, true],
    [{ assignee: '-' }, false],
    [{ priority: 'P1' }, true],
    [{ label: 'auth' }, true],
    [{ label: 'x' }, false],
    [{ text: 'hu-12' }, true],
    [{ text: 'Backend' }, true],
    [{ text: 'nada' }, false],
  ])('%o → %s', (f, expected) => {
    expect(matches(task, { ...EMPTY_FILTERS, ...f })).toBe(expected);
  });

  it('agrupa por columna ordenado por posición', () => {
    const g = byColumn([t('b', 2), t('a', 1), t('c', 1, { column: 'hecha' })]);
    expect(g.backlog.map((x) => x.id)).toEqual(['a', 'b']);
    expect(g.hecha.map((x) => x.id)).toEqual(['c']);
  });
});
