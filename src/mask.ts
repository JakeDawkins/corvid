import { createContext, useContext, useEffect, useState } from "react";

// Masked mode swaps sensitive text for placeholder words at render time, so the
// board can be screenshotted publicly. Stored data is never changed. Each kind
// of text is a category that can be toggled; `on` is its default.
export const MASK_CATEGORIES = [
  { key: "cardTitles", label: "Card titles", on: true },
  { key: "cardNotes", label: "Card notes", on: true },
  { key: "prTitles", label: "PR titles", on: true },
  { key: "linearTitles", label: "Linear issue and project titles", on: true },
  { key: "linearResources", label: "Linear linked docs (Notion, Figma titles)", on: true },
  { key: "branches", label: "Deployment branch names", on: true },
  { key: "urls", label: "Link URLs (hover text and card editor)", on: true },
  { key: "colorLabels", label: "Color labels", on: false },
  { key: "repoNames", label: "Repo and Vercel project names", on: false },
  { key: "linkLabels", label: "Card link labels", on: false },
  { key: "columnNames", label: "Column names", on: false },
] as const;

export type MaskCategory = (typeof MASK_CATEGORIES)[number]["key"];

// A per-browser display preference, so it lives in localStorage rather than
// data.json. Categories left unset fall back to their default.
export type MaskSettings = {
  enabled: boolean;
  categories: Partial<Record<MaskCategory, boolean>>;
};

const STORAGE_KEY = "corvid_mask_v1";
const OFF: MaskSettings = { enabled: false, categories: {} };

function loadSettings(): MaskSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...OFF, ...(JSON.parse(raw) as MaskSettings) } : OFF;
  } catch {
    return OFF;
  }
}

export function useMaskSettings() {
  const [settings, setSettings] = useState<MaskSettings>(loadSettings);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);
  return [settings, setSettings] as const;
}

export function categoryOn(s: MaskSettings, cat: MaskCategory): boolean {
  return s.categories[cat] ?? MASK_CATEGORIES.find((c) => c.key === cat)!.on;
}

const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor " +
  "incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud " +
  "exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute " +
  "irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur " +
  "excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt " +
  "mollit anim id est laborum"
).split(" ");

// FNV-1a, to seed the placeholder words from the original text.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// Replace each word with a lorem word of about the same length, keeping
// whitespace and leading capitals. Seeded by the text, so a given title always
// masks to the same placeholder across renders and refreshes.
export function fakeText(text: string): string {
  let seed = hash(text);
  return text.replace(/\S+/g, (word) => {
    // mulberry32 step
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = (t ^ (t >>> 14)) >>> 0;
    const near = WORDS.filter((w) => Math.abs(w.length - word.length) <= 1);
    const pool = near.length ? near : WORDS.filter((w) => w.length >= 10);
    const w = pool[r % pool.length];
    return /^[A-Z]/.test(word) ? w[0].toUpperCase() + w.slice(1) : w;
  });
}

// Reduce a URL to its site, e.g. "https://linear.app/acme/issue/…" -> "linear.app/…".
// Vercel deployment URLs come without a protocol.
function maskUrl(url: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
    return `${host.split(".").slice(-2).join(".")}/…`;
  } catch {
    return "…";
  }
}

export type Mask = {
  // Whether a category is currently masked.
  on: (cat: MaskCategory) => boolean;
  // The text to display for a category: masked if that category is on.
  m: <T extends string | undefined>(cat: MaskCategory, text: T) => T;
};

export function makeMask(s: MaskSettings): Mask {
  const on = (cat: MaskCategory) => s.enabled && categoryOn(s, cat);
  const m = <T extends string | undefined>(cat: MaskCategory, text: T): T =>
    (text && on(cat) ? (cat === "urls" ? maskUrl(text) : fakeText(text)) : text) as T;
  return { on, m };
}

export const MaskContext = createContext<Mask>(makeMask(OFF));

export function useMask(): Mask {
  return useContext(MaskContext);
}
