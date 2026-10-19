import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  AgentsStatus,
  Cache,
  Card,
  CardContext,
  ContextProject,
  ContextTab,
  ContextType,
  LinearResource,
} from "./types";
import { createContext, loadContext, saveContextProject, saveContextTab } from "./api";
import { domainName, linkKind } from "./links";
import { CardLink, IssueLine, PrLine, ThreadBadge, WorkspaceTag, resourceLabel } from "./Badges";
import { ComplexityBars } from "./Complexity";
import { NeedsYouBanner } from "./NeedsYou";
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

// Each type borrows the icon and color of its first tab.
const TYPE_TAB: Record<ContextType, string> = { regular: "business", bug: "bug", research: "summary" };

const QA_STATUSES = ["Pass", "Fail", "Blocked", "Not run", "Skipped"] as const;

const PROJECT_FIELDS: { key: "summary" | "status" | "next" | "owner"; label: string; placeholder: string }[] = [
  { key: "summary", label: "Goal", placeholder: "The goal, or what failed, in a sentence or two" },
  { key: "status", label: "Status", placeholder: "Where it stands now" },
  { key: "next", label: "Next", placeholder: "The next action" },
  { key: "owner", label: "Owner", placeholder: "Who owns it" },
];

// Each standard tab gets an icon and a color from the card color presets, so
// the tab list and the progress meter read at a glance. Extra tabs use the
// card's own color.
const TAB_COLOR: Record<string, string> = {
  business: "#30a46c",
  bug: "#e5484d",
  summary: "#3b9eff",
  decisions: "#8e4ec6",
  implementation: "#3b9eff",
  qa: "#f76b15",
  monitoring: "#e93d82",
  "learn-more": "#ffb224",
  references: "#5b8fb0",
};

const TAB_ICON: Record<string, ReactNode> = {
  business: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  bug: (
    <>
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3 3 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </>
  ),
  summary: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  decisions: (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  implementation: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  qa: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  monitoring: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  "learn-more": (
    <>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </>
  ),
  references: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
};

const EXTRA_ICON = (
  <>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </>
);

function TabIcon({ id, size = 15 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TAB_ICON[id] ?? EXTRA_ICON}
    </svg>
  );
}

const tabStyle = (id: string) => ({ "--tab-color": TAB_COLOR[id] ?? "var(--ctx)" }) as CSSProperties;

// "2026-10-16" as "Oct 16, 2026", read as a local date.
function shortDate(ymd?: string): string | undefined {
  const m = ymd?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || undefined;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// The tab being edited: its text, and the hash of the version it started from.
type TabDraft = { id: string; text: string; baseHash: string; conflict?: boolean };

// A card's project context: the shared memory agents read before they start
// and keep current as they work. One page per card: the tabs on the left, with
// the open tab's sections under it, the open tab in the middle, and the card
// and project info (goal, status, next step, links, workspaces) in a sidebar on
// the right. Tabs are Markdown files in tasks-data/context/<card id>/, so
// agents can edit them too; the page reloads when they do.
export function ContextPage({
  card,
  cardId,
  tab: tabParam,
  onTab,
  onClose,
  onEditCard,
  tick,
  active,
  agents,
  cache,
  repoNames,
  colorTags,
  isLoud,
}: {
  card?: Card;
  cardId: string;
  tab?: string;
  onTab: (tab: string) => void;
  onClose: () => void;
  // Opens the card editor, from the card title in the sidebar.
  onEditCard: () => void;
  // Changes when this card's context changed on disk.
  tick: number;
  // False while a modal is open over the page, so Escape belongs to it.
  active: boolean;
  agents: AgentsStatus;
  cache: Cache;
  repoNames?: Record<string, string>;
  colorTags?: Record<string, string>;
  // Whether the card's "Needs you" message shows high-contrast, as on the board.
  isLoud: (card: Card) => boolean;
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

  const index = current?.id === "decisions" && !draft ? decisionHeadings(current.content) : headings;
  const showIndex = !masked && !draft && !current?.empty && index.length > 0;
  const filled = tabs.filter((t) => !t.empty).length;

  return (
    <div
      className="context-page"
      style={card?.color ? ({ "--card-color": card.color } as CSSProperties) : undefined}
    >
      <nav className="context-nav" aria-label="Tabs">
        <button type="button" className="context-back" onClick={onClose} title="Back to the board (Esc)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Board
        </button>
        {ctx && (
          <>
            <div className="context-progress" title={`${filled} of ${tabs.length} tabs filled in`}>
              <div className="context-progress-head">
                <span className="context-nav-label">Project context</span>
                <span className="hint">
                  {filled}/{tabs.length}
                </span>
              </div>
              <div className="context-progress-bars">
                {tabs.map((t) => (
                  <span key={t.id} className={`context-progress-bar${t.empty ? "" : " on"}`} style={tabStyle(t.id)} />
                ))}
              </div>
            </div>
            <div className="context-nav-items">
              {tabs.map((t) => {
                const isCurrent = t.id === current?.id;
                return (
                  <div key={t.id} className="context-nav-group">
                    <button
                      type="button"
                      className={`context-nav-item${isCurrent ? " active" : ""}${t.empty ? " empty" : ""}`}
                      style={tabStyle(t.id)}
                      title={t.empty ? `${t.label} (not filled in yet)` : t.label}
                      onClick={() => {
                        if (draft && draft.id !== t.id) return;
                        onTab(t.id);
                      }}
                      disabled={!!draft && draft.id !== t.id}
                    >
                      <span className="context-nav-icon">
                        <TabIcon id={t.id} />
                      </span>
                      <span className="context-nav-text">{t.label}</span>
                      {!t.required && <span className="context-nav-extra">extra</span>}
                    </button>
                    {isCurrent && showIndex && (
                      <div className="context-index" style={tabStyle(t.id)}>
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <main className="context-main" ref={mainRef}>
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
                <button
                  key={t}
                  type="button"
                  className="context-type-pick"
                  style={tabStyle(TYPE_TAB[t])}
                  onClick={() => create(t)}
                  disabled={!card}
                >
                  <span className="context-type-icon">
                    <TabIcon id={TYPE_TAB[t]} size={18} />
                  </span>
                  <strong>{TYPE_LABEL[t]}</strong>
                  <span className="hint">{TYPE_HINT[t]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          current && (
            <div className="context-tab" style={tabStyle(current.id)}>
              <div className="context-tab-head">
                <span className="context-tab-icon">
                  <TabIcon id={current.id} size={20} />
                </span>
                <div className="context-tab-titles">
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
                  <p className="hint">Agents working on this card fill it in as they go. You can also edit it yourself.</p>
                </div>
              ) : current.id === "decisions" ? (
                <DecisionsView text={current.content} />
              ) : (
                <>
                  {current.id === "qa" && <QaCounts text={current.content} />}
                  <Markdown key={current.id} text={current.content} onHeadings={setHeadings} />
                </>
              )}
            </div>
          )
        )}
      </main>

      <aside className="context-side" aria-label="Card">
        {card ? (
          <CardInfo
            card={card}
            agents={agents}
            tag={card.color ? colorTags?.[card.color] : undefined}
            loud={isLoud(card)}
            onEditCard={onEditCard}
          />
        ) : (
          <section className="context-card">
            <h1 className="context-card-title">Card not found</h1>
          </section>
        )}

        {ctx && (
          <section className="context-side-section">
            <div className="context-side-head">
              <h3>Project</h3>
              <span className="context-type-chip" style={tabStyle(TYPE_TAB[ctx.project.type] ?? "")}>
                {TYPE_LABEL[ctx.project.type] ?? ctx.project.type}
              </span>
              <span className="spacer" />
              {!header && (
                <button
                  type="button"
                  className="context-side-edit"
                  title="Edit the project fields"
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
              )}
            </div>
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
                {PROJECT_FIELDS.map((f) => (
                  <label key={f.key}>
                    <span>{f.label}</span>
                    <textarea
                      rows={f.key === "owner" ? 1 : f.key === "summary" ? 4 : 3}
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
                </div>
                <span className="hint">⌘↵ to save, Esc to cancel. Changing the type adds its tabs and keeps the others.</span>
              </div>
            ) : (
              <dl className="context-fields">
                {PROJECT_FIELDS.filter((f) => f.key !== "owner").map((f) => (
                  <div key={f.key} className={`context-field ${f.key}`}>
                    <dt>{f.label}</dt>
                    <dd className={ctx.project[f.key] ? "" : "hint"}>
                      {ctx.project[f.key] ? m("cardNotes", ctx.project[f.key]) : "Not set"}
                    </dd>
                  </div>
                ))}
                <div className="context-field-row">
                  <div>
                    <dt>Owner</dt>
                    <dd className={ctx.project.owner ? "" : "hint"}>{ctx.project.owner || "Not set"}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd title={ctx.project.created}>{shortDate(ctx.project.created) ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd title={ctx.project.updated}>{shortDate(ctx.project.updated) ?? "Unknown"}</dd>
                  </div>
                </div>
              </dl>
            )}
          </section>
        )}

        {card && <CardLinks card={card} cache={cache} repoNames={repoNames} />}

        {ctx && (
          <div className="context-dir hint" title={ctx.dir}>
            {ctx.dir.split("/").slice(-3).join("/")}
          </div>
        )}
      </aside>
    </div>
  );
}

// The card itself, as on the board: color tag, column, and size, then the
// title, the "Needs you" message, notes, and linked workspaces and threads.
function CardInfo({
  card,
  agents,
  tag,
  loud,
  onEditCard,
}: {
  card: Card;
  agents: AgentsStatus;
  tag?: string;
  loud: boolean;
  onEditCard: () => void;
}) {
  const { m } = useMask();
  const [notesOpen, setNotesOpen] = useState(false);
  // Long notes start clamped, so the project fields stay in view.
  const longNotes = !!card.notes && (card.notes.length > 320 || card.notes.split("\n").length > 6);
  return (
    <section className={`context-card${card.needsYou && loud ? " needs-you-loud" : ""}`}>
      <div className="context-card-meta">
        {tag && <span className="card-tag">{m("colorLabels", tag)}</span>}
        <span className="context-column">{m("columnNames", card.column)}</span>
        {card.hidden && <span className="context-column">Archived</span>}
        <span className="spacer" />
        {card.complexity && <ComplexityBars value={card.complexity} color={card.color} />}
      </div>
      <h1 className="context-card-title">
        <button type="button" onClick={onEditCard} title="Open the card">
          {m("cardTitles", card.title) || "(untitled)"}
        </button>
      </h1>
      {card.needsYou && <NeedsYouBanner value={card.needsYou} loud={loud} />}
      {card.notes && (
        <div className={`context-card-notes${notesOpen || !longNotes ? "" : " clamped"}`}>
          {m("cardNotes", card.notes)}
        </div>
      )}
      {longNotes && (
        <button type="button" className="context-more" onClick={() => setNotesOpen(!notesOpen)}>
          {notesOpen ? "Show less" : "Show all notes"}
        </button>
      )}
      {(!!card.workspaces?.length || !!card.threads?.length) && (
        <div className="context-workspaces">
          {card.workspaces?.map((id) => (
            <WorkspaceTag key={id} id={id} status={agents.workspaces[id]} />
          ))}
          {card.threads?.map((id) => (
            <ThreadBadge key={id} id={id} status={agents.threads?.[id]} compact />
          ))}
        </div>
      )}
    </section>
  );
}

// The card's links, grouped as on the board: Linear lines, then PR lines
// (merged last), then other links and the Linear items' docs.
function CardLinks({ card, cache, repoNames }: { card: Card; cache: Cache; repoNames?: Record<string, string> }) {
  const { m } = useMask();
  const urls = card.links.map((l) => l.url).filter((u) => u.trim());
  const linearUrls = urls.filter((u) => linkKind(u) === "linear");
  const prUrls = urls
    .filter((u) => linkKind(u) === "pr")
    .sort((a, b) => (cache.prs[a]?.state === "MERGED" ? 1 : 0) - (cache.prs[b]?.state === "MERGED" ? 1 : 0));
  const seen = new Set<string>();
  const other: { url: string; label: string; type?: LinearResource["type"] }[] = [];
  for (const l of card.links) {
    if (!l.url.trim() || linkKind(l.url) !== "generic" || seen.has(l.url)) continue;
    seen.add(l.url);
    other.push({ url: l.url, label: l.label?.trim() ? m("linkLabels", l.label.trim()) : domainName(l.url) });
  }
  for (const u of linearUrls) {
    for (const r of cache.issues[u]?.resources ?? []) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      other.push({
        url: r.url,
        label: r.title?.trim() ? m("linearResources", resourceLabel(r)) : resourceLabel(r),
        type: r.type ?? "link",
      });
    }
  }
  return (
    <>
      {linearUrls.length + prUrls.length > 0 && (
        <section className="context-side-section">
          <div className="context-side-head">
            <h3>Linear and PRs</h3>
          </div>
          <div className="status-lines">
            {linearUrls.map((u) => (
              <IssueLine key={u} url={u} status={cache.issues[u]} />
            ))}
            {prUrls.map((u) => (
              <PrLine key={u} url={u} status={cache.prs[u]} repoNames={repoNames} />
            ))}
          </div>
        </section>
      )}
      {other.length > 0 && (
        <section className="context-side-section">
          <div className="context-side-head">
            <h3>Links</h3>
          </div>
          <div className="context-links">
            {other.map((l) => (
              <CardLink key={l.url} url={l.url} label={l.label} type={l.type} />
            ))}
          </div>
        </section>
      )}
    </>
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
