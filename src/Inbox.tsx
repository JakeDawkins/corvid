import { useEffect, useState } from "react";
import type { IssueStatus, PrStatus } from "./types";
import { loadInbox } from "./api";
import { linearKey } from "./links";
import { IssueRow, PrRow } from "./Badges";

export type DragItem =
  | { kind: "pr"; status: PrStatus }
  | { kind: "linear"; status: IssueStatus };

// A right-side sidebar listing my open PRs and Linear issues/projects assigned
// to me. Each row can be dropped onto a card via its drag handle (to link it)
// or added as a new card with the + button.
export function Inbox({
  targetColumn,
  existingPrUrls,
  existingLinearKeys,
  onAddPr,
  onAddLinear,
  onDragItem,
  onDragEnd,
  onClose,
}: {
  targetColumn?: string;
  existingPrUrls: Set<string>;
  existingLinearKeys: Set<string>;
  onAddPr: (status: PrStatus) => void;
  onAddLinear: (status: IssueStatus) => void;
  onDragItem: (item: DragItem) => void;
  onDragEnd: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [prs, setPrs] = useState<PrStatus[]>([]);
  const [issues, setIssues] = useState<IssueStatus[]>([]);
  const [projects, setProjects] = useState<IssueStatus[]>([]);
  const [githubError, setGithubError] = useState<string>();
  const [linearError, setLinearError] = useState<string>();
  // Locally track what we've added this session so the row flips immediately.
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadInbox()
      .then((inbox) => {
        setPrs(inbox.prs);
        setIssues(inbox.issues);
        setProjects(inbox.projects);
        setGithubError(inbox.githubError);
        setLinearError(inbox.linearError);
      })
      .finally(() => setLoading(false));
  }, []);

  function addPr(s: PrStatus) {
    onAddPr(s);
    setAdded((a) => new Set(a).add(s.url));
  }
  function addLinear(s: IssueStatus) {
    onAddLinear(s);
    setAdded((a) => new Set(a).add(s.url));
  }

  // Only surface items not already on the board (or just added this session).
  const onBoardPr = (url: string) => existingPrUrls.has(url) || added.has(url);
  const onBoardLinear = (url: string) =>
    existingLinearKeys.has(linearKey(url)) || added.has(url);
  const openPrs = prs.filter((s) => !onBoardPr(s.url));
  const openIssues = issues.filter((s) => !onBoardLinear(s.url));
  const openProjects = projects.filter((s) => !onBoardLinear(s.url));

  function handle(item: DragItem) {
    return (
      <span
        className="drag-handle"
        draggable
        title="Drag onto a card to link"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "link";
          onDragItem(item);
        }}
        onDragEnd={onDragEnd}
      >
        ⠿
      </span>
    );
  }

  function prRow(s: PrStatus) {
    return (
      <div className="inbox-item" key={s.url}>
        {handle({ kind: "pr", status: s })}
        <div className="inbox-main">
          <span className="inbox-title" title={s.title}>{s.title || s.url}</span>
          <PrRow url={s.url} status={s} />
        </div>
        <button className="btn" onClick={() => addPr(s)}>+ Add</button>
      </div>
    );
  }

  function linearRow(s: IssueStatus) {
    return (
      <div className="inbox-item" key={s.url}>
        {handle({ kind: "linear", status: s })}
        <div className="inbox-main">
          <span className="inbox-title" title={s.title}>{s.title || s.url}</span>
          <IssueRow url={s.url} status={s} />
        </div>
        <button className="btn" onClick={() => addLinear(s)}>+ Add</button>
      </div>
    );
  }

  // Distinguish "nothing exists" from "everything's already on the board".
  const emptyMsg = (raw: number, kind: string) =>
    raw > 0 ? "All on the board." : `No ${kind}.`;

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h2>My work</h2>
        <button className="btn ghost" onClick={onClose} title="Close">✕</button>
      </div>
      <p className="hint sidebar-hint">
        Drag ⠿ onto a card to link, or + Add
        {targetColumn ? ` to “${targetColumn}”` : ""}.
      </p>

      <div className="sidebar-body">
        {loading ? (
          <p className="hint">Loading…</p>
        ) : (
          <>
            <section className="inbox-section">
              <h3>
                Open PRs <span className="count">{openPrs.length}</span>
              </h3>
              {githubError && <p className="hint error">{githubError}</p>}
              {!githubError && openPrs.length === 0 && (
                <p className="hint">{emptyMsg(prs.length, "open PRs")}</p>
              )}
              {openPrs.map(prRow)}
            </section>

            <section className="inbox-section">
              <h3>
                Assigned issues <span className="count">{openIssues.length}</span>
              </h3>
              {linearError && <p className="hint error">{linearError}</p>}
              {!linearError && openIssues.length === 0 && (
                <p className="hint">{emptyMsg(issues.length, "assigned issues")}</p>
              )}
              {openIssues.map(linearRow)}
            </section>

            <section className="inbox-section">
              <h3>
                Projects I lead <span className="count">{openProjects.length}</span>
              </h3>
              {!linearError && openProjects.length === 0 && (
                <p className="hint">{emptyMsg(projects.length, "projects")}</p>
              )}
              {openProjects.map(linearRow)}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
