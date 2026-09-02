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
