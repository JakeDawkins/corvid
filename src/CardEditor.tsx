import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import type { AgentsStatus, Cache, Card, ConductorRepo, Link, NeedsYou } from "./types";
import { loadConductorRepos } from "./api";
import { domainName, linkKind } from "./links";
import { IssueLine, LinkChip, PrLine, WorkspaceBadge } from "./Badges";
import { COLORS, textOn } from "./colors";
import { ComplexityPicker } from "./Complexity";
import { NeedsYouBanner } from "./NeedsYou";
import { useMask } from "./mask";

// Human label for a link's auto-detected kind, shown beside each link row.
const KIND_LABEL: Record<ReturnType<typeof linkKind>, string> = {
  pr: "PR",
  linear: "Linear",
  generic: "Link",
};

// Tooltip on fields made read-only by masked mode, which shows placeholder text.
const MASKED_HINT = "Masked mode is on (Shift+M to turn off)";

// Chip text for an untitled link: its kind for PRs/Linear, else its site name
// (matching how the card itself labels untitled links).
function chipFallback(url: string): string {
  const kind = linkKind(url);
  return kind === "generic" ? domainName(url) : KIND_LABEL[kind];
}

// Last path segment, as a fallback name for a repo Conductor no longer lists.
function baseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

// The fields of `next` that differ from `prev`, so saving only writes what the
// user edited and leaves fields an agent changed meanwhile (e.g. a linked
// workspace or PR) alone.
function changedFields(prev: Card, next: Card): Partial<Card> {
  const changes: Partial<Card> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)] as (keyof Card)[]);
  for (const k of keys) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      (changes as Record<string, unknown>)[k] = next[k];
    }
  }
  return changes;
}

// Build a paste-ready instruction for an AI agent to work on this card: the
// task, its links (so the agent has full context), and standing instructions
// to link its Conductor workspace and any PR it opens back to this card (by
// id) on the Corvid board, and to flag the card when it's waiting on the user.
function buildAgentPrompt(card: Card): string {
  const lines: string[] = [];
  lines.push("Work on the following task from my Corvid board.");
  lines.push("");
  lines.push(`Task: ${card.title.trim() || "(untitled)"}`);
  lines.push(`Card ID: ${card.id}`);
  if (card.complexity) lines.push(`Estimated complexity: ${card.complexity}`);
  if (card.notes?.trim()) {
    lines.push("");
    lines.push("Notes:");
    lines.push(card.notes.trim());
  }
  const real = card.links.filter((l) => l.url.trim());
  if (real.length) {
    lines.push("");
    lines.push("Relevant links:");
    for (const l of real) {
      const label = l.label.trim() ? `${l.label.trim()} — ` : "";
      lines.push(`- ${label}${KIND_LABEL[linkKind(l.url)]}: ${l.url}`);
    }
  }
  lines.push("");
  lines.push(
    `Before you start, if you are running in Conductor, link your workspace to this card so the board shows when you're working on it: with the corvid skill, run \`link-workspace ${card.id}\`. It reads $CONDUCTOR_WORKSPACE_ID and does nothing if the card already has that workspace.`,
  );
  lines.push("");
  lines.push(
    `Whenever you open a pull request for this work, add its URL to this card (Card ID: ${card.id}) on the Corvid board so it stays in sync.`,
  );
  lines.push("");
  lines.push(
    `Whenever something is waiting on me (a question, a review, a decision, a drafted message to send, a manual step), flag this card with the corvid skill: \`needs-you ${card.id} --reason "<what's waiting>" --action "<exactly what I should do>"\`. Keep each to one short sentence, and make the action concrete (what to do and where). Clear it as soon as nothing is waiting on me anymore: \`clear-needs-you ${card.id}\`. Don't flag the card when you're done and nothing is waiting on me.`,
  );
  lines.push("");
  lines.push(
    "Work on this autonomously with the watch-and-fix skill: build it, draft the QA handoff for me, then watch Slack, the GitHub PRs, and Linear for QA and review feedback and fix what's relevant until the project is done. If the change should ship behind a Statsig experiment and none exists yet, set one up following the conventions of other experiments on the same surface, and test UI changes in a browser (the skill covers both). Never send a Slack message, Linear comment, or GitHub comment to a real person unless I ask you to. Draft it and flag this card instead.",
  );
  return lines.join("\n");
}

// Deep link that opens Conductor's new-workspace flow in the repo at `path`,
// with `prompt` as the first message. See conductor.build/docs/reference/deep-links.
function conductorLink(prompt: string, path: string): string {
  return `conductor://prompt=${encodeURIComponent(prompt)}&path=${encodeURIComponent(path)}`;
}

// A pasted string that is a single http(s) URL, i.e. something to add as a link.
const URL_RE = /^https?:\/\/\S+$/i;

// URLs inside notes, so the detail view can make them clickable. Trailing
// punctuation is left out of the match.
const NOTES_URL_RE = /(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]])/g;

// Notes as text, with URLs turned into links. split() with a capture group
// puts the matched URLs at the odd indices.
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(NOTES_URL_RE).map((part, i) =>
        i % 2 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function RemoveLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn ghost icon-btn"
      title="Remove link"
      aria-label="Remove link"
      onClick={onClick}
    >
      ✕
    </button>
  );
}

// Grow a textarea to fit its text; CSS max-height caps it, then it scrolls.
function useAutosize(ref: React.RefObject<HTMLTextAreaElement>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [ref, value]);
}

// The card's detail view. Everything is shown as it reads on the card and is
// editable in place: the title and link fields are inputs styled as text, and
// notes switch to a text box on click. Edits are kept in a draft and saved
// when the view closes.
export function CardEditor({
  card,
  columns,
  colorTags,
  cache,
  repoNames,
  onRefreshLinks,
  agents,
  needsYou,
  needsYouLoud,
  onClearNeedsYou,
  onSave,
  onCancel,
  onDelete,
  closeRef,
}: {
  card: Card;
  columns: string[];
  colorTags: Record<string, string>;
  // Fetched PR/Linear status, shown on those links' rows.
  cache: Cache;
  repoNames?: Record<string, string>;
  // Fetches fresh status for the PR/Linear links among `urls` into `cache`.
  onRefreshLinks: (urls: string[]) => void;
  agents: AgentsStatus;
  // The card's live "Needs you" message, which agents set and clear outside
  // the editor, so it's read from the board rather than this draft.
  needsYou?: NeedsYou;
  needsYouLoud: boolean;
  onClearNeedsYou: () => void;
  // Receives only the fields changed from `card`.
  onSave: (changes: Partial<Card>) => void;
  // Closes without saving (the Discard button).
  onCancel: () => void;
  onDelete: () => void;
  // Set to this editor's close(), so the parent can close it with a save (e.g.
  // when search opens another card).
  closeRef?: MutableRefObject<(() => void) | null>;
}) {
  const { m, on } = useMask();
  const [draft, setDraft] = useState<Card>({ ...card });
  const [promptCopied, setPromptCopied] = useState(false);

  function set<K extends keyof Card>(key: K, value: Card[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const [links, setLinks] = useState<Link[]>(card.links);
  // The link being added, not yet in `links`. The label box appears once
  // there's a URL, and pasting a URL focuses it so the link can be named
  // before it's added.
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const newUrlRef = useRef<HTMLInputElement>(null);
  const newLabelRef = useRef<HTMLInputElement>(null);
  // Set by a paste, so the label box (mounted by that render) gets focus.
  const focusLabel = useRef(false);
  // Notes show as text until clicked. `notesBefore` is their value when
  // editing started, restored by Escape.
  const [editingNotes, setEditingNotes] = useState(false);
  const notesBefore = useRef("");
  // Conductor workspace id typed into the add box, not yet on the card.
  const [newWorkspace, setNewWorkspace] = useState("");
  // Whether the add-workspace box is shown (hidden behind a button by default).
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const workspaces = draft.workspaces ?? [];
  // Repos in Conductor, for the repo picker. null until loaded.
  const [repos, setRepos] = useState<ConductorRepo[] | null>(null);
  const [reposError, setReposError] = useState<string>();
  // Set when "Start in Conductor" was clicked on a card with no repo, so the
  // header asks for one before opening Conductor.
  const [pickingRepo, setPickingRepo] = useState(false);

  // Show current PR/Linear status rather than whatever the last refresh left.
  useEffect(() => {
    onRefreshLinks(card.links.map((l) => l.url));
  }, []);

  useEffect(() => {
    loadConductorRepos()
      .then((r) => {
        setRepos(r.repos);
        setReposError(r.error);
      })
      .catch(() => {
        setRepos([]);
        setReposError("Couldn't load Conductor repos");
      });
  }, []);

  const titleValue = m("cardTitles", draft.title);
  const notesValue = m("cardNotes", draft.notes ?? "");
  useAutosize(titleRef, titleValue);
  useAutosize(notesRef, editingNotes ? notesValue : "");

  useEffect(() => {
    if (focusLabel.current && newUrl) {
      focusLabel.current = false;
      newLabelRef.current?.focus();
    }
  }, [newUrl]);

  // Latest close(), for the Escape listener and the parent's closeRef.
  const closeLatest = useRef(close);
  closeLatest.current = close;
  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = () => closeLatest.current();
    return () => {
      closeRef.current = null;
    };
  }, [closeRef]);

  // Close on Escape, saving any edits (same as clicking outside). Fields with
  // something of their own to cancel stop the event first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLatest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pasting a URL anywhere on the card outside a text field starts adding it
  // as a link, with the label box focused.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const text = e.clipboardData?.getData("text").trim() ?? "";
      if (!URL_RE.test(text)) return;
      e.preventDefault();
      startLink(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildAgentPrompt(finalCard()));
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function startLink(url: string) {
    focusLabel.current = true;
    setNewUrl(url);
  }

  function addLink() {
    const url = newUrl.trim();
    if (!url) return;
    setLinks((ls) => [...ls, { label: newLabel.trim(), url }]);
    if (linkKind(url) !== "generic") onRefreshLinks([url]);
    setNewUrl("");
    setNewLabel("");
    newUrlRef.current?.focus();
  }

  // Escape in the add-link boxes clears them, if there's anything to clear,
  // instead of closing the card.
  function addLinkKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addLink();
    } else if (e.key === "Escape" && (newUrl || newLabel)) {
      e.stopPropagation();
      setNewUrl("");
      setNewLabel("");
      newUrlRef.current?.focus();
    }
  }

  function updateLink(i: number, patch: Partial<Link>) {
    setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function removeLink(i: number) {
    setLinks((ls) => ls.filter((_, j) => j !== i));
  }

  function startNotes() {
    if (on("cardNotes")) return;
    notesBefore.current = draft.notes ?? "";
    setEditingNotes(true);
  }

  function notesKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setEditingNotes(false);
    } else if (e.key === "Escape") {
      // Discard just this notes edit, not the whole card.
      e.stopPropagation();
      set("notes", notesBefore.current || undefined);
      setEditingNotes(false);
    }
  }

  function addWorkspace() {
    const id = newWorkspace.trim().toLowerCase();
    if (!id) return;
    if (!workspaces.includes(id)) set("workspaces", [...workspaces, id]);
    setNewWorkspace("");
    setAddingWorkspace(false);
  }

  function removeWorkspace(id: string) {
    const rest = workspaces.filter((w) => w !== id);
    set("workspaces", rest.length ? rest : undefined);
  }

  // The card as it would be saved now.
  function finalCard(): Card {
    // Keep a typed-but-not-added link rather than dropping it.
    const final = [...links];
    if (newUrl.trim()) final.push({ label: newLabel.trim(), url: newUrl.trim() });
    const ws = newWorkspace.trim().toLowerCase();
    const finalWorkspaces = ws && !workspaces.includes(ws) ? [...workspaces, ws] : workspaces;
    return {
      ...draft,
      links: final.filter((l) => l.url.trim()),
      workspaces: finalWorkspaces.length ? finalWorkspaces : undefined,
    };
  }

  // Escape, a click outside, or Done: save if anything was edited, otherwise
  // just close, so an untouched new card isn't added to the board.
  function close() {
    const changes = changedFields(card, finalCard());
    if (Object.keys(changes).length) onSave(changes);
    else onCancel();
  }

  const dirty = Object.keys(changedFields(card, finalCard())).length > 0;

  // Open a new Conductor workspace for this card in the repo at `path`, seeded
  // with the agent prompt. Saves and closes the editor first so the agent's
  // link-workspace edit isn't overwritten by a later save of this stale draft.
  function startInConductor(path: string) {
    const next = { ...finalCard(), repo: path };
    onSave(changedFields(card, next));
    window.location.href = conductorLink(buildAgentPrompt(next), path);
  }

  function onStartClick() {
    if (draft.repo) startInConductor(draft.repo);
    else setPickingRepo(true);
  }

  // Link rows in the card's order: Linear, then PRs, then other links, each
  // keeping its index into `links`.
  const KIND_ORDER = { linear: 0, pr: 1, generic: 2 };
  const linkRows = links
    .map((l, i) => ({ l, i, kind: linkKind(l.url) }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  // Repo options: Conductor's repos, plus the card's repo if Conductor no
  // longer lists it, so the select still shows what's stored.
  const repoOptions = [...(repos ?? [])];
  if (draft.repo && repos && !repos.some((r) => r.path === draft.repo)) {
    repoOptions.push({ name: `${baseName(draft.repo)} (not in Conductor)`, path: draft.repo });
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal card-editor"
        style={draft.color ? ({ "--card-color": draft.color } as CSSProperties) : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <label className="detail-column" title="Move to another column">
            <span>{card.title ? "In" : "New card in"}</span>
            <select value={draft.column} onChange={(e) => set("column", e.target.value)}>
              {columns.map((c) => (
                <option key={c} value={c}>{m("columnNames", c)}</option>
              ))}
            </select>
          </label>
          <div className="modal-head-actions">
            {/* A card already being worked on links to its workspace(s) instead
                of offering to start a new one. */}
            {workspaces.length > 0 ? (
              workspaces.map((id) => (
                <WorkspaceBadge key={id} id={id} status={agents.workspaces[id]} />
              ))
            ) : (
              <>
                <button type="button" className="btn" onClick={copyPrompt}>
                  {promptCopied ? "Copied!" : "Copy prompt for agents"}
                </button>
                {pickingRepo ? (
                  <select
                    autoFocus
                    className="repo-pick"
                    value=""
                    disabled={!repos?.length}
                    onChange={(e) => e.target.value && startInConductor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        // Cancel just the picker, not the whole card.
                        e.stopPropagation();
                        setPickingRepo(false);
                      }
                    }}
                    onBlur={() => setPickingRepo(false)}
                  >
                    <option value="">
                      {repos === null ? "Loading repos…" : repos.length ? "Pick a repo…" : "No repos"}
                    </option>
                    {repoOptions.map((r) => (
                      <option key={r.path} value={r.path}>{m("repoNames", r.name)}</option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    title={
                      draft.repo
                        ? `New Conductor workspace in ${draft.repo}`
                        : "Pick a repo, then open a new Conductor workspace"
                    }
                    onClick={onStartClick}
                  >
                    Start in Conductor
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <textarea
          ref={titleRef}
          className="detail-title"
          rows={1}
          // Only a new card starts with the cursor in the title; an existing
          // one opens as a view.
          autoFocus={!card.title}
          aria-label="Title"
          value={titleValue}
          readOnly={on("cardTitles")}
          title={on("cardTitles") ? MASKED_HINT : undefined}
          onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder="What are you working on?"
        />

        {needsYou && (
          <NeedsYouBanner value={needsYou} loud={needsYouLoud} onClear={onClearNeedsYou} />
        )}

        <div className="detail-meta">
          <div className="detail-section">
            <h3>Complexity</h3>
            <ComplexityPicker
              value={draft.complexity}
              color={draft.color}
              onChange={(c) => set("complexity", c)}
            />
          </div>
          <div className="detail-section">
            <h3>Color</h3>
            <div className="color-swatches">
              {COLORS.map((c) => {
                // Labeled colors render as a pill with the label inside.
                const label = c.value && m("colorLabels", colorTags[c.value]);
                return (
                  <button
                    key={c.name}
                    type="button"
                    title={label || c.name}
                    className={`swatch${draft.color === c.value ? " selected" : ""}${
                      c.value ? "" : " none"
                    }${label ? " labeled" : ""}`}
                    style={c.value ? { background: c.value, color: textOn(c.value) } : undefined}
                    onClick={() => set("color", c.value)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <section className="detail-section">
          <h3>Notes</h3>
          {editingNotes ? (
            <>
              <textarea
                ref={notesRef}
                autoFocus
                rows={3}
                value={notesValue}
                onChange={(e) => set("notes", e.target.value || undefined)}
                onKeyDown={notesKeyDown}
                onBlur={() => setEditingNotes(false)}
                placeholder="Add more detail…"
              />
              <div className="detail-edit-actions">
                <button type="button" className="btn primary" onClick={() => setEditingNotes(false)}>
                  Done
                </button>
                <span className="hint">⌘↵ to finish, Esc to undo</span>
              </div>
            </>
          ) : (
            <div
              className={`detail-notes${notesValue ? "" : " empty"}`}
              role="button"
              tabIndex={0}
              title={on("cardNotes") ? MASKED_HINT : "Click to edit"}
              onClick={startNotes}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  startNotes();
                }
              }}
            >
              {notesValue ? <Linkified text={notesValue} /> : "Add notes…"}
            </div>
          )}
        </section>

        <section className="detail-section">
          <h3>Links</h3>
          {linkRows.map(({ l, i, kind }) =>
            kind === "generic" ? (
              <div key={i} className="link-row">
                <LinkChip url={l.url} label={chipFallback(l.url)} />
                <input
                  className="inline-input"
                  aria-label="Link label"
                  placeholder="Add a label"
                  value={m("linkLabels", l.label)}
                  readOnly={on("linkLabels")}
                  title={on("linkLabels") ? MASKED_HINT : undefined}
                  onChange={(e) => updateLink(i, { label: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <input
                  className="inline-input link-url-input"
                  aria-label="Link URL"
                  placeholder="https://…"
                  value={m("urls", l.url)}
                  readOnly={on("urls")}
                  title={on("urls") ? MASKED_HINT : l.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <RemoveLink onClick={() => removeLink(i)} />
              </div>
            ) : (
              // PRs and Linear items show their live status, like on the card.
              <div key={i} className="link-row status-row">
                {kind === "pr" ? (
                  <PrLine url={l.url} status={cache.prs[l.url]} repoNames={repoNames} detailed />
                ) : (
                  <IssueLine url={l.url} status={cache.issues[l.url]} detailed />
                )}
                <RemoveLink onClick={() => removeLink(i)} />
              </div>
            ),
          )}
          <div className="link-add">
            <input
              ref={newUrlRef}
              aria-label="New link URL"
              placeholder="Paste a link (Slack, Notion, Figma, a PR…)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").trim();
                if (newUrl.trim() || !URL_RE.test(text)) return;
                e.preventDefault();
                startLink(text);
              }}
              onKeyDown={addLinkKeyDown}
            />
            {newUrl.trim() && (
              <input
                ref={newLabelRef}
                className="link-add-label"
                aria-label="New link label"
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={addLinkKeyDown}
              />
            )}
            <button type="button" className="btn" onClick={addLink} disabled={!newUrl.trim()}>
              Add
            </button>
          </div>
        </section>

        <section className="detail-section">
          <h3>Conductor</h3>
          <label className="detail-repo">
            <span>Repo for new workspaces</span>
            <select
              value={draft.repo ?? ""}
              onChange={(e) => set("repo", e.target.value || undefined)}
            >
              <option value="">{repos === null ? "Loading…" : "None"}</option>
              {repoOptions.map((r) => (
                <option key={r.path} value={r.path}>{m("repoNames", r.name)}</option>
              ))}
            </select>
          </label>
          {reposError && <div className="hint error">{reposError}</div>}
          {agents.error && workspaces.length > 0 && (
            <div className="hint error">{agents.error}</div>
          )}
          {workspaces.map((id) => {
            const w = agents.workspaces[id];
            return (
              <div key={id} className="link-row workspace-row">
                <WorkspaceBadge id={id} status={w} />
                <span className="link-url" title={id}>
                  {w
                    ? [w.repo && m("repoNames", w.repo), w.branch && m("branches", w.branch)]
                        .filter(Boolean)
                        .join(" · ")
                    : id}
                </span>
                <button
                  type="button"
                  className="btn ghost icon-btn"
                  title="Unlink workspace"
                  aria-label="Unlink workspace"
                  onClick={() => removeWorkspace(id)}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {addingWorkspace ? (
            <div className="link-add">
              <input
                autoFocus
                placeholder="Workspace ID ($CONDUCTOR_WORKSPACE_ID)"
                value={newWorkspace}
                onChange={(e) => setNewWorkspace(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addWorkspace();
                  } else if (e.key === "Escape") {
                    // Cancel just the add box, not the whole card.
                    e.stopPropagation();
                    setNewWorkspace("");
                    setAddingWorkspace(false);
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={addWorkspace}
                disabled={!newWorkspace.trim()}
              >
                Add
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setNewWorkspace("");
                  setAddingWorkspace(false);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="btn" onClick={() => setAddingWorkspace(true)}>
                + Link workspace
              </button>
            </div>
          )}
        </section>

        <div className="modal-actions">
          <button className="btn danger" onClick={onDelete}>Delete</button>
          <div className="spacer" />
          {dirty && (
            <button className="btn" onClick={onCancel}>Discard changes</button>
          )}
          <button className="btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
