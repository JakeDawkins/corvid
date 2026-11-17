import { useEffect, useState } from "react";

// View state that survives a reload of this tab but not a new tab or window:
// what's open (card editor, sidebars, focus mode) is kept in sessionStorage,
// unlike display preferences, which go in localStorage. The open context page
// lives in the URL hash instead, so it survives a reload the same way.
const PREFIX = "corvid_view_";

export function readSession<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(PREFIX + key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writeSession(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) sessionStorage.removeItem(PREFIX + key);
    else sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the view just won't persist.
  }
}

// useState, restored from and saved to sessionStorage under `key`.
export function useSessionState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readSession(key, initial));
  useEffect(() => writeSession(key, value), [key, value]);
  return [value, setValue] as const;
}
