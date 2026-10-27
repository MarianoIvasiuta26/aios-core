import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugPage } from './debug/DebugPage.tsx';
import './styles.css';

function App() {
  if (location.pathname.startsWith('/debug')) return <DebugPage />;
  return (
    <div className="placeholder">
      <h1>Agent Office</h1>
      <p>La oficina llega en la fase 3. Por ahora: <a href="/debug">vista de diagnóstico</a>.</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
