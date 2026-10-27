import { BOSS_ID, VISITOR_ID, type OfficeEvent } from '@office/shared';
import { Actor, type BubbleTone, type Step } from './actor.ts';
import { IDLE_AFTER_MS, interpret, MIN_SHOW_MS, reduceAgents, type Activity } from './behavior.ts';
import { MAP_W } from './map.ts';
import type { ScreenMode } from './monitor.ts';
import { findPath, type Places, type Tile } from './pathfind.ts';

type Where = 'away' | 'desk' | 'cafe' | 'elsewhere';

interface AgentState {
  actor: Actor;
  where: Where;
  finished: boolean;
  /** Actividad mostrada ahora y desde cuándo (ms de reloj de pared). */
  current: Activity;
  shownAt: number;
  queue: Activity[];
  lastEventAt: number;
  idle: boolean;
}

/** Si se acumulan más actividades que esto, se saltean las intermedias para no quedar atrasados. */
const MAX_QUEUE = 3;
const THINKING: Activity = { kind: 'thinking', detail: null };
/** Si un agente arranca hasta este tiempo después de que otro terminó, se encuentran en la sala de reuniones. */
const HANDOFF_WINDOW_MS = 60_000;

/**
 * Traduce eventos en planes para los actores: entrar por la puerta, ir al escritorio, mostrar cada
 * actividad un mínimo de tiempo, ir al tablero a mover tarjetas, reportar al jefe e irse al café.
 */
export class Director {
  private readonly agents = new Map<string, AgentState>();
  private lastEventId = 0;
  private sessionEnded = false;
  /** El último que terminó su parte, candidato a pasarle la posta al próximo que entre. */
  private lastFinish: { st: AgentState; at: number } | null = null;

  constructor(
    actors: Actor[],
    private readonly places: Places,
    private readonly walkable: readonly boolean[],
    private readonly now: () => number = () => Date.now(),
  ) {
    for (const actor of actors) {
      this.agents.set(actor.agent, {
        actor,
        where: 'away',
        finished: false,
        current: THINKING,
        shownAt: 0,
        queue: [],
        lastEventAt: 0,
        idle: false,
      });
    }
  }

  /** Estado visible de un personaje (para paneles y tooltips). */
  status(agent: string) {
    const st = this.agents.get(agent);
    if (!st) return null;
    return {
      present: st.actor.visible,
      where: st.where,
      finished: st.finished,
      idle: st.idle,
      activity: st.queue.at(-1) ?? st.current,
    };
  }

  /** Camino evitando las sillas ajenas. */
  pathFor(agent: string) {
    const home = this.places.home(agent);
    const own = home.y * MAP_W + home.x;
    const blocked = new Set([...this.places.seatTiles].filter((t) => t !== own));
    return (from: Tile, to: Tile) => findPath(this.walkable, from, to, blocked);
  }

  /** Reconstruye la oficina de un piso sin animar el historial. */
  reset(events: OfficeEvent[]) {
    const snaps = reduceAgents(events);
    this.lastEventId = events.reduce((m, e) => Math.max(m, e.id), 0);
    this.sessionEnded = events.some((e) => e.kind === 'session_end' && e.agentName === BOSS_ID);
    const now = this.now();
    for (const [agent, st] of this.agents) {
      const snap = snaps.get(agent);
      st.queue = [];
      st.idle = false;
      st.actor.hide();
      st.where = 'away';
      st.finished = false;
      st.current = THINKING;
      st.shownAt = now;
      // El jefe está siempre en su oficina mientras la sesión siga abierta.
      const present = snap?.present ?? (agent === BOSS_ID && !this.sessionEnded);
      if (!present) continue;
      st.lastEventAt = snap ? Math.max(snap.lastEventAt, now - IDLE_AFTER_MS / 2) : now;
      if (snap?.finished && agent !== BOSS_ID) {
        st.finished = true;
        st.where = 'cafe';
        st.actor.place(this.places.coffee(agent), false);
        st.actor.setPlan([{ type: 'wait', ms: 3_600_000, pose: 'cup' }]);
        this.screen(st, 'off');
        continue;
      }
      st.where = 'desk';
      st.actor.place(this.places.home(agent), true);
      // Las actividades instantáneas (error, mover tarjeta) no tienen sentido congeladas.
      const steady = snap && ['reading', 'typing', 'terminal', 'web', 'waiting'].includes(snap.activity.kind);
      this.show(st, steady ? snap.activity : THINKING);
    }
  }

  /** Evento en vivo del piso actual. */
  handle(e: OfficeEvent) {
    if (e.id <= this.lastEventId) return;
    this.lastEventId = e.id;
    const it = interpret(e);
    if (!it) return;
    const st = this.agents.get(it.agent) ?? this.agents.get(VISITOR_ID);
    if (!st) return;
    st.lastEventAt = this.now();
    if (st.idle) this.wake(st);

    if (e.kind === 'session_end' && it.agent === BOSS_ID) {
      this.sessionEnded = true;
      for (const other of this.agents.values()) this.leave(other);
      return;
    }
    if (e.kind === 'session_start' && it.agent === BOSS_ID) this.sessionEnded = false;

    if (it.presence === 'enter') {
      this.enter(st, e.kind === 'agent_start');
      return;
    }
    if (it.presence === 'finish') {
      this.finish(st);
      return;
    }
    if (st.where === 'away' || st.where === 'cafe' || st.finished) {
      // Hooks instalados a mitad de sesión o un agente que vuelve a trabajar: entra igual.
      this.enter(st);
    }
    st.finished = false;
    st.queue.push(it.activity);
    if (st.queue.length > MAX_QUEUE) st.queue.splice(0, st.queue.length - MAX_QUEUE);
  }

  update() {
    const now = this.now();
    for (const st of this.agents.values()) {
      if (!st.actor.visible) continue;
      // Siguiente actividad cuando la actual ya se mostró lo suficiente y el actor está libre.
      if (st.queue.length > 0 && !st.actor.busy && st.where === 'desk' && now - st.shownAt >= MIN_SHOW_MS[st.current.kind]) {
        // Las de "pensando" entre herramientas no se muestran si ya hay otra esperando.
        while (st.queue.length > 1 && st.queue[0]!.kind === 'thinking') st.queue.shift();
        this.show(st, st.queue.shift()!);
      }
      // Sin eventos por un rato → café (o el jefe se estira).
      if (!st.idle && !st.finished && st.where === 'desk' && !st.actor.busy && st.queue.length === 0 && now - st.lastEventAt > IDLE_AFTER_MS) {
        this.idle(st);
      }
    }
  }

  private home(st: AgentState): Step[] {
    return st.where === 'desk' && st.actor.seated ? [] : this.walkHome(st);
  }

  private walkHome(st: AgentState): Step[] {
    return [
      { type: 'walk', to: this.places.home(st.actor.agent) },
      { type: 'sit' },
      { type: 'run', fn: () => (st.where = 'desk') },
    ];
  }

  private enter(st: AgentState, launched = false) {
    const from = launched ? this.takeHandoff(st) : null;
    st.finished = false;
    st.idle = false;
    st.current = THINKING;
    st.shownAt = this.now();
    if (st.where === 'away') st.actor.place(this.places.door, false);
    st.where = 'elsewhere';
    st.actor.clearEffects();
    this.screen(st, 'idle');
    if (from) this.handoff(from, st);
    else st.actor.setPlan(this.home(st));
  }

  private takeHandoff(st: AgentState): AgentState | null {
    const last = this.lastFinish;
    this.lastFinish = null;
    if (!last || last.st === st || this.now() - last.at > HANDOFF_WINDOW_MS) return null;
    return last.st.finished && last.st.actor.visible && st.where === 'away' ? last.st : null;
  }

  /** El que terminó y el que entra se cruzan en la sala de reuniones y cada uno sigue a lo suyo. */
  private handoff(from: AgentState, to: AgentState) {
    const [spotFrom, spotTo] = this.places.handoff;
    from.where = 'elsewhere';
    from.actor.setPlan([{ type: 'walk', to: spotFrom }, { type: 'wait', ms: 3_600_000 }]);
    to.actor.setPlan([
      { type: 'walk', to: spotTo },
      {
        type: 'run',
        fn: () => {
          if (from.finished) from.actor.bubbleText('Te paso la posta');
          to.actor.bubbleText('¡Dale!');
        },
      },
      { type: 'wait', ms: 1600 },
      {
        type: 'run',
        fn: () => {
          to.actor.bubbleText(null);
          if (from.finished) {
            from.actor.bubbleText(null);
            this.toCafe(from);
          }
        },
      },
      ...this.walkHome(to),
    ]);
  }

  private toCafe(st: AgentState) {
    st.where = 'elsewhere';
    st.actor.setPlan([
      { type: 'walk', to: this.places.coffee(st.actor.agent) },
      { type: 'run', fn: () => (st.where = 'cafe') },
      { type: 'wait', ms: 3_600_000, pose: 'cup' },
    ]);
  }

  private finish(st: AgentState) {
    st.queue = [];
    st.finished = true;
    st.actor.clearEffects();
    this.screen(st, 'off');
    if (st.actor.agent === BOSS_ID) {
      st.actor.cheer();
      return;
    }
    st.where = 'elsewhere';
    this.lastFinish = { st, at: this.now() };
    // Festeja en su lugar, le reporta al jefe y se va al café (salvo que entre alguien y le pase la posta).
    st.actor.setPlan([
      { type: 'run', fn: () => st.actor.cheer() },
      { type: 'wait', ms: 1300 },
      { type: 'walk', to: this.places.bossDoor },
      { type: 'run', fn: () => st.actor.bubbleText('¡Listo!') },
      { type: 'wait', ms: 1400, facing: 'up' },
      { type: 'run', fn: () => st.actor.bubbleText(null) },
      { type: 'walk', to: this.places.coffee(st.actor.agent) },
      { type: 'run', fn: () => (st.where = 'cafe') },
      { type: 'wait', ms: 3_600_000, pose: 'cup' },
    ]);
  }

  private leave(st: AgentState) {
    st.queue = [];
    st.finished = false;
    st.idle = false;
    if (!st.actor.visible) {
      st.where = 'away';
      return;
    }
    st.actor.clearEffects();
    this.screen(st, 'off');
    st.where = 'elsewhere';
    st.actor.setPlan([
      { type: 'walk', to: this.places.door },
      { type: 'run', fn: () => (st.where = 'away') },
      { type: 'hide' },
    ]);
  }

  private idle(st: AgentState) {
    st.idle = true;
    st.actor.clearEffects();
    this.screen(st, 'idle');
    if (st.actor.agent === BOSS_ID) {
      st.actor.setPlan([
        { type: 'walk', to: this.places.bossIdle },
        { type: 'wait', ms: 2500, pose: 'stretch' },
        { type: 'wait', ms: 3_600_000, pose: 'phone' },
      ]);
    } else {
      st.actor.setPlan([{ type: 'walk', to: this.places.coffee(st.actor.agent) }, { type: 'wait', ms: 3_600_000, pose: 'cup' }]);
    }
    st.where = 'elsewhere';
  }

  private wake(st: AgentState) {
    st.idle = false;
    st.actor.setPlan(this.home(st));
  }

  private screen(st: AgentState, mode: ScreenMode, activity?: Activity) {
    const lang = activity?.language ?? null;
    // El monitor de backend muestra el logo del lenguaje que está tocando.
    if (st.actor.agent === 'backend' && lang && (mode === 'code' || mode === 'doc')) st.actor.monitor?.set('logo', lang);
    else st.actor.monitor?.set(mode);
  }

  /** Aplica los efectos de una actividad (el actor ya está o va camino a su escritorio). */
  private show(st: AgentState, a: Activity) {
    const actor = st.actor;
    st.current = a;
    st.shownAt = this.now();
    actor.clearEffects();
    const bubble = (text: string | null, tone: BubbleTone = 'normal') => actor.bubbleText(text, tone);

    switch (a.kind) {
      case 'thinking':
        this.screen(st, 'idle');
        if (actor.agent === BOSS_ID && a.detail) bubble(a.detail);
        break;
      case 'reading':
        actor.reading = true;
        this.screen(st, 'doc', a);
        bubble(a.detail);
        break;
      case 'typing':
        actor.typing = true;
        this.screen(st, 'code', a);
        bubble(a.detail);
        break;
      case 'terminal':
        actor.typing = true;
        this.screen(st, 'terminal');
        bubble(a.detail ? `$ ${a.detail}` : '$', 'terminal');
        break;
      case 'web':
        actor.globe = true;
        this.screen(st, 'web');
        bubble(a.detail, 'web');
        break;
      case 'waiting':
        actor.waiting = true;
        this.screen(st, 'idle');
        bubble(a.detail, 'waiting');
        break;
      case 'error':
        actor.shake(1.2);
        this.screen(st, 'error');
        bubble(a.detail ?? 'Error', 'error');
        break;
      case 'delegating':
        this.screen(st, 'code');
        bubble(a.detail);
        break;
      case 'card':
        // Va al tablero, mueve la tarjeta y vuelve.
        this.screen(st, 'idle');
        st.where = 'elsewhere';
        actor.setPlan([
          { type: 'walk', to: this.places.board(a.column) },
          { type: 'run', fn: () => bubble(a.detail ? `${a.detail} → ${a.column ?? ''}` : null) },
          { type: 'wait', ms: 1200, pose: 'hand', facing: 'up' },
          { type: 'run', fn: () => bubble(null) },
          ...this.walkHome(st),
        ]);
        break;
      case 'done':
        this.screen(st, 'idle');
        if (actor.agent === BOSS_ID) actor.cheer(1.2);
        break;
    }
  }
}
