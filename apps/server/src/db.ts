import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventKind, EventStatus, OfficeEvent, SessionInfo, Team } from '@office/shared';
import type { NormalizedEvent } from './normalize.ts';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  cwd           TEXT,
  model         TEXT,
  started_at    INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL,
  ended_at      INTEGER,
  last_prompt   TEXT,
  source        TEXT NOT NULL DEFAULT 'hook'
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,
  agent_name   TEXT NOT NULL,
  agent_type   TEXT,
  team         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  tool         TEXT,
  summary      TEXT NOT NULL,
  target       TEXT,
  tool_use_id  TEXT,
  timestamp    INTEGER NOT NULL,
  status       TEXT NOT NULL,
  duration_ms  INTEGER,
  cwd          TEXT,
  raw          TEXT
);
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS events_agent ON events(agent_id, timestamp);

CREATE TABLE IF NOT EXISTS agent_runs (
  agent_id    TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_name  TEXT NOT NULL,
  agent_type  TEXT,
  task_id     TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  tool_calls  INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0
);
`;

interface EventRow {
  id: number;
  session_id: string;
  agent_id: string;
  agent_name: string;
  agent_type: string | null;
  team: string;
  kind: string;
  tool: string | null;
  summary: string;
  target: string | null;
  tool_use_id: string | null;
  timestamp: number;
  status: string;
  duration_ms: number | null;
  cwd: string | null;
}

interface SessionRow {
  id: string;
  cwd: string | null;
  model: string | null;
  started_at: number;
  last_event_at: number;
  ended_at: number | null;
  last_prompt: string | null;
  source: string;
}

export interface AgentRun {
  agentId: string;
  sessionId: string;
  agentName: string;
  agentType: string | null;
  taskId: string | null;
  startedAt: number;
  endedAt: number | null;
  toolCalls: number;
  errors: number;
}

function toEvent(r: EventRow): OfficeEvent {
  return {
    id: r.id,
    sessionId: r.session_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    agentType: r.agent_type,
    team: r.team as Team,
    kind: r.kind as EventKind,
    tool: r.tool,
    summary: r.summary,
    target: r.target,
    toolUseId: r.tool_use_id,
    timestamp: r.timestamp,
    status: r.status as EventStatus,
    durationMs: r.duration_ms,
    cwd: r.cwd,
  };
}

function toSession(r: SessionRow): SessionInfo {
  return {
    id: r.id,
    cwd: r.cwd,
    model: r.model,
    startedAt: r.started_at,
    lastEventAt: r.last_event_at,
    endedAt: r.ended_at,
    lastPrompt: r.last_prompt,
    source: r.source === 'demo' ? 'demo' : 'hook',
  };
}

export type OfficeDb = ReturnType<typeof openDb>;

export function openDb(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(SCHEMA);

  const upsertSession = db.prepare(`
    INSERT INTO sessions (id, cwd, started_at, last_event_at, source)
    VALUES (@id, @cwd, @ts, @ts, @source)
    ON CONFLICT(id) DO UPDATE SET
      last_event_at = max(last_event_at, excluded.last_event_at),
      cwd = coalesce(sessions.cwd, excluded.cwd)`);
  const insertEvent = db.prepare(`
    INSERT INTO events (session_id, agent_id, agent_name, agent_type, team, kind, tool, summary, target,
                        tool_use_id, timestamp, status, duration_ms, cwd, raw)
    VALUES (@sessionId, @agentId, @agentName, @agentType, @team, @kind, @tool, @summary, @target,
            @toolUseId, @timestamp, @status, @durationMs, @cwd, @raw)`);
  const startRun = db.prepare(`
    INSERT INTO agent_runs (agent_id, session_id, agent_name, agent_type, started_at)
    VALUES (@agentId, @sessionId, @agentName, @agentType, @timestamp)
    ON CONFLICT(agent_id) DO NOTHING`);

  const insertTx = db.transaction((e: NormalizedEvent, raw: string | null, source: 'hook' | 'demo') => {
    upsertSession.run({ id: e.sessionId, cwd: e.cwd, ts: e.timestamp, source });
    if (e.kind === 'session_start') {
      db.prepare('UPDATE sessions SET ended_at = NULL WHERE id = ?').run(e.sessionId);
    }
    if (e.kind === 'session_end') {
      db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(e.timestamp, e.sessionId);
    }
    if (e.kind === 'prompt' && e.target) {
      db.prepare('UPDATE sessions SET last_prompt = ? WHERE id = ?').run(e.target, e.sessionId);
    }
    if (e.agentId !== e.sessionId) {
      startRun.run(e);
      if (e.kind === 'agent_stop') {
        db.prepare('UPDATE agent_runs SET ended_at = ? WHERE agent_id = ?').run(e.timestamp, e.agentId);
      } else if (e.kind === 'tool_start' || e.kind === 'task_move') {
        db.prepare('UPDATE agent_runs SET tool_calls = tool_calls + 1 WHERE agent_id = ?').run(e.agentId);
      } else if (e.kind === 'tool_error') {
        db.prepare('UPDATE agent_runs SET errors = errors + 1 WHERE agent_id = ?').run(e.agentId);
      }
    }
    const info = insertEvent.run({ ...e, raw });
    return Number(info.lastInsertRowid);
  });

  return {
    raw: db,
    insertEvent(e: NormalizedEvent, raw: string | null, source: 'hook' | 'demo' = 'hook'): OfficeEvent {
      const id = insertTx(e, raw, source);
      return { ...e, id };
    },
    setSessionModel(id: string, model: string) {
      db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, id);
    },
    getSession(id: string): SessionInfo | null {
      const r = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
      return r ? toSession(r) : null;
    },
    listSessions(): SessionInfo[] {
      return (db.prepare('SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT 100').all() as SessionRow[]).map(
        toSession,
      );
    },
    sessionEvents(sessionId: string, limit = 500): OfficeEvent[] {
      const rows = db
        .prepare('SELECT * FROM (SELECT * FROM events WHERE session_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?) ORDER BY timestamp, id')
        .all(sessionId, limit) as EventRow[];
      return rows.map(toEvent);
    },
    agentHistory(agentId: string, limit = 200): OfficeEvent[] {
      const rows = db
        .prepare('SELECT * FROM (SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?) ORDER BY timestamp, id')
        .all(agentId, limit) as EventRow[];
      return rows.map(toEvent);
    },
    sessionRuns(sessionId: string): AgentRun[] {
      return db
        .prepare(
          `SELECT agent_id agentId, session_id sessionId, agent_name agentName, agent_type agentType, task_id taskId,
                  started_at startedAt, ended_at endedAt, tool_calls toolCalls, errors
           FROM agent_runs WHERE session_id = ? ORDER BY started_at`,
        )
        .all(sessionId) as AgentRun[];
    },
    getRun(agentId: string): AgentRun | null {
      return (
        (db
          .prepare(
            `SELECT agent_id agentId, session_id sessionId, agent_name agentName, agent_type agentType, task_id taskId,
                    started_at startedAt, ended_at endedAt, tool_calls toolCalls, errors
             FROM agent_runs WHERE agent_id = ?`,
          )
          .get(agentId) as AgentRun | undefined) ?? null
      );
    },
    setRunTask(agentId: string, taskId: string) {
      db.prepare('UPDATE agent_runs SET task_id = ? WHERE agent_id = ?').run(taskId, agentId);
    },
    deleteSession(id: string) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },
    close() {
      db.close();
    },
  };
}
