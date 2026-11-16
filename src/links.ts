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

// A Markdown link, "[label](url)", as Linear and other apps copy links. The
// label match is greedy so a "]" inside it survives, and the URL may sit in
// angle brackets.
const MARKDOWN_LINK_RE = /^\[(.*)\]\(\s*<?(\S+?)>?\s*\)$/s;

// A link typed or pasted by hand, as the label and URL to store: a URL, a bare
// domain like "notion.so/page", or a Markdown link "[label](url)". The label is
// the Markdown link's text, else "". Null if it isn't an http(s) link, so text
// like "[title](url)" is never stored as a URL. Mirrored by the tracker's
// parseLink.
export function parseLink(text: string): { label: string; url: string } | null {
  const s = text.trim();
  const md = s.match(MARKDOWN_LINK_RE);
  const raw = md ? md[2] : s;
  // Another scheme ("conductor://…") would otherwise become "https://conductor://…".
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  const url = toUrl(raw);
  return url ? { label: md ? md[1].trim() : "", url } : null;
}

// A pasted string to treat as a link rather than as text: a single http(s)
// URL or a Markdown link to one.
export function pastedLink(text: string): { label: string; url: string } | null {
  const s = text.trim();
  return /^https?:\/\/\S+$/i.test(s) || MARKDOWN_LINK_RE.test(s) ? parseLink(s) : null;
}

// A link edited by hand, cleaned up for storage: a Markdown link is split into
// its URL and its text, which becomes the label if the link has none. Null if
// the URL isn't a link.
export function cleanLink(link: Link): Link | null {
  const parsed = parseLink(link.url);
  return parsed ? { label: link.label.trim() || parsed.label, url: parsed.url } : null;
}

// The URL to put in an href: only http(s), since anything else (a stray
// "[title](url)", an old app scheme) would open as a path on the Corvid server
// and show "Cannot GET".
export function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined;
}

// Sites with their own icon, by hostname. Subdomains count, so
// "homeaglow.slack.com" is Slack and "app.notion.com" is Notion.
export type Site = "linear" | "slack" | "github" | "figma" | "notion";
const SITE_DOMAINS: [string, Site][] = [
  ["linear.app", "linear"],
  ["slack.com", "slack"],
  ["github.com", "github"],
  ["figma.com", "figma"],
  ["notion.so", "notion"],
  ["notion.site", "notion"],
  ["notion.com", "notion"],
];

export function siteOf(url: string): Site | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [domain, site] of SITE_DOMAINS)
    if (host === domain || host.endsWith(`.${domain}`)) return site;
  return null;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A thread id started by T3's CLI or an agent: "mcp:<uuid>".
const MCP_THREAD_RE = /^mcp:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Any T3 thread id, as found in a deep link. The server allows the same set.
const ANY_THREAD_RE = /^[A-Za-z0-9:%._-]{1,512}$/;

// The T3 Code thread id in pasted text: a bare thread id (a UUID or
// "mcp:<uuid>") or a t3code://threads/<environment>/<thread> deep link.
// Bare UUIDs are lowercased, so matching is exact. Null for anything else.
export function parseThreadId(text: string): string | null {
  const s = text.trim();
  if (UUID_RE.test(s) || MCP_THREAD_RE.test(s)) return s.toLowerCase();
  const m = s.match(/^t3code(?:-[a-z]+)?:\/\/threads\/[^/]+\/([^/?#]+)/i);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  if (UUID_RE.test(id)) return id.toLowerCase();
  return ANY_THREAD_RE.test(id) ? id : null;
}
