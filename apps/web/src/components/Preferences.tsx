import { useEffect } from 'react';
import { usePrefs, type Theme } from '../lib/prefs.ts';
import { sound } from '../office/sound.ts';

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'auto', label: 'Tema del sistema' },
  { value: 'dark', label: 'Oscuro (de noche)' },
  { value: 'light', label: 'Claro (de día)' },
];

/** Tema y sonido, en la barra de arriba (valen para toda la app y se recuerdan). */
export function Preferences() {
  const theme = usePrefs((s) => s.theme);
  const on = usePrefs((s) => s.sound);
  const set = usePrefs((s) => s.set);

  // El navegador solo deja sonar después de una interacción: si quedó activado, se enciende al primer click.
  useEffect(() => {
    if (!on || sound.enabled) return;
    const unlock = () => sound.enable();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [on]);

  const toggleSound = () => {
    if (on) sound.disable();
    else {
      sound.enable();
      sound.play('done');
    }
    set({ sound: !on });
  };

  return (
    <div className="prefs">
      <select value={theme} onChange={(e) => set({ theme: e.target.value as Theme })} aria-label="Tema">
        {THEMES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={toggleSound} aria-pressed={on} title={on ? 'Silenciar' : 'Activar sonidos'}>
        {on ? 'Sonido: sí' : 'Sonido: no'}
      </button>
    </div>
  );
}
