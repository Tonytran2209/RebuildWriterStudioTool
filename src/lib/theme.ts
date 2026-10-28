import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'writer:theme-preference';

function storedPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(storedPreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, preference); } catch { /* Browsers may disable local storage. */ }
  }, [preference]);

  const theme = preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
  useEffect(() => {
    document.documentElement.dataset.writerTheme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  return { preference, setPreference, theme };
}
