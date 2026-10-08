import type { IssueStatus, LinearResource, PrStatus, WorkspaceStatus } from "./types";
import { useMask } from "./mask";
import { domainName } from "./links";
import { ClaudeLogo } from "./ClaudeLogo";

// A small glyph per resource type so Figma designs and Notion specs are
// scannable at a glance among a card's linked resources.
const RESOURCE_ICON: Record<NonNullable<LinearResource["type"]>, string> = {
  figma: "◆",
  notion: "▤",
  link: "↗",
};

// A card link as plain muted text with a small icon: the link glyph for the
// card's own links, or a resource glyph for docs pulled from its Linear items.
export function CardLink({
  url,
  label,
  type,
}: {
  url: string;
  label: string;
  type?: LinearResource["type"];
}) {
  const { m } = useMask();
  return (
    <a href={url} target="_blank" rel="noreferrer" className="card-link" title={m("urls", url)}>
      {type ? (
        <span className="resource-icon">{RESOURCE_ICON[type]}</span>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
      <span>{label}</span>
    </a>
  );
}

type Activity = NonNullable<WorkspaceStatus["activity"]>;

const ACTIVITY_LABEL: Record<Activity, string> = {
  working: "Working",
  waiting: "Waiting",
  idle: "",
};

// The mark's motion per state: spinning while working, a slow pulse while
// waiting on a background task or scheduled wakeup, still while idle.
const LOGO_MOTION: Record<Activity, string> = {
  working: " spinning",
  waiting: " pulsing",
  idle: "",
};

// Shared bits of a workspace's status for the tag and badge.
function useWorkspaceInfo(id: string, status?: WorkspaceStatus) {
  const { m } = useMask();
  const activity: Activity = status?.activity ?? (status?.working ? "working" : "idle");
  const name = status?.name ?? id.slice(0, 8);
  const archived = status?.state === "archived";
  const lines = status
    ? [
        [status.repo && m("repoNames", status.repo), status.branch && m("branches", status.branch)]
          .filter(Boolean)
          .join(" · "),
      ]
    : ["Not found in Conductor"];
  if (activity === "waiting") {
    if (status?.wakeAt) {
      const at = new Date(status.wakeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      lines.push(`Next check at ${at}`);
    }
    for (const w of status?.waitingOn ?? []) lines.push(`Waiting on: ${w}`);
  }
  const title = [`Open ${name} in Conductor`, ...lines.filter(Boolean)].join("\n");
  return { activity, name, archived, title };
}

// A linked Conductor workspace in a card's footer: muted name and mark while
// idle, Claude orange with a spinning mark and "Working" while an agent is
// active, and a dimmer orange with a pulsing mark and "Waiting" while it's
// idle but due to resume on its own (background task or scheduled wakeup).
export function WorkspaceTag({ id, status }: { id: string; status?: WorkspaceStatus }) {
  const { activity, name, archived, title } = useWorkspaceInfo(id, status);
  return (
    <a
      href={`conductor://workspace?id=${encodeURIComponent(id)}`}
      className={`workspace-tag ${activity}`}
      title={title}
    >
      <ClaudeLogo className={`claude-logo${LOGO_MOTION[activity]}`} />
      <span>
        {activity !== "idle" && `${ACTIVITY_LABEL[activity]} · `}
        {name}
        {archived && " (archived)"}
      </span>
    </a>
  );
}

// A linked Conductor workspace, linking to it in the Conductor app. Always shown
// while linked; switches to a Claude-orange "Working" state with a spinning
// mark while an agent is active, or a softer "Waiting" state with a pulsing
// mark while it's due to resume on its own.
export function WorkspaceBadge({ id, status }: { id: string; status?: WorkspaceStatus }) {
  const { activity, name, archived, title } = useWorkspaceInfo(id, status);
  return (
    // No target: a custom-scheme link hands off to the app without opening a tab.
    <a
      href={`conductor://workspace?id=${encodeURIComponent(id)}`}
      className={`chip workspace-badge ${activity}`}
      title={title}
    >
      <ClaudeLogo className={`claude-logo${LOGO_MOTION[activity]}`} />
      {activity !== "idle" && <span className="workspace-badge-state">{ACTIVITY_LABEL[activity]}</span>}
      <span>
        {name}
        {archived && " (archived)"}
      </span>
    </a>
  );
}

// Label a resource by its title, falling back to the link's hostname.
export function resourceLabel(r: LinearResource): string {
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

// Pick a single status color for a PR's status dot, in priority order:
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

// Resolve a repo's display name, applying a "owner/repo" override from
// data.repoNames (matched case-insensitively) when one is set.
function repoLabel(slug: string, repoNames?: Record<string, string>): string {
  if (!repoNames) return slug;
  if (repoNames[slug]) return repoNames[slug];
  const lower = slug.toLowerCase();
  for (const [key, name] of Object.entries(repoNames)) {
    if (key.toLowerCase() === lower) return name;
  }
  return slug;
}

// A card's PR as one flat line: a dot for its overall status, the repo (without
// owner, unless renamed in data.repoNames) and number, then review, CI, and
// unresolved threads on the right. Merged/closed PRs show just their state; the
// full detail is always in the hover text. `detailed` (the card detail view)
// leads with the PR title, with the repo and number after it.
export function PrLine({
  status,
  url,
  repoNames,
  detailed,
}: {
  status?: PrStatus;
  url: string;
  repoNames?: Record<string, string>;
  detailed?: boolean;
}) {
  const { m } = useMask();
  const parsed = repoFromUrl(url);
  const number = status?.number ?? parsed?.number;
  const repo = parsed
    ? repoLabel(parsed.repo, repoNames) === parsed.repo
      ? parsed.repo.split("/")[1]
      : repoLabel(parsed.repo, repoNames)
    : "PR";
  const open = status?.state === "OPEN";
  const ci = ciBadge(status?.ci);
  const review = reviewBadge(status?.reviewDecision);
  const state = stateBadge(status?.state, status?.isDraft);
  const unresolved = status?.unresolvedThreads ?? 0;
  const tip = [
    m("prTitles", status?.title) || m("urls", url),
    state?.text,
    ci?.text,
    review?.text,
    unresolved ? `${unresolved} unresolved` : null,
    status?.error,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`status-line${status?.state === "MERGED" ? " done" : ""}${detailed ? " detailed" : ""}`}
      title={tip}
    >
      <span className={`status-dot ${prCardClass(status)}`} />
      <span className="status-label">
        {detailed && status?.title && (
          <span className="status-title">{m("prTitles", status.title)}</span>
        )}
        <span className="status-name">{m("repoNames", repo)}</span>
        {number && <span className="status-num">#{number}</span>}
      </span>
      <span className="status-meta">
        {status?.error ? (
          <span className="bad">Error</span>
        ) : (
          <>
            {state && state.text !== "Open" && <span>{state.text}</span>}
            {open && review && (
              <span className={review.cls}>
                {review.cls === "bad" ? "Changes" : review.cls === "run" ? "Review" : review.text}
              </span>
            )}
            {open && ci && <span className={`strong ${ci.cls}`}>{ci.text}</span>}
            {unresolved > 0 && (
              <span className="strong bad threads">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {unresolved}
              </span>
            )}
          </>
        )}
      </span>
    </a>
  );
}

// A card's Linear issue/project as one flat line: a dot in its workflow-state
// color, its identifier (or project name), and the state name on the right.
// Its linked resources render with the card's other links, not here.
export function IssueLine({
  status,
  url,
  label: labelOverride,
  detailed,
}: {
  status?: IssueStatus;
  url: string;
  // Replaces the default identifier/project-name label.
  label?: string;
  // Leads with the issue title, with the identifier after it (detail view).
  detailed?: boolean;
}) {
  const { m } = useMask();
  const label =
    labelOverride ??
    (status?.identifier && status.identifier !== "Project"
      ? status.identifier
      : m("linearTitles", status?.title) || "Linear");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`status-line${detailed ? " detailed" : ""}`}
      title={[m("linearTitles", status?.title) || m("urls", url), status?.error].filter(Boolean).join("\n")}
    >
      <span
        className="status-dot"
        style={{ background: (!status?.error && status?.stateColor) || "var(--muted)" }}
      />
      <span className="status-label">
        {detailed && status?.title && label !== m("linearTitles", status.title) && (
          <span className="status-title">{m("linearTitles", status.title)}</span>
        )}
        <span className="status-name">{label}</span>
      </span>
      <span className="status-meta">
        {status?.error ? <span className="bad">Error</span> : status?.stateName}
      </span>
    </a>
  );
}

// A card's freeform link as a flat line like PrLine and IssueLine: a gray dot
// (there's no status to show), then its label with the site name muted after
// it, or just the site name if it has no label.
export function GenericLine({ url, label }: { url: string; label?: string }) {
  const { m } = useMask();
  const site = domainName(url);
  const title = label ? m("linkLabels", label) : undefined;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="status-line detailed"
      title={m("urls", url)}
    >
      <span className="status-dot muted" />
      <span className="status-label">
        <span className="status-title">{title || site}</span>
        {title && <span className="status-name">{site}</span>}
      </span>
    </a>
  );
}
