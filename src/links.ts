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

// Case-insensitive membership test for name lists like data.hiddenRepos.
export function hasName(list: string[] | undefined, name: string): boolean {
  const n = name.toLowerCase();
  return !!list?.some((x) => x.toLowerCase() === n);
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

// Fallback label for a link with no title: the site's second-level domain.
// "https://www.figma.com/file/…" -> "figma", "docs.google.com" -> "google".
export function domainName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || "link";
  }
}

// The pasted text as an http(s) URL, adding "https://" to a bare domain like
// "notion.so/page". Null if it isn't a link.
export function toUrl(text: string): string | null {
  const s = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(s);
    return !/\s/.test(text) && u.hostname.includes(".") ? s : null;
  } catch {
    return null;
  }
}

// Starting title for a card quick-added from a link whose real title isn't
// available: "acme-web #482" for a PR, "ENG-42" for a Linear issue, else the
// site name, e.g. "Slack link".
export function linkTitle(url: string): string {
  const pr = parsePrUrl(url);
  if (pr) return `${pr.repo} #${pr.number}`;
  const issue = url.match(/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+-\d+)/i);
  if (issue) return issue[1].toUpperCase();
  const name = domainName(url);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} link`;
}
