import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { profileFor } from '@office/shared';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { TaskDrawer } from '../board/TaskDrawer.tsx';
import { useOffice } from '../lib/store.ts';
import { EMPTY_FILTER, type TimelineFilter } from './insights.ts';
import { AgentPanel, AgentTooltip, FloorPicker, ZonePanel } from './panels.tsx';
import { OfficeScene } from './scene.ts';
import { currentPrompt } from './zones.ts';
import { sound, type Cue } from './sound.ts';
import { SPEEDS, usePrefs, type Speed } from '../lib/prefs.ts';
import type { OfficeEvent } from '@office/shared';
import { Timeline } from './Timeline.tsx';
import '../board/board.css';
import './office.css';

export function OfficeView() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const [ready, setReady] = useState(false);
  const [fps, setFps] = useState(0);
  const tasks = useOffice((s) => s.tasks);
  const highlighted = useOffice((s) => s.highlightedAgent);
  const highlightAgent = useOffice((s) => s.highlightAgent);
  const selection = useOffice((s) => s.selection);
  const select = useOffice((s) => s.select);
  const openTaskId = useOffice((s) => s.openTaskId);
  const openTask = useOffice((s) => s.openTask);
  const [hover, setHover] = useState<{ agent: string; x: number; y: number } | null>(null);
  const timelineOpen = usePrefs((s) => s.timelineOpen);
  const setTimelineOpen = (v: boolean | ((open: boolean) => boolean)) =>
    usePrefs.getState().set({ timelineOpen: typeof v === 'function' ? v(usePrefs.getState().timelineOpen) : v });
  const paused = usePrefs((s) => s.paused);
  const speed = usePrefs((s) => s.speed);
  const night = usePrefs((s) => s.resolved) === 'dark';
  const setPrefs = usePrefs((s) => s.set);
  const [filter, setFilter] = useState<TimelineFilter>(EMPTY_FILTER);

  useEffect(() => {
    const scene = new OfficeScene();
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __office?: OfficeScene }).__office = scene;
    let alive = true;
    scene.onPick = (pick) => useOffice.getState().select(pick);
    scene.onHover = setHover;
    scene.onCue = (cue) => sound.play(cue);
    scene.setNight(usePrefs.getState().resolved === 'dark');
    void scene.init(host.current!).then(() => {
      if (!alive) return;
      // Vuelve a donde estaba la cámara antes de recargar.
      const saved = usePrefs.getState().camera;
      if (saved) scene.restoreCamera(saved);
      setReady(true);
    });
    // Guarda la vista de la cámara de vez en cuando (y al salir).
    const saveCamera = () => {
      const v = scene.cameraView;
      const prev = usePrefs.getState().camera;
      if (v && (!prev || Math.abs(prev.x - v.x) > 1 || Math.abs(prev.y - v.y) > 1 || Math.abs(prev.zoom - v.zoom) > 0.01)) {
        usePrefs.getState().set({ camera: v });
      }
    };
    const cameraTimer = setInterval(saveCamera, 2000);
    window.addEventListener('pagehide', saveCamera);
    const timer = setInterval(() => setFps(Math.round(scene.fps)), 500);
    // Pixi solo escucha el resize de la ventana; el panel de abajo también cambia el tamaño.
    const resize = new ResizeObserver(() => scene.app.renderer && scene.app.resize());
    resize.observe(host.current!);
    return () => {
      alive = false;
      saveCamera();
      clearInterval(cameraTimer);
      window.removeEventListener('pagehide', saveCamera);
      resize.disconnect();
      clearInterval(timer);
      scene.destroy();
      sceneRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (ready) sceneRef.current?.setTasks(Object.values(tasks));
  }, [ready, tasks]);

  useEffect(() => {
    if (ready) sceneRef.current?.setHighlight(highlighted);
  }, [ready, highlighted]);

  useEffect(() => {
    sceneRef.current?.setPlayback(speed, paused);
  }, [ready, speed, paused]);

  // Espacio pausa o reanuda (salvo que se esté escribiendo en un campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, button, [contenteditable]')) return;
      e.preventDefault();
      const p = usePrefs.getState();
      p.set({ paused: !p.paused });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    sceneRef.current?.setNight(night);
  }, [ready, night]);

  // Piso recargado entero → reconstruir la oficina sin animar el historial.
  const floorRev = useOffice((s) => s.floorRev);
  useEffect(() => {
    if (ready) sceneRef.current?.resetFloor(useOffice.getState().floorEvents);
  }, [ready, floorRev]);

  // Eventos en vivo del piso (el director descarta los que ya vio).
  useEffect(() => {
    if (!ready) return;
    return useOffice.subscribe((s, prev) => {
      if (s.floorEvents === prev.floorEvents || s.floorRev !== prev.floorRev) return;
      const seen = prev.floorEvents.at(-1)?.id ?? 0;
      for (const e of s.floorEvents) {
        if (e.id <= seen) continue;
        sceneRef.current?.handleEvent(e);
        const cue = cueFor(e);
        if (cue) sound.play(cue);
      }
    });
  }, [ready]);

  useEffect(() => {
    if (ready) sceneRef.current?.setZoneOutline(selection?.type === 'zone' ? selection.zone : null);
  }, [ready, selection]);

  // Archivos del repo de trabajo → zonas; el último pedido → pizarrón de la sala de reuniones.
  const workspace = useOffice((s) => s.workspace);
  const prompt = useOffice((s) => currentPrompt(s.floorEvents));
  useEffect(() => {
    if (ready) sceneRef.current?.setWorkspace(workspace);
  }, [ready, workspace]);
  useEffect(() => {
    if (ready) sceneRef.current?.setPrompt(prompt);
  }, [ready, prompt]);

  const showInTimeline = useCallback((agent: string) => {
    setFilter({ ...EMPTY_FILTER, agents: [agent] });
    setTimelineOpen(true);
  }, []);

  const pickFromTimeline = useCallback(
    (agent: string) => {
      select({ type: 'agent', agent });
      sceneRef.current?.focusAgent(agent);
    },
    [select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const cam = sceneRef.current?.camera;
      if (!cam) return;
      if (e.key === '+' || e.key === '=') cam.zoomBy(1.25);
      if (e.key === '-') cam.zoomBy(0.8);
      if (e.key === '0') cam.fit(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cam = () => sceneRef.current?.camera;
  const scene = ready ? sceneRef.current : null;
  const openTaskData = openTaskId ? tasks[openTaskId] : undefined;

  return (
    <div className="office">
      <div className={`office-stage${selection ? ' with-panel' : ''}`}>
        <div
          ref={host}
          className="office-canvas"
          aria-label="Oficina de los agentes. Hacé click en un personaje o en una zona para ver su panel."
          role="img"
        />
        <FloorPicker />
        {scene && hover && !selection && <AgentTooltip scene={scene} hover={hover} />}
        <AnimatePresence>
          {scene && selection?.type === 'agent' && (
            <AgentPanel key={`a-${selection.agent}`} scene={scene} agent={selection.agent} onTimeline={showInTimeline} />
          )}
          {scene && selection?.type === 'zone' && <ZonePanel key={`z-${selection.zone}`} scene={scene} zone={selection.zone} />}
        </AnimatePresence>
        {highlighted && (
          <div className="office-highlight" role="status">
            <AgentAvatar agent={highlighted} size={18} />
            <span>{profileFor(highlighted === 'jefe' ? null : highlighted).displayName}</span>
            <button type="button" className="ghost" onClick={() => highlightAgent(null)}>
              Quitar resaltado
            </button>
          </div>
        )}
        {paused && (
          <div className="office-paused" role="status">
            En pausa · los eventos se siguen registrando
          </div>
        )}
        <div className="office-controls" role="toolbar" aria-label="Cámara y animación">
          <button type="button" onClick={() => cam()?.zoomBy(0.8)} aria-label="Alejar">
            −
          </button>
          <button type="button" onClick={() => cam()?.fit(true)}>
            Ver todo
          </button>
          <button type="button" onClick={() => cam()?.zoomBy(1.25)} aria-label="Acercar">
            +
          </button>
          <span className="sep" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setPrefs({ paused: !paused })}
            aria-pressed={paused}
            aria-label={paused ? 'Reanudar animaciones' : 'Pausar animaciones'}
            title={paused ? 'Reanudar (espacio)' : 'Pausar (espacio)'}
          >
            {paused ? '▶' : '❚❚'}
          </button>
          <select
            value={speed}
            onChange={(e) => setPrefs({ speed: Number(e.target.value) as Speed })}
            aria-label="Velocidad de las animaciones"
          >
            {SPEEDS.map((v) => (
              <option key={v} value={v}>
                {String(v).replace('.', ',')}×
              </option>
            ))}
          </select>
          <span className={`fps${fps > 0 && fps < 50 ? ' low' : ''}`} title="Cuadros por segundo">
            {fps} fps
          </span>
        </div>
      </div>
      <Timeline
        open={timelineOpen}
        onToggle={() => setTimelineOpen((o) => !o)}
        filter={filter}
        onFilter={setFilter}
        onPickAgent={pickFromTimeline}
      />
      <AnimatePresence>
        {openTaskData && <TaskDrawer key={openTaskData.id} task={openTaskData} onClose={() => openTask(null)} />}
      </AnimatePresence>
    </div>
  );
}

/** Sonido para los eventos que se ven en la oficina (los de zona los pide la escena). */
function cueFor(e: OfficeEvent): Cue | null {
  switch (e.kind) {
    case 'agent_start':
      return 'enter';
    case 'agent_stop':
      return 'done';
    case 'tool_error':
      return 'error';
    case 'waiting':
      return 'waiting';
    case 'task_move':
      return 'card';
    default:
      return null;
  }
}
