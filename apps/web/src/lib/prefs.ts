import { create } from 'zustand';

/** Preferencias del navegador que sobreviven a la recarga (localStorage, nunca datos del trabajo). */
export type Theme = 'auto' | 'light' | 'dark';
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export interface CameraView {
  x: number;
  y: number;
  zoom: number;
}

interface Prefs {
  theme: Theme;
  sound: boolean;
  paused: boolean;
  speed: Speed;
  timelineOpen: boolean;
  /** Piso fijado a mano (null = seguir la sesión activa). */
  pinnedFloor: string | null;
  camera: CameraView | null;
}

const KEY = 'agent-office:prefs';
const DEFAULTS: Prefs = { theme: 'auto', sound: false, paused: false, speed: 1, timelineOpen: false, pinnedFloor: null, camera: null };

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'auto',
      sound: raw.sound === true,
      // Una pausa no se arrastra entre recargas: al volver, la oficina siempre está en vivo.
      paused: false,
      speed: (SPEEDS as readonly number[]).includes(raw.speed as number) ? (raw.speed as Speed) : 1,
      timelineOpen: raw.timelineOpen === true,
      pinnedFloor: typeof raw.pinnedFloor === 'string' ? raw.pinnedFloor : null,
      camera: validCamera(raw.camera) ? raw.camera : null,
    };
  } catch {
    return DEFAULTS;
  }
}

function validCamera(c: unknown): c is CameraView {
  const v = c as CameraView | null;
  return !!v && [v.x, v.y, v.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) && v.zoom > 0;
}

export const usePrefs = create<Prefs & { resolved: 'light' | 'dark'; set(patch: Partial<Prefs>): void }>((set) => ({
  ...load(),
  resolved: 'dark',
  set: (patch) => set(patch),
}));

usePrefs.subscribe((s, prev) => {
  if (s.resolved !== prev.resolved && s.theme === prev.theme) return;
  try {
    const { theme, sound, speed, timelineOpen, pinnedFloor, camera } = s;
    localStorage.setItem(KEY, JSON.stringify({ theme, sound, speed, timelineOpen, pinnedFloor, camera }));
  } catch {
    // Almacenamiento bloqueado (ventana privada): las preferencias duran lo que la pestaña.
  }
});

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** Tema efectivo: el elegido o el del sistema. */
export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'auto' ? (dark?.matches === false ? 'light' : 'dark') : theme;
}

/** Aplica el tema al documento y lo mantiene al día si cambia el del sistema. */
export function startTheme() {
  const apply = () => {
    const resolved = resolvedTheme(usePrefs.getState().theme);
    document.documentElement.dataset.theme = resolved;
    usePrefs.setState({ resolved });
  };
  apply();
  usePrefs.subscribe((s, prev) => s.theme !== prev.theme && apply());
  dark?.addEventListener('change', apply);
}

