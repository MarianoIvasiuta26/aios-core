import { lazy, Suspense, useEffect, useState, type MouseEvent } from 'react';
import { DemoToggle } from './components/DemoToggle.tsx';
import { Preferences } from './components/Preferences.tsx';
import { useOffice } from './lib/store.ts';

// Cada página en su propio archivo: Pixi solo se baja con la oficina y dnd-kit con el tablero.
const OfficeView = lazy(() => import('./office/OfficeView.tsx').then((m) => ({ default: m.OfficeView })));
const BoardPage = lazy(() => import('./board/BoardPage.tsx').then((m) => ({ default: m.BoardPage })));
const DebugPage = lazy(() => import('./debug/DebugPage.tsx').then((m) => ({ default: m.DebugPage })));

const ROUTES = [
  { path: '/', label: 'Oficina' },
  { path: '/tablero', label: 'Tablero' },
  { path: '/debug', label: 'Diagnóstico' },
] as const;

const CONN_LABEL = { open: 'En vivo', connecting: 'Conectando', closed: 'Sin conexión' } as const;

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (to: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.button !== 0) return;
    e.preventDefault();
    history.pushState(null, '', to);
    setPath(to);
  };
  return { path, go };
}

export function App() {
  const { path, go } = usePath();
  const conn = useOffice((s) => s.conn);
  return (
    <div className="shell">
      <nav className="topbar">
        <span className="logo">Agent Office</span>
        <ul>
          {ROUTES.map((r) => (
            <li key={r.path}>
              <a href={r.path} onClick={go(r.path)} aria-current={path === r.path ? 'page' : undefined}>
                {r.label}
              </a>
            </li>
          ))}
        </ul>
        <span className="spacer" />
        <Preferences />
        <DemoToggle />
        <span className={`conn conn-${conn}`} role="status">
          {CONN_LABEL[conn]}
        </span>
      </nav>
      <main className="content">
        <Suspense fallback={<p className="muted page-loading">Cargando…</p>}>
          {path.startsWith('/tablero') ? <BoardPage /> : path.startsWith('/debug') ? <DebugPage /> : <OfficeView />}
        </Suspense>
      </main>
    </div>
  );
}
