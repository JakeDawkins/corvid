import type { Card, Link } from "./types";

export type LinkKind = "pr" | "linear" | "generic";

// Classify a pasted URL so the app can render/refresh it as the right kind of
// link without storing that kind alongside it. Mirrors the server's parsePrUrl
// and parseLinearUrl so classification stays consistent across the boundary.
export function linkKind(url: string): LinkKind {
  const s = String(url);
  if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(s)) return "pr";
  if (
    /linear\.app\/[^/]+\/issue\/[A-Za-z0-9]+-\d+/i.test(s) ||
    /linear\.app\/[^/]+\/project\//i.test(s)
  )
    return "linear";
  return "generic";
}

// Parse a GitHub PR URL into its owner/repo/number. Mirrors the server's
// parsePrUrl. Returns null for anything that isn't a PR link.
export function parsePrUrl(
  url: string,
): { owner: string; repo: string; number: number } | null {
  const m = String(url).match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i,
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

// Fold a card's legacy split fields (single linearUrl + prUrls[]) into the flat
// `links` list, preserving the old display order (Linear, then PRs, then other
// links). Idempotent for already-migrated cards. Used on load and import.
export function normalizeCard(
  card: Card & { linearUrl?: string; prUrls?: string[] },
): Card {
  const { linearUrl, prUrls, links, ...rest } = card;
  const merged: Link[] = [];
  if (linearUrl) merged.push({ label: "", url: linearUrl });
  for (const url of prUrls ?? []) merged.push({ label: "", url });
  for (const l of links ?? []) merged.push(l);
  return { ...rest, links: merged };
}

// Normalize a Linear URL to a stable identity so the same issue/project matches
// regardless of URL slug, trailing slash, or query params. Mirrors the server's
// parseLinearUrl. Falls back to the trimmed URL if it isn't a recognized shape.
export function linearKey(url: string): string {
  const s = String(url);
  const issue = s.match(/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+)-(\d+)/i);
  if (issue) return `issue:${issue[1].toUpperCase()}-${Number(issue[2])}`;
  const project = s.match(
    /linear\.app\/[^/]+\/project\/[^/]*?-([0-9a-f]{8,})(?:\/|\?|$)/i,
  );
  if (project) return `project:${project[1].toLowerCase()}`;
  return s.trim();
}
