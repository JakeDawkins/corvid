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

  function prRow(s: PrStatus) {
    const onBoard = existingPrUrls.has(s.url) || added.has(s.url);
    return (
      <div className="inbox-item" key={s.url}>
        <PrRow url={s.url} status={s} />
        {onBoard ? (
          <span className="hint">on board</span>
        ) : (
          <button className="btn" onClick={() => addPr(s)}>+ Add</button>
        )}
      </div>
    );
  }

  function linearRow(s: IssueStatus) {
    const onBoard = existingLinearUrls.has(s.url) || added.has(s.url);
    return (
      <div className="inbox-item" key={s.url}>
        <div className="inbox-linear">
          <IssueRow url={s.url} status={s} />
          <span className="inbox-linear-title" title={s.title}>{s.title}</span>
        </div>
        {onBoard ? (
          <span className="hint">on board</span>
        ) : (
          <button className="btn" onClick={() => addLinear(s)}>+ Add</button>
        )}
      </div>
    );
  }

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
                Open PRs <span className="count">{prs.length}</span>
              </h3>
              {githubError && <p className="hint error">{githubError}</p>}
              {!githubError && prs.length === 0 && (
                <p className="hint">No open PRs.</p>
              )}
              {prs.map(prRow)}
            </section>

            <section className="inbox-section">
              <h3>
                Assigned issues <span className="count">{issues.length}</span>
              </h3>
              {linearError && <p className="hint error">{linearError}</p>}
              {!linearError && issues.length === 0 && (
                <p className="hint">No assigned issues.</p>
              )}
              {issues.map(linearRow)}
            </section>

            <section className="inbox-section">
              <h3>
                Projects I lead <span className="count">{projects.length}</span>
              </h3>
              {!linearError && projects.length === 0 && (
                <p className="hint">No projects.</p>
              )}
              {projects.map(linearRow)}
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
