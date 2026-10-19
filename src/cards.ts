import type { Card } from "./types";

// Set a card's change timestamps for an edit from `prev` (undefined for a new
// card) to `next`: updatedAt always, createdAt for a new card, and hiddenAt
// when it's archived (dropped when it's unarchived).
export function stamp(prev: Card | undefined, next: Card): Card {
  const now = new Date().toISOString();
  const out: Card = { ...next, updatedAt: now };
  if (!prev) out.createdAt ??= now;
  if (out.hidden && !prev?.hidden) out.hiddenAt = now;
  if (!out.hidden) delete out.hiddenAt;
  return out;
}

// `card` with `changes` applied and its timestamps updated.
export function editCard(card: Card, changes: Partial<Card>): Card {
  return stamp(card, { ...card, ...changes });
}

// Archived column order: most recently archived first, then cards with no
// hiddenAt (archived before it existed). Ties keep their board order (the sort is stable).
export function byHiddenAt(a: Card, b: Card): number {
  if (!a.hiddenAt || !b.hiddenAt) return (a.hiddenAt ? 0 : 1) - (b.hiddenAt ? 0 : 1);
  return a.hiddenAt < b.hiddenAt ? 1 : a.hiddenAt > b.hiddenAt ? -1 : 0;
}
