// The app's settings: interface language and sound. Shared by the game and the story designer, and remembered
// between launches.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { resolveLanguage, setUILanguage, type AppLanguage, type UILanguage } from "./i18n";

interface Settings {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  /// The language the interface is shown in.
  uiLanguage: UILanguage;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
}

const SettingsContext = createContext<Settings | null>(null);

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings that can't be stored still apply for this session.
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => stored("appLanguage", "system"));
  const [soundOn, setSoundState] = useState(() => stored("soundOn", "true") === "true");
  const uiLanguage = resolveLanguage(language);
  // Strings resolve against this, so it's set before anything below renders.
  setUILanguage(uiLanguage);

  const setLanguage = useCallback((next: AppLanguage) => {
    store("appLanguage", next);
    setLanguageState(next);
  }, []);
  const setSoundOn = useCallback((on: boolean) => {
    store("soundOn", String(on));
    setSoundState(on);
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, uiLanguage, soundOn, setSoundOn }),
    [language, setLanguage, uiLanguage, soundOn, setSoundOn],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("useSettings must be used inside SettingsProvider.");
  return settings;
}

/// The story-text language that matches the interface. Stories are written in English or Simplified Chinese.
export function storyLanguageFor(uiLanguage: UILanguage): string {
  return uiLanguage === "zh-Hans" ? "zh-Hans" : "en";
}
