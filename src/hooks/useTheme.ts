import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// `?theme=dark` or `?theme=light` in the URL overrides the stored and system
// theme, for links and screens (TV mode) that should always open one way
function getUrlTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const param = new URLSearchParams(window.location.search).get('theme');
  return param === 'light' || param === 'dark' ? param : null;
}

function setUrlTheme(theme: Theme): void {
  const url = new URL(window.location.href);
  url.searchParams.set('theme', theme);
  window.history.replaceState(window.history.state, '', url);
}

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage might not be available
  }
  return null;
}

function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // localStorage might not be available
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return getUrlTheme() ?? getStoredTheme() ?? getSystemTheme();
  });

  useEffect(() => {
    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      // Only update if neither the URL nor the user has set a theme
      if (getUrlTheme() === null && getStoredTheme() === null) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    // A theme from the URL stays in the URL rather than becoming the saved one
    if (getUrlTheme() !== null) setUrlTheme(newTheme);
    else setStoredTheme(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return { theme, setTheme, toggleTheme };
}
