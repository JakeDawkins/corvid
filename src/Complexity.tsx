import { useState } from "react";
import type { Complexity } from "./types";

// Sizes ordered smallest to largest; a size's index+1 is its rank (XS=1 … XL=5),
// which is the number of filled bars in the meter.
export const COMPLEXITY_LEVELS: Complexity[] = ["XS", "S", "M", "L", "XL"];

// A 5-segment horizontal meter with the first N bars filled for the given size.
// Filled bars are tinted with the card's accent color (when set) so they stay
// legible on any colored card; otherwise they fall back to the app accent.
export function ComplexityBars({
  value,
  color,
}: {
  value: Complexity;
  color?: string;
}) {
  const level = COMPLEXITY_LEVELS.indexOf(value) + 1;
  return (
    <div className="complexity" title={`Complexity: ${value}`}>
      <div className="complexity-bars">
        {COMPLEXITY_LEVELS.map((_, i) => (
          <span
            key={i}
            className={`complexity-bar${i < level ? " on" : ""}`}
            style={i < level && color ? { background: color } : undefined}
          />
        ))}
      </div>
      <span className="complexity-label">{value}</span>
    </div>
  );
}

// The editor's complexity control: the same meter as the card, where clicking a
// bar picks that size (fills up to it). Hovering previews the fill; clicking
// the current size again clears it (unset = hidden on the card).
export function ComplexityPicker({
  value,
  color,
  onChange,
}: {
  value?: Complexity;
  color?: string;
  onChange: (value: Complexity | undefined) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const selected = value ? COMPLEXITY_LEVELS.indexOf(value) + 1 : 0;
  const level = hover ?? selected;
  const shown = level ? COMPLEXITY_LEVELS[level - 1] : undefined;
  return (
    <div className="complexity complexity-picker" role="radiogroup" aria-label="Complexity">
      <div className="complexity-bars" onMouseLeave={() => setHover(null)}>
        {COMPLEXITY_LEVELS.map((c, i) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={c}
            title={value === c ? `${c} (click to clear)` : c}
            className="complexity-hit"
            onMouseEnter={() => setHover(i + 1)}
            onClick={() => onChange(value === c ? undefined : c)}
          >
            <span
              className={`complexity-bar${i < level ? " on" : ""}${hover ? " preview" : ""}`}
              style={i < level && color ? { background: color } : undefined}
            />
          </button>
        ))}
      </div>
      <span className="complexity-label">{shown ?? "None"}</span>
    </div>
  );
}
