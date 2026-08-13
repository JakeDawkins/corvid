import type { IssueStatus, PrStatus } from "./types";

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
    <div className="pr-row">
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
        badges.map((b, i) => (
          <span key={i} className={`badge ${b!.cls}`}>{b!.text}</span>
        ))
      )}
    </div>
  );
}

export function IssueRow({ status, url }: { status?: IssueStatus; url: string }) {
  return (
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
  );
}
