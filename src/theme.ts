import { useEffect, useState } from "react";

// Color theme, a per-browser display preference kept in localStorage (like
// masked mode). "system" follows the OS appearance. index.html applies the
// stored theme before first paint so the page doesn't flash dark on load.
export type Theme = "dark" | "light" | "system";

export const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const STORAGE_KEY = "corvid_theme_v1";

function loadTheme(): Theme {
  const t = localStorage.getItem(STORAGE_KEY);
  return t === "light" || t === "system" ? t : "dark";
}

const systemQuery = () => window.matchMedia("(prefers-color-scheme: light)");

// Sets <html data-theme> to the resolved "dark" | "light", tracking OS changes
// while on "system".
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
    const apply = () => {
      const resolved = theme === "system" ? (systemQuery().matches ? "light" : "dark") : theme;
      document.documentElement.dataset.theme = resolved;
      // Keep the browser chrome (PWA title bar) in step with the toolbar.
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--panel").trim());
    };
    apply();
    if (theme !== "system") return;
    const q = systemQuery();
    q.addEventListener("change", apply);
    return () => q.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme] as const;
}
