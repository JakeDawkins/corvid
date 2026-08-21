// Preset card accent colors. `undefined` = no color.
export const COLORS: { name: string; value: string | undefined }[] = [
  { name: "None", value: undefined },
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f76b15" },
  { name: "Yellow", value: "#ffb224" },
  { name: "Green", value: "#30a46c" },
  { name: "Blue", value: "#3b9eff" },
  { name: "Purple", value: "#8e4ec6" },
  { name: "Pink", value: "#e93d82" },
];

// Pick black or white text for the best contrast on a given background color,
// via WCAG relative luminance. Of the presets only Purple needs white; the
// computation keeps this correct for any color rather than hardcoding.
export function textOn(hex: string): string {
  const channel = (i: number) => {
    let c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const contrastBlack = (L + 0.05) / 0.05;
  const contrastWhite = 1.05 / (L + 0.05);
  return contrastBlack >= contrastWhite ? "#000" : "#fff";
}
