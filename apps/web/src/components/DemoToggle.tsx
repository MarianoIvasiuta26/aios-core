import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

/** Reproduce eventos simulados de todos los equipos, incluido el tablero. */
export function DemoToggle() {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.demoStatus().then((s) => setRunning(s.running)).catch(() => {});
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (running) await api.demoStop();
      else await api.demoStart(1);
      setRunning(!running);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={running}>
      {running ? 'Detener demo' : 'Iniciar demo'}
    </button>
  );
}
