import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentsStatus, Card, ConductorRepo, Link, NeedsYou } from "./types";
import { loadConductorRepos } from "./api";
import { domainName, linkKind } from "./links";
import { LinkChip, WorkspaceBadge } from "./Badges";
import { COLORS, textOn } from "./colors";
import { COMPLEXITY_LEVELS } from "./Complexity";
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
    "Work on this autonomously with the watch-and-fix skill: build it, draft the QA handoff for me, then watch Slack, the GitHub PRs, and Linear for QA and review feedback and fix what's relevant until the project is done. Never send a Slack message, Linear comment, or GitHub comment to a real person unless I ask you to. Draft it and flag this card instead.",
  );
  return lines.join("\n");
}

// Deep link that opens Conductor's new-workspace flow in the repo at `path`,
// with `prompt` as the first message. See conductor.build/docs/reference/deep-links.
function conductorLink(prompt: string, path: string): string {
  return `conductor://prompt=${encodeURIComponent(prompt)}&path=${encodeURIComponent(path)}`;
}

export function CardEditor({
  card,
  columns,
  colorTags,
  agents,
  needsYou,
  needsYouLoud,
  onClearNeedsYou,
  onSave,
  onCancel,
  onDelete,
}: {
  card: Card;
  columns: string[];
  colorTags: Record<string, string>;
  agents: AgentsStatus;
  // The card's live "Needs you" message, which agents set and clear outside
  // the editor, so it's read from the board rather than this draft.
  needsYou?: NeedsYou;
  needsYouLoud: boolean;
  onClearNeedsYou: () => void;
  onSave: (c: Card) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { m, on } = useMask();
  const [draft, setDraft] = useState<Card>({ ...card });
  const [promptCopied, setPromptCopied] = useState(false);

  function set<K extends keyof Card>(key: K, value: Card[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const [links, setLinks] = useState<Link[]>(card.links);
  // URL typed into the add-link box, not yet added to `links`.
  const [newUrl, setNewUrl] = useState("");
  // The link row currently open for editing, with its unsaved values.
  const [editing, setEditing] = useState<{ index: number; link: Link } | null>(null);
  // Conductor workspace id typed into the add box, not yet on the card.
  const [newWorkspace, setNewWorkspace] = useState("");
  // Whether the add-workspace box is shown (hidden behind a button by default).
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const workspaces = draft.workspaces ?? [];
  // Repos in Conductor, for the repo picker. null until loaded.
  const [repos, setRepos] = useState<ConductorRepo[] | null>(null);
  const [reposError, setReposError] = useState<string>();
  // Set when "Start in Conductor" was clicked on a card with no repo, so the
  // header asks for one before opening Conductor.
  const [pickingRepo, setPickingRepo] = useState(false);

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

  // Grow the notes box to fit its text; CSS max-height caps it, then it scrolls.
  const notesValue = m("cardNotes", draft.notes ?? "");
  useLayoutEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [notesValue]);

  // Close on Escape, discarding any unsaved edits (same as clicking outside).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildAgentPrompt(finalCard()));
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function addLink() {
    const url = newUrl.trim();
    if (!url) return;
    setLinks((ls) => [...ls, { label: "", url }]);
    setNewUrl("");
  }

  function removeLink(i: number) {
    setLinks((ls) => ls.filter((_, j) => j !== i));
    setEditing(null);
  }

  // Apply the open edit. Clearing the URL removes the link.
  function commitEdit() {
    if (!editing) return;
    const { index, link } = editing;
    if (!link.url.trim()) return removeLink(index);
    setLinks((ls) => ls.map((l, j) => (j === index ? link : l)));
    setEditing(null);
  }

  function editKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      // Cancel just the link edit, not the whole card.
      e.stopPropagation();
      setEditing(null);
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
    // Keep an open edit or a typed-but-not-added URL rather than dropping it.
    const final = links.map((l, i) => (editing?.index === i ? editing.link : l));
    if (newUrl.trim()) final.push({ label: "", url: newUrl.trim() });
    const ws = newWorkspace.trim().toLowerCase();
    const finalWorkspaces = ws && !workspaces.includes(ws) ? [...workspaces, ws] : workspaces;
    return {
      ...draft,
      links: final.filter((l) => l.url.trim()),
      workspaces: finalWorkspaces.length ? finalWorkspaces : undefined,
    };
  }

  function save() {
    onSave(finalCard());
  }

  // Open a new Conductor workspace for this card in the repo at `path`, seeded
  // with the agent prompt. Saves and closes the editor first so the agent's
  // link-workspace edit isn't overwritten by a later save of this stale draft.
  function startInConductor(path: string) {
    const card = { ...finalCard(), repo: path };
    onSave(card);
    window.location.href = conductorLink(buildAgentPrompt(card), path);
  }

  function onStartClick() {
    if (draft.repo) startInConductor(draft.repo);
    else setPickingRepo(true);
  }

  // Repo options: Conductor's repos, plus the card's repo if Conductor no
  // longer lists it, so the select still shows what's stored.
  const repoOptions = [...(repos ?? [])];
  if (draft.repo && repos && !repos.some((r) => r.path === draft.repo)) {
    repoOptions.push({ name: `${baseName(draft.repo)} (not in Conductor)`, path: draft.repo });
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal card-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{card.title ? "Edit card" : "New card"}</h2>
          <div className="modal-head-actions">
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
          </div>
        </div>

        {needsYou && (
          <NeedsYouBanner value={needsYou} loud={needsYouLoud} onClear={onClearNeedsYou} />
        )}

        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            value={m("cardTitles", draft.title)}
            readOnly={on("cardTitles")}
            title={on("cardTitles") ? MASKED_HINT : undefined}
            onChange={(e) => set("title", e.target.value)}
            placeholder="What are you working on?"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Column</span>
            <select value={draft.column} onChange={(e) => set("column", e.target.value)}>
              {columns.map((c) => (
                <option key={c} value={c}>{m("columnNames", c)}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Repo (for new Conductor workspaces)</span>
            <select
              value={draft.repo ?? ""}
              onChange={(e) => set("repo", e.target.value || undefined)}
            >
              <option value="">{repos === null ? "Loading…" : "None"}</option>
              {repoOptions.map((r) => (
                <option key={r.path} value={r.path}>{m("repoNames", r.name)}</option>
              ))}
            </select>
            {reposError && <div className="hint error">{reposError}</div>}
          </label>
        </div>

        <div className="field">
          <span>Complexity</span>
          <div className="complexity-picker">
            {COMPLEXITY_LEVELS.map((c) => (
              <button
                key={c}
                type="button"
                className={`complexity-option${
                  draft.complexity === c ? " selected" : ""
                }`}
                // Clicking the active size again clears it (unset = hidden on card).
                onClick={() =>
                  set("complexity", draft.complexity === c ? undefined : c)
                }
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Notes</span>
          <textarea
            ref={notesRef}
            rows={2}
            value={notesValue}
            readOnly={on("cardNotes")}
            title={on("cardNotes") ? MASKED_HINT : undefined}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Optional"
          />
        </label>

        <div className="field">
          <span>Color</span>
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

        <div className="field">
          <span>Links (GitHub PRs, Linear, Slack, Notion, Figma…)</span>
          {links.map((l, i) =>
            editing?.index === i ? (
              <div key={i} className="link-editor">
                <input
                  autoFocus
                  placeholder="Title (optional)"
                  value={m("linkLabels", editing.link.label)}
                  readOnly={on("linkLabels")}
                  title={on("linkLabels") ? MASKED_HINT : undefined}
                  onChange={(e) =>
                    setEditing({ index: i, link: { ...editing.link, label: e.target.value } })
                  }
                  onKeyDown={editKeyDown}
                />
                <input
                  placeholder="https://…"
                  value={m("urls", editing.link.url)}
                  readOnly={on("urls")}
                  title={on("urls") ? MASKED_HINT : undefined}
                  onChange={(e) =>
                    setEditing({ index: i, link: { ...editing.link, url: e.target.value } })
                  }
                  onKeyDown={editKeyDown}
                />
                <button type="button" className="btn primary" onClick={commitEdit}>
                  Done
                </button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div key={i} className="link-row">
                <LinkChip
                  url={l.url}
                  label={l.label.trim() ? m("linkLabels", l.label.trim()) : chipFallback(l.url)}
                />
                <span className="link-url" title={m("urls", l.url)}>
                  {m("urls", l.url)}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditing({ index: i, link: { ...l } })}
                >
                  Edit
                </button>
                <button type="button" className="btn" title="Delete link" onClick={() => removeLink(i)}>
                  ✕
                </button>
              </div>
            ),
          )}
          <div className="link-editor">
            <input
              placeholder="https://…"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
            <button type="button" className="btn" onClick={addLink} disabled={!newUrl.trim()}>
              Add
            </button>
          </div>
        </div>

        <div className="field">
          <span>Conductor workspaces</span>
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
                  className="btn"
                  title="Unlink workspace"
                  onClick={() => removeWorkspace(id)}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {addingWorkspace ? (
            <div className="link-editor">
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
                + Add workspace
              </button>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn danger" onClick={onDelete}>Delete</button>
          <div className="spacer" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
