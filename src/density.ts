import { useEffect, useState } from "react";

// Board density and column width, per-browser display preferences kept in
// localStorage (like the theme). Each sets a <html data-*> attribute that
// styles.css maps to sizes: density to text size and card spacing, column width
// to the board's column width. index.html applies the stored values before
// first paint so the board doesn't jump on load.
export type Density = "compact" | "default" | "comfortable";
export type ColumnWidth = "narrow" | "default" | "wide";

export const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "comfortable", label: "Comfortable" },
];

export const COLUMN_WIDTHS: { value: ColumnWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "default", label: "Default" },
  { value: "wide", label: "Wide" },
];

// A stored choice from `options`, falling back to "default", mirrored onto
// <html data-{attr}>.
function useDisplayPref<T extends string>(key: string, attr: string, options: { value: T }[]) {
  const [value, setValue] = useState<T>(() => {
    const v = localStorage.getItem(key);
    return options.find((o) => o.value === v)?.value ?? ("default" as T);
  });
  useEffect(() => {
    localStorage.setItem(key, value);
    document.documentElement.dataset[attr] = value;
  }, [key, attr, value]);
  return [value, setValue] as const;
}

export const useDensity = () => useDisplayPref("corvid_density_v1", "density", DENSITIES);
export const useColumnWidth = () =>
  useDisplayPref("corvid_column_width_v1", "columnWidth", COLUMN_WIDTHS);
