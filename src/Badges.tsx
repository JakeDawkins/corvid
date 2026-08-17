import type { IssueStatus, LinearResource, PrStatus } from "./types";

// A small glyph per resource type so Figma designs and Notion specs are
// scannable at a glance among a card's linked resources.
const RESOURCE_ICON: Record<NonNullable<LinearResource["type"]>, string> = {
  figma: "◆",
  notion: "▤",
  link: "↗",
};

// Label a resource by its title, falling back to the link's hostname.
function resourceLabel(r: LinearResource): string {
  if (r.title?.trim()) return r.title.trim();
  try {
    return new URL(r.url).hostname.replace(/^www\./, "");
  } catch {
    return r.url;
  }
}

function ciBadge(ci: PrStatus["ci"]) {
  switch (ci) {
    case "SUCCESS":
      return { text: "CI ✓", cls: "ok" };
    case "FAILURE":
    case "ERROR":
      return { text: "CI ✗", cls: "bad" };
    case "PENDING":
    case "EXPECTED":
      return { text: "CI …", cls: "run" };
    default:
      return null;
  }
}

function reviewBadge(d: PrStatus["reviewDecision"]) {
  switch (d) {
    case "APPROVED":
      return { text: "Approved", cls: "ok" };
    case "CHANGES_REQUESTED":
      return { text: "Changes requested", cls: "bad" };
    case "REVIEW_REQUIRED":
      return { text: "Review required", cls: "run" };
    default:
      return null;
  }
}

function stateBadge(s: PrStatus["state"], isDraft?: boolean) {
  if (isDraft) return { text: "Draft", cls: "muted" };
  switch (s) {
    case "OPEN":
      return { text: "Open", cls: "ok" };
    case "MERGED":
      return { text: "Merged", cls: "merged" };
    case "CLOSED":
      return { text: "Closed", cls: "muted" };
    default:
      return null;
  }
}

// Pick a single status color for the PR mini-card, in priority order:
// merged/closed/draft take precedence, then problems (red), then in-progress
// (yellow), then healthy (green). Falls back to a neutral accent.
function prCardClass(status?: PrStatus): string {
  if (!status || status.error) return "neutral";
  if (status.isDraft) return "muted";
  if (status.state === "MERGED") return "merged";
  if (status.state === "CLOSED") return "muted";
  if (
    status.ci === "FAILURE" ||
    status.ci === "ERROR" ||
    status.reviewDecision === "CHANGES_REQUESTED" ||
    status.unresolvedThreads
  )
    return "bad";
  if (
    status.ci === "PENDING" ||
    status.ci === "EXPECTED" ||
    status.reviewDecision === "REVIEW_REQUIRED"
  )
    return "run";
  if (status.reviewDecision === "APPROVED" || status.ci === "SUCCESS")
    return "ok";
  return "neutral";
}

function repoFromUrl(url: string) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { repo: `${m[1]}/${m[2]}`, number: m[3] } : null;
}

export function PrRow({ status, url }: { status?: PrStatus; url: string }) {
  const parsed = repoFromUrl(url);
  const number = status?.number ?? parsed?.number;
  const label = parsed
    ? `${parsed.repo}${number ? ` #${number}` : ""}`
    : `PR ${number ? `#${number}` : url.split("/").slice(-1)[0]}`;
  const badges = status
    ? [
        stateBadge(status.state, status.isDraft),
        ciBadge(status.ci),
        reviewBadge(status.reviewDecision),
        status.unresolvedThreads
          ? { text: `${status.unresolvedThreads} unresolved`, cls: "bad" }
          : null,
      ].filter(Boolean)
    : [];

  const merged = status?.state === "MERGED";

  return (
    <div className={`pr-card ${prCardClass(status)}`}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`pr-link${merged ? " merged" : ""}`}
        title={status?.title || url}
      >
        {label}
      </a>
      {status?.error ? (
        <span className="error-msg" title={status.error}>{status.error}</span>
      ) : (
        <div className="pr-badges">
          {badges.map((b, i) => (
            <span key={i} className={`badge ${b!.cls}`}>{b!.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function IssueRow({ status, url }: { status?: IssueStatus; url: string }) {
  const resources = status?.resources ?? [];
  return (
    <div className="issue">
      <div className="pr-row">
        <a href={url} target="_blank" rel="noreferrer" className="pr-link" title={status?.title || url}>
          {status?.identifier || "Linear"}
        </a>
        {status?.error ? (
          <span className="error-msg" title={status.error}>{status.error}</span>
        ) : status?.stateName ? (
          <span
            className="badge"
            style={{
              background: (status.stateColor || "#888") + "22",
              color: status.stateColor || "#888",
              borderColor: (status.stateColor || "#888") + "66",
            }}
          >
            {status.stateName}
          </span>
        ) : null}
      </div>
      {resources.length > 0 && (
        <div className="resources">
          {resources.map((r, i) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className={`chip resource ${r.type ?? "link"}`}
              title={r.title || r.url}
            >
              <span className="resource-icon">{RESOURCE_ICON[r.type ?? "link"]}</span>
              {resourceLabel(r)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
