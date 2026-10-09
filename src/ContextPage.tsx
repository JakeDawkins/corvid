import { useEffect, useRef, useState } from "react";
import type { AgentsStatus, Cache, Card, CardContext, ContextProject, ContextTab, ContextType } from "./types";
import { createContext, loadContext, saveContextProject, saveContextTab } from "./api";
import { linkKind } from "./links";
import { GenericLine, IssueLine, PrLine, WorkspaceBadge } from "./Badges";
import { Markdown, countStatuses, statusClass } from "./Markdown";
import type { Heading } from "./Markdown";
import { DecisionsView, decisionHeadings } from "./Decisions";
import { useMask } from "./mask";

export const TYPE_LABEL: Record<ContextType, string> = {
  regular: "Regular project",
  bug: "Bug",
  research: "Research",
};

const TYPE_HINT: Record<ContextType, string> = {
  regular: "Something we build or change: a feature, an experiment, a migration.",
  bug: "Something that broke: a defect, an incident, a regression.",
  research: "A question we answer, with no build. A fix becomes its own card.",
};

const QA_STATUSES = ["Pass", "Fail", "Blocked", "Not run", "Skipped"] as const;

const HEADER_FIELDS: { key: "summary" | "status" | "owner" | "next"; label: string; placeholder: string }[] = [
  { key: "summary", label: "Goal", placeholder: "The goal, or what failed, in a sentence or two" },
  { key: "status", label: "Status", placeholder: "Where it stands now" },
  { key: "owner", label: "Owner", placeholder: "Who owns it" },
  { key: "next", label: "Next", placeholder: "The next action" },
];

// The tab being edited: its text, and the hash of the version it started from.
type TabDraft = { id: string; text: string; baseHash: string; conflict?: boolean };

// A card's project context: the shared memory agents read before they start
// and keep current as they work. One page per card, with a header (goal,
// status, owner, next step, links, workspaces), a tab per topic on the left,
// and the open tab's sections on the right. Tabs are Markdown files in
// tasks-data/context/<card id>/, so agents can edit them too; the page reloads
// when they do.
export function ContextPage({
  card,
  cardId,
  tab: tabParam,
  onTab,
  onClose,
  onOpenCard,
  tick,
  active,
  agents,
  cache,
  repoNames,
}: {
  card?: Card;
  cardId: string;
  tab?: string;
  onTab: (tab: string) => void;
  onClose: () => void;
  onOpenCard: () => void;
  // Changes when this card's context changed on disk.
  tick: number;
  // False while a modal is open over the page, so Escape belongs to it.
  active: boolean;
  agents: AgentsStatus;
  cache: Cache;
  repoNames?: Record<string, string>;
}) {
  const { m, on } = useMask();
  // undefined while loading, null when the card has no context.
  const [ctx, setCtx] = useState<CardContext | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<TabDraft | null>(null);
  const [header, setHeader] = useState<Partial<ContextProject> | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    loadContext(cardId)
      .then((c) => live && setCtx(c))
      .catch(() => live && setError("Couldn't load the context"));
    return () => {
      live = false;
    };
  }, [cardId, tick]);

  const editingRef = useRef(false);
  editingRef.current = !!draft || !!header;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  const tabs = ctx?.tabs ?? [];
  const current: ContextTab | undefined = tabs.find((t) => t.id === tabParam) ?? tabs[0];

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [current?.id]);

  const masked = on("cardNotes");
  const title = card ? m("cardTitles", card.title) || "(untitled)" : "Card not found";

  async function create(type: ContextType) {
    const res = await createContext(cardId, type);
    if (res.error) setError(res.error);
    setCtx(res.context);
  }

  async function saveTab(force = false) {
    if (!draft) return;
    const base = force ? (ctx?.tabs.find((t) => t.id === draft.id)?.hash ?? draft.baseHash) : draft.baseHash;
    const res = await saveContextTab(cardId, draft.id, draft.text, base);
    if (res.context) setCtx(res.context);
    if (res.conflict) setDraft({ ...draft, conflict: true });
    else if (res.error) setError(res.error);
    else setDraft(null);
  }

  async function saveHeader() {
    if (!header) return;
    const res = await saveContextProject(cardId, header);
    if (res.context) setCtx(res.context);
    if (res.error) setError(res.error);
    else setHeader(null);
  }

  function startEdit(t: ContextTab) {
    setDraft({ id: t.id, text: t.content, baseHash: t.hash });
  }

  const links = card?.links.filter((l) => l.url.trim()) ?? [];
  const workspaces = card?.workspaces ?? [];
  const index = current?.id === "decisions" && !draft ? decisionHeadings(current.content) : headings;

  return (
    <div className="context-page">
      <header className="context-head">
        <button type="button" className="btn ghost" onClick={onClose} title="Back to the board (Esc)">
          ← Board
        </button>
        {ctx && <span className="chip context-type">{TYPE_LABEL[ctx.project.type] ?? ctx.project.type}</span>}
        <h1 className="context-title">{title}</h1>
        <span className="spacer" />
        {workspaces.map((id) => (
          <WorkspaceBadge key={id} id={id} status={agents.workspaces[id]} />
        ))}
        {card && (
          <button type="button" className="btn" onClick={onOpenCard}>
            Card details
          </button>
        )}
      </header>

      {error && (
        <div className="context-error hint error" role="alert">
          {error}{" "}
          <button type="button" className="btn ghost" onClick={() => setError(undefined)}>
            Dismiss
          </button>
        </div>
      )}

      {masked ? (
        <div className="context-empty">
          <p className="hint">Context is hidden while masked mode is on (Shift+M to turn it off).</p>
        </div>
      ) : ctx === undefined ? (
        <div className="context-empty hint">Loading…</div>
      ) : ctx === null ? (
        <div className="context-empty">
          <h2>No project context yet</h2>
          <p>
            Context is this card's project memory: why we do it, what we decided, how it works, how we test it, and
            every link. Agents working on the card read it before they start and keep it current as they work, so the
            next thread starts where the last one stopped.
          </p>
          <p className="hint">Pick the kind of project. It decides the tabs.</p>
          <div className="context-types">
            {(Object.keys(TYPE_LABEL) as ContextType[]).map((t) => (
              <button key={t} type="button" className="context-type-pick" onClick={() => create(t)} disabled={!card}>
                <strong>{TYPE_LABEL[t]}</strong>
                <span className="hint">{TYPE_HINT[t]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <section className="context-summary">
            {header ? (
              <div className="context-header-form">
                <label>
                  <span>Type</span>
                  <select
                    value={header.type ?? ctx.project.type}
                    onChange={(e) => setHeader({ ...header, type: e.target.value as ContextType })}
                  >
                    {(Object.keys(TYPE_LABEL) as ContextType[]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
                {HEADER_FIELDS.map((f) => (
                  <label key={f.key}>
                    <span>{f.label}</span>
                    <textarea
                      rows={f.key === "summary" ? 2 : 1}
                      placeholder={f.placeholder}
                      value={header[f.key] ?? ""}
                      onChange={(e) => setHeader({ ...header, [f.key]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void saveHeader();
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setHeader(null);
                        }
                      }}
                    />
                  </label>
                ))}
                <div className="detail-edit-actions">
                  <button type="button" className="btn primary" onClick={saveHeader}>
                    Save
                  </button>
                  <button type="button" className="btn" onClick={() => setHeader(null)}>
                    Cancel
                  </button>
                  <span className="hint">⌘↵ to save, Esc to cancel. Changing the type adds its tabs and keeps the others.</span>
                </div>
              </div>
            ) : (
              <dl className="context-fields">
                {HEADER_FIELDS.map((f) => (
                  <div key={f.key} className={f.key === "summary" ? "wide" : ""}>
                    <dt>{f.label}</dt>
                    <dd className={ctx.project[f.key] ? "" : "hint"}>{ctx.project[f.key] || "Not set"}</dd>
                  </div>
                ))}
                <div>
                  <dt>Updated</dt>
                  <dd>{ctx.project.updated || "Unknown"}</dd>
                </div>
                <button
                  type="button"
                  className="btn ghost context-edit-header"
                  onClick={() =>
                    setHeader({
                      type: ctx.project.type,
                      summary: ctx.project.summary ?? "",
                      status: ctx.project.status ?? "",
                      owner: ctx.project.owner ?? "",
                      next: ctx.project.next ?? "",
                    })
                  }
                >
                  ✎ Edit
                </button>
              </dl>
            )}
            {links.length > 0 && (
              <div className="context-links">
                {links.map((l) => {
                  const kind = linkKind(l.url);
                  return (
                    <div key={l.url} className="link-row status-row">
                      {kind === "pr" ? (
                        <PrLine url={l.url} status={cache.prs[l.url]} repoNames={repoNames} />
                      ) : kind === "linear" ? (
                        <IssueLine url={l.url} status={cache.issues[l.url]} />
                      ) : (
                        <GenericLine url={l.url} label={l.label} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="context-body">
            <nav className="context-nav" aria-label="Tabs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`context-nav-item${t.id === current?.id ? " active" : ""}${t.empty ? " empty" : ""}`}
                  title={t.empty ? `${t.label} (not filled in yet)` : t.label}
                  onClick={() => {
                    if (draft && draft.id !== t.id) return;
                    onTab(t.id);
                  }}
                  disabled={!!draft && draft.id !== t.id}
                >
                  {t.label}
                  {!t.required && <span className="hint"> · extra</span>}
                </button>
              ))}
              <div className="context-dir hint" title={ctx.dir}>
                {ctx.dir.split("/").slice(-3).join("/")}
              </div>
            </nav>

            <main className="context-main" ref={mainRef}>
              {current && (
                <>
                  <div className="context-tab-head">
                    <div>
                      <h2>{current.label}</h2>
                      {current.question && <p className="context-question">{current.question}</p>}
                    </div>
                    {!draft && (
                      <button type="button" className="btn" onClick={() => startEdit(current)}>
                        ✎ Edit
                      </button>
                    )}
                  </div>
                  {draft?.id === current.id ? (
                    <TabEditor
                      draft={draft}
                      onChange={(text) => setDraft({ ...draft, text })}
                      onSave={() => saveTab()}
                      onOverwrite={() => saveTab(true)}
                      onReload={() => startEdit(current)}
                      onCancel={() => setDraft(null)}
                    />
                  ) : current.empty ? (
                    <div className="context-guide">
                      <p>{current.guide ?? "Nothing here yet."}</p>
                      <p className="hint">
                        Agents working on this card fill it in as they go. You can also edit it yourself.
                      </p>
                    </div>
                  ) : current.id === "decisions" ? (
                    <DecisionsView text={current.content} />
                  ) : (
                    <>
                      {current.id === "qa" && <QaCounts text={current.content} />}
                      <Markdown key={current.id} text={current.content} onHeadings={setHeadings} />
                    </>
                  )}
                </>
              )}
            </main>

            <aside className="context-index">
              {index.length > 0 && !draft && !current?.empty && (
                <>
                  <h3>On this tab</h3>
                  {index.map((h) => (
                    <a
                      key={h.id}
                      href={`#${h.id}`}
                      className={h.level === 3 ? "sub" : ""}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      {h.text}
                    </a>
                  ))}
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// Counts of QA check statuses, from the tables with a Status column.
function QaCounts({ text }: { text: string }) {
  const counts = countStatuses(text, QA_STATUSES);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <div className="qa-counts">
      <span className="hint">
        {total} check{total === 1 ? "" : "s"}:
      </span>
      {QA_STATUSES.filter((s) => counts[s]).map((s) => (
        <span key={s} className={`status-chip ${statusClass(s) ?? ""}`}>
          {counts[s]} {s}
        </span>
      ))}
    </div>
  );
}

function TabEditor({
  draft,
  onChange,
  onSave,
  onOverwrite,
  onReload,
  onCancel,
}: {
  draft: TabDraft;
  onChange: (text: string) => void;
  onSave: () => void;
  onOverwrite: () => void;
  onReload: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="context-editor">
      {draft.conflict && (
        <div className="context-conflict" role="alert">
          This tab changed on disk while you were editing it, probably by an agent.
          <button type="button" className="btn" onClick={onOverwrite}>
            Save mine anyway
          </button>
          <button type="button" className="btn" onClick={onReload}>
            Discard mine and reload
          </button>
        </div>
      )}
      <textarea
        autoFocus
        spellCheck
        value={draft.text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="detail-edit-actions">
        <button type="button" className="btn primary" onClick={onSave}>
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <span className="hint">Markdown. ⌘↵ to save, Esc to cancel. Text in &lt;!-- comments --&gt; is hidden on the page.</span>
      </div>
    </div>
  );
}
