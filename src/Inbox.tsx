import { useEffect, useState } from "react";
import type { IssueStatus, PrStatus } from "./types";
import { loadInbox } from "./api";
import { IssueRow, PrRow } from "./Badges";

// A drawer listing my open PRs and Linear issues/projects assigned to me, each
// with a one-click "Add" that drops a card into the first column of the board.
export function Inbox({
  targetColumn,
  existingPrUrls,
  existingLinearUrls,
  onAddPr,
  onAddLinear,
  onClose,
}: {
  targetColumn?: string;
  existingPrUrls: Set<string>;
  existingLinearUrls: Set<string>;
  onAddPr: (status: PrStatus) => void;
  onAddLinear: (status: IssueStatus) => void;
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
    existingLinearUrls.has(url) || added.has(url);
  const openPrs = prs.filter((s) => !onBoardPr(s.url));
  const openIssues = issues.filter((s) => !onBoardLinear(s.url));
  const openProjects = projects.filter((s) => !onBoardLinear(s.url));

  function prRow(s: PrStatus) {
    return (
      <div className="inbox-item" key={s.url}>
        <PrRow url={s.url} status={s} />
        <button className="btn" onClick={() => addPr(s)}>+ Add</button>
      </div>
    );
  }

  function linearRow(s: IssueStatus) {
    return (
      <div className="inbox-item" key={s.url}>
        <div className="inbox-linear">
          <IssueRow url={s.url} status={s} />
          <span className="inbox-linear-title" title={s.title}>{s.title}</span>
        </div>
        <button className="btn" onClick={() => addLinear(s)}>+ Add</button>
      </div>
    );
  }

  // Distinguish "nothing exists" from "everything's already on the board".
  const emptyMsg = (raw: number, kind: string) =>
    raw > 0 ? "All on the board." : `No ${kind}.`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal inbox" onClick={(e) => e.stopPropagation()}>
        <h2>
          My work
          {targetColumn && (
            <span className="hint"> — adds to “{targetColumn}”</span>
          )}
        </h2>

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

        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
