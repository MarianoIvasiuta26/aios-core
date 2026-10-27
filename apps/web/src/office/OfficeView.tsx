import { useEffect, useRef, useState } from 'react';
import { profileFor } from '@office/shared';
import { AgentAvatar } from '../components/AgentAvatar.tsx';
import { useOffice } from '../lib/store.ts';
import { OfficeScene } from './scene.ts';
import './office.css';

export function OfficeView() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const [ready, setReady] = useState(false);
  const [fps, setFps] = useState(0);
  const tasks = useOffice((s) => s.tasks);
  const highlighted = useOffice((s) => s.highlightedAgent);
  const highlightAgent = useOffice((s) => s.highlightAgent);

  useEffect(() => {
    const scene = new OfficeScene();
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __office?: OfficeScene }).__office = scene;
    let alive = true;
    void scene.init(host.current!).then(() => alive && setReady(true));
    const timer = setInterval(() => setFps(Math.round(scene.fps)), 500);
    return () => {
      alive = false;
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

  return (
    <div className="office">
      <div ref={host} className="office-canvas" aria-label="Oficina de los agentes" role="img" />
      {highlighted && (
        <div className="office-highlight" role="status">
          <AgentAvatar agent={highlighted} size={18} />
          <span>{profileFor(highlighted === 'jefe' ? null : highlighted).displayName}</span>
          <button type="button" className="ghost" onClick={() => highlightAgent(null)}>
            Quitar resaltado
          </button>
        </div>
      )}
      <div className="office-controls" role="toolbar" aria-label="Cámara">
        <button type="button" onClick={() => cam()?.zoomBy(0.8)} aria-label="Alejar">
          −
        </button>
        <button type="button" onClick={() => cam()?.fit(true)}>
          Ver todo
        </button>
        <button type="button" onClick={() => cam()?.zoomBy(1.25)} aria-label="Acercar">
          +
        </button>
        <span className={`fps${fps > 0 && fps < 50 ? ' low' : ''}`} title="Cuadros por segundo">
          {fps} fps
        </span>
      </div>
    </div>
  );
}
