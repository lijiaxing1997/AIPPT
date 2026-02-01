export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "aippt.theme";

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export function getStoredTheme(): ThemeMode | null {
  const raw = safeGetItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark") return raw;
  return null;
}

export function getCurrentTheme(): ThemeMode {
  if (typeof document !== "undefined") {
    const raw = document.documentElement.dataset.theme;
    if (raw === "light" || raw === "dark") return raw;
  }
  return getStoredTheme() ?? "dark";
}

export function setTheme(theme: ThemeMode) {
  safeSetItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function initTheme(): ThemeMode {
  const theme = getStoredTheme() ?? "dark";
  applyTheme(theme);
  return theme;
}

