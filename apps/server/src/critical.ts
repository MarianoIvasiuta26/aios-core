import type Database from 'better-sqlite3';
import { isOpen, type WorkspaceState } from '@office/shared';
import type { TaskStore } from './tasks.ts';

/**
 * Un hallazgo Crítico abierto pasa a "Bloqueada" la tarjeta relacionada (la de su campo `tarjeta` o
 * cualquiera con `related = SEC-n`). Cada par hallazgo↔tarjeta se bloquea una sola vez: si alguien la
 * desbloquea para trabajar en el arreglo, no se vuelve a bloquear.
 */
export function createCriticalAutomation(db: Database.Database, tasks: TaskStore) {
  db.exec(`CREATE TABLE IF NOT EXISTS critical_blocks (
    finding TEXT NOT NULL,
    task_id TEXT NOT NULL,
    at      INTEGER NOT NULL,
    PRIMARY KEY (finding, task_id)
  )`);
  const mark = db.prepare('INSERT OR IGNORE INTO critical_blocks (finding, task_id, at) VALUES (?, ?, ?)');
  let running = false;

  return function check(workspaces: Iterable<WorkspaceState>, now = Date.now()) {
    // Mover una tarjeta dispara de nuevo el chequeo (vía onChange del tablero): se ignora esa vuelta.
    if (running) return;
    running = true;
    try {
      const all = tasks.list();
      for (const ws of workspaces) {
        for (const f of ws.findings?.findings ?? []) {
          if (f.severity !== 'Crítica' || !isOpen(f)) continue;
          const id = f.id.toUpperCase();
          const targets = all.filter((t) => t.id === f.task || t.related?.toUpperCase() === id);
          for (const t of targets) {
            if (mark.run(id, t.id, now).changes === 0) continue;
            if (t.column === 'bloqueada' || t.column === 'hecha') continue;
            tasks.update(t.id, { column: 'bloqueada', actor: f.auditor ?? 'sistema', note: `Hallazgo crítico ${f.id}: ${f.title}` }, now);
          }
        }
      }
    } finally {
      running = false;
    }
  };
}
