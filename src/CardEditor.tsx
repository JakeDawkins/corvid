import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import type { AgentsStatus, Cache, Card, Link, NeedsYou } from "./types";
import { linkKind, parseThreadId } from "./links";
import { GenericLine, IssueLine, PrLine, ThreadBadge, WorkspaceBadge } from "./Badges";
import { ClaudeLogo } from "./ClaudeLogo";
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
// to link its Conductor workspace or T3 Code thread and any PR it opens back
// to this card (by id) on the Corvid board, and to flag the card when it's
// waiting on the user.
// `instructions`: the user's own guidance typed in the Copy prompt dialog. It
// goes near the top, marked as overriding everything else in the prompt.
function buildAgentPrompt(card: Card, instructions = ""): string {
  const lines: string[] = [];
  lines.push("Work on the following task from my Corvid board.");
  lines.push("");
  lines.push(`Task: ${card.title.trim() || "(untitled)"}`);
  lines.push(`Card ID: ${card.id}`);
  if (card.complexity) lines.push(`Estimated complexity: ${card.complexity}`);
  if (instructions.trim()) {
    lines.push("");
    lines.push(
      "IMPORTANT: My instructions for this task. They take priority over the ticket, the card notes, the project context, and any linked resource. Where they disagree, follow these, and update the project context to match.",
    );
    lines.push(instructions.trim());
  }
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
    `Before you start, link your session to this card so the board shows when you're working on it. With the corvid skill: in Conductor, run \`link-workspace ${card.id}\` (it reads $CONDUCTOR_WORKSPACE_ID); in T3 Code, run \`link-thread ${card.id}\` (it finds the thread working in the current directory, or pass your thread id). Both do nothing if the card already has that link.`,
  );
  lines.push("");
  lines.push(
    `This card has a project context: shared memory between the agent threads that work on it (why we do it, decisions, implementation, QA plan, monitoring, learn more, references). Before you start, read it with the corvid skill: \`context ${card.id}\`. If it has none yet, create it with \`context-init ${card.id} --type regular|bug|research\` and fill in what you learn from the ticket and links, marking what you don't know as unknown. Keep it current as you work, following the skill's "Project context" section, so the next thread starts where you stopped.`,
  );
  lines.push("");
  lines.push(
    "Before you write code, read the code around what this change touches (callers, related flows, shared helpers) and list the edge cases it has to handle. If the ticket, notes, or project context leave a gap or are ambiguous about any of them, don't guess: ask me, flagging this card as described below, and record each open question and its answer in the project context.",
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

// The Copy prompt dialog: a box for extra instructions that go into the prompt
// marked as a priority, e.g. where the user disagrees with the ticket or wants
// to steer the work before it starts. Empty is fine. ⌘↵ copies, Esc closes.
function PromptDialog({
  value,
  onChange,
  onCopy,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="prompt-dialog" role="dialog" aria-label="Copy prompt">
      <label htmlFor="prompt-instructions">Additional instructions</label>
      <textarea
        id="prompt-instructions"
        autoFocus
        rows={5}
        value={value}
        placeholder="Anything you disagree with in the ticket or resources, or guidance before work starts. Marked as a priority for the agent."
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCopy();
          } else if (e.key === "Escape") {
            // Close just the dialog, not the whole card.
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div className="prompt-dialog-actions">
        <span className="hint">⌘↵ to copy</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={onCopy}>
          Copy prompt
        </button>
      </div>
    </div>
  );
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

function EditLink({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  const label = editing ? "Done editing link" : "Edit link";
  return (
    <button
      type="button"
      className="btn ghost icon-btn"
      title={label}
      aria-label={label}
      // Keep focus in the row's inputs, so clicking ✓ doesn't first end the
      // edit on blur and re-render the row under the pointer.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {editing ? "✓" : "✎"}
    </button>
  );
}

// Icons for the header's icon buttons, in the board's 2px-stroke style.
function IdCardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6.17 15a3 3 0 0 1 5.66 0" />
      <path d="M16 10h2" />
      <path d="M16 14h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
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

function UnlinkAgent({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn ghost icon-btn detail-agent-unlink"
      title={label}
      aria-label={label}
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
  nextColumnFor,
  colorTags,
  cache,
  repoNames,
  onRefreshLinks,
  agents,
  needsYou,
  needsYouLoud,
  onClearNeedsYou,
  hasContext,
  onOpenContext,
  onSave,
  onCancel,
  onDelete,
  closeRef,
}: {
  card: Card;
  columns: string[];
  // The column the advance button moves a card in `column` to, if any.
  nextColumnFor: (column: string) => string | undefined;
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
  // Whether the card has a project context, and opens its context page (after
  // this editor saves and closes). Absent for a card not yet on the board.
  hasContext: boolean;
  onOpenContext?: () => void;
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
  const [idCopied, setIdCopied] = useState(false);
  // The Copy prompt dialog, and the extra instructions typed into it.
  const [promptOpen, setPromptOpen] = useState(false);
  const [instructions, setInstructions] = useState("");

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
  // Index of the link whose edit button was clicked. Links show as text, and
  // only the one being edited shows its label and URL inputs.
  const [editingLink, setEditingLink] = useState<number | null>(null);
  const editUrlRef = useRef<HTMLInputElement>(null);
  // Notes show as text until clicked. `notesBefore` is their value when
  // editing started, restored by Escape.
  const [editingNotes, setEditingNotes] = useState(false);
  const notesBefore = useRef("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const workspaces = draft.workspaces ?? [];
  const threads = draft.threads ?? [];
  const next = nextColumnFor(draft.column);

  // Show current PR/Linear status rather than whatever the last refresh left.
  useEffect(() => {
    onRefreshLinks(card.links.map((l) => l.url));
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
  // as a link, with the label box focused. A T3 Code thread id or link is
  // linked as a thread right away.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const text = e.clipboardData?.getData("text").trim() ?? "";
      const thread = parseThreadId(text);
      if (thread) {
        e.preventDefault();
        addThread(thread);
      } else if (URL_RE.test(text)) {
        e.preventDefault();
        startLink(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildAgentPrompt(finalCard(), instructions));
      setPromptOpen(false);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(card.id);
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  function startLink(url: string) {
    focusLabel.current = true;
    setNewUrl(url);
  }

  // A T3 Code thread id or link typed into the link box is linked as a thread.
  function addLink() {
    const url = newUrl.trim();
    if (!url) return;
    const thread = parseThreadId(url);
    if (thread) {
      addThread(thread);
      setNewUrl("");
      setNewLabel("");
      return;
    }
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
    setEditingLink(null);
  }

  function toggleEditLink(i: number) {
    if (editingLink === i) finishEditLink();
    else setEditingLink(i);
  }

  // Leaves edit mode, fetching status if the URL is now a PR or Linear item.
  function finishEditLink() {
    const url = editingLink === null ? undefined : links[editingLink]?.url.trim();
    if (url && linkKind(url) !== "generic") onRefreshLinks([url]);
    setEditingLink(null);
  }

  // Enter or Escape in a link being edited finishes editing (Escape without
  // closing the card).
  function editLinkKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape" && editingLink !== null) {
      e.stopPropagation();
      finishEditLink();
    }
  }

  useEffect(() => {
    if (editingLink !== null) editUrlRef.current?.focus();
  }, [editingLink]);

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

  function removeWorkspace(id: string) {
    const rest = workspaces.filter((w) => w !== id);
    set("workspaces", rest.length ? rest : undefined);
  }

  // Functional updates, since the window paste listener holds the first
  // render's closure.
  function addThread(id: string) {
    setDraft((d) => {
      const ts = d.threads ?? [];
      return ts.includes(id) ? d : { ...d, threads: [...ts, id] };
    });
  }

  function removeThread(id: string) {
    const rest = threads.filter((t) => t !== id);
    set("threads", rest.length ? rest : undefined);
  }

  // The card as it would be saved now.
  function finalCard(): Card {
    // Keep a typed-but-not-added link rather than dropping it.
    const final = [...links];
    if (newUrl.trim() && !parseThreadId(newUrl)) final.push({ label: newLabel.trim(), url: newUrl.trim() });
    const typedThread = parseThreadId(newUrl);
    const finalThreads = typedThread && !threads.includes(typedThread) ? [...threads, typedThread] : threads;
    return {
      ...draft,
      links: final.filter((l) => l.url.trim()),
      threads: finalThreads.length ? finalThreads : undefined,
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

  function openContext() {
    close();
    onOpenContext?.();
  }

  // Link rows in the card's order: Linear, then PRs, then other links, each
  // keeping its index into `links`.
  const KIND_ORDER = { linear: 0, pr: 1, generic: 2 };
  const linkRows = links
    .map((l, i) => ({ l, i, kind: linkKind(l.url) }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal card-editor"
        style={draft.color ? ({ "--card-color": draft.color } as CSSProperties) : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="detail-column-row">
            <label className="detail-column" title="Move to another column">
              <span>{card.title ? "In" : "New card in"}</span>
              <select value={draft.column} onChange={(e) => set("column", e.target.value)}>
                {columns.map((c) => (
                  <option key={c} value={c}>{m("columnNames", c)}</option>
                ))}
              </select>
            </label>
            {next && (
              <button
                type="button"
                className="btn advance-btn"
                title={`Move to ${m("columnNames", next)} (set in Settings > Next column)`}
                onClick={() => set("column", next)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
                {m("columnNames", next)}
              </button>
            )}
          </div>
          <div className="modal-head-actions">
            <button
              type="button"
              className="btn ghost head-icon-btn"
              title={idCopied ? "Copied card ID" : "Copy card ID"}
              aria-label="Copy card ID"
              onClick={copyId}
            >
              {idCopied ? <CheckIcon /> : <IdCardIcon />}
            </button>
            <div className="prompt-anchor">
              <button
                type="button"
                className={`btn ghost head-icon-btn prompt-btn${promptOpen ? " active" : ""}`}
                title={promptCopied ? "Copied prompt" : "Copy prompt for an agent"}
                aria-label="Copy prompt"
                onClick={() => setPromptOpen((o) => !o)}
              >
                {promptCopied ? <CheckIcon /> : <ClaudeLogo className="claude-logo prompt-logo" />}
              </button>
              {promptOpen && (
                <PromptDialog
                  value={instructions}
                  onChange={setInstructions}
                  onCopy={copyPrompt}
                  onClose={() => setPromptOpen(false)}
                />
              )}
            </div>
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

        {/* Where the card already has a conversation: linked Conductor
            workspaces and T3 Code threads, each with an unlink button. */}
        {(workspaces.length > 0 || threads.length > 0) && (
          <div className="detail-agents">
            {workspaces.map((id) => (
              <span key={id} className="detail-agent">
                <WorkspaceBadge id={id} status={agents.workspaces[id]} />
                <UnlinkAgent label="Unlink workspace" onClick={() => removeWorkspace(id)} />
              </span>
            ))}
            {threads.map((id) => (
              <span key={id} className="detail-agent">
                <ThreadBadge id={id} status={agents.threads?.[id]} />
                <UnlinkAgent label="Unlink thread" onClick={() => removeThread(id)} />
              </span>
            ))}
          </div>
        )}

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
            i === editingLink ? (
              <div
                key={i}
                className="link-row link-edit-row"
                onBlur={(e) => {
                  // Leaving the row (not moving between its inputs) ends editing.
                  if (!e.currentTarget.contains(e.relatedTarget)) finishEditLink();
                }}
              >
                <input
                  className="link-edit-label"
                  aria-label="Link label"
                  placeholder="Label (optional)"
                  value={m("linkLabels", l.label)}
                  readOnly={on("linkLabels")}
                  title={on("linkLabels") ? MASKED_HINT : undefined}
                  onChange={(e) => updateLink(i, { label: e.target.value })}
                  onKeyDown={editLinkKeyDown}
                />
                <input
                  ref={editUrlRef}
                  className="link-edit-url"
                  aria-label="Link URL"
                  placeholder="https://…"
                  value={m("urls", l.url)}
                  readOnly={on("urls")}
                  title={on("urls") ? MASKED_HINT : undefined}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  onKeyDown={editLinkKeyDown}
                />
                <EditLink editing onClick={() => toggleEditLink(i)} />
                <RemoveLink onClick={() => removeLink(i)} />
              </div>
            ) : kind === "generic" ? (
              <div key={i} className="link-row status-row">
                <GenericLine url={l.url} label={l.label} />
                <EditLink editing={false} onClick={() => toggleEditLink(i)} />
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
                <EditLink editing={false} onClick={() => toggleEditLink(i)} />
                <RemoveLink onClick={() => removeLink(i)} />
              </div>
            ),
          )}
          <div className="link-add">
            <input
              ref={newUrlRef}
              aria-label="New link URL"
              placeholder="Paste a link (Slack, Notion, Figma, a PR…) or a T3 thread ID"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").trim();
                if (newUrl.trim()) return;
                const thread = parseThreadId(text);
                if (thread) {
                  e.preventDefault();
                  addThread(thread);
                } else if (URL_RE.test(text)) {
                  e.preventDefault();
                  startLink(text);
                }
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

        {onOpenContext && (
          <section className="detail-section">
            <h3>Project context</h3>
            <div className="context-row">
              <span className="hint">
                {hasContext
                  ? "The project memory agents read and keep current: decisions, implementation, QA plan, and more."
                  : "No context yet. Agents create it when they start, or you can set it up now."}
              </span>
              <button type="button" className="btn" onClick={openContext}>
                {hasContext ? "Open context" : "Set up context"}
              </button>
            </div>
          </section>
        )}

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
