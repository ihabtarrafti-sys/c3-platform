import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

/**
 * Theme mode + effects preference (S47, Direction E). Dark-first: the default
 * is dark; light is a first-class inversion. "Reduce effects" is the honest
 * fallback mechanism for glass (browsers cannot detect GPU strength): the OS
 * `prefers-reduced-transparency` query is honored in CSS, and this toggle
 * gives the same opt-out to anyone, persisted per device.
 */

type Mode = 'dark' | 'light';
type Skin = 'iris' | 'afterglow';

interface ModeContextValue {
  readonly mode: Mode;
  toggleMode(): void;
  readonly skin: Skin;
  toggleSkin(): void;
  readonly effectsReduced: boolean;
  toggleEffects(): void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => readStored('c3-mode', ['dark', 'light'] as const, 'dark'));
  const [skin, setSkin] = useState<Skin>(() => readStored('c3-skin', ['iris', 'afterglow'] as const, 'iris'));
  const [effects, setEffects] = useState<'full' | 'reduced'>(() =>
    readStored('c3-effects', ['full', 'reduced'] as const, 'full'),
  );

  useEffect(() => {
    // Re-skin: the locked identity keys on data-c3-theme with cozy-dark/fresh-light. The internal
    // dark/light concept maps 1:1; the DOM attribute + the brand token file speak the locked names.
    document.documentElement.dataset.c3Theme = mode === 'dark' ? 'cozy-dark' : 'fresh-light';
    try {
      localStorage.setItem('c3-mode', mode);
    } catch {
      /* storage unavailable — mode still applies for the session */
    }
  }, [mode]);

  useLayoutEffect(() => {
    document.documentElement.dataset.c3Skin = skin;
    try {
      localStorage.setItem('c3-skin', skin);
    } catch {
      /* storage unavailable — skin still applies for the session */
    }
  }, [skin]);

  useEffect(() => {
    if (effects === 'reduced') document.documentElement.dataset.c3Effects = 'reduced';
    else delete document.documentElement.dataset.c3Effects;
    try {
      localStorage.setItem('c3-effects', effects);
    } catch {
      /* storage unavailable */
    }
  }, [effects]);

  return (
    <ModeContext.Provider
      value={{
        mode,
        toggleMode: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
        skin,
        toggleSkin: () => setSkin((face) => (face === 'iris' ? 'afterglow' : 'iris')),
        effectsReduced: effects === 'reduced',
        toggleEffects: () => setEffects((e) => (e === 'full' ? 'reduced' : 'full')),
      }}
    >
      {children}
    </ModeContext.Provider>
  );
}

export function useThemeMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeModeProvider');
  return ctx;
}
