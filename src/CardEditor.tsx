import { useEffect, useState } from "react";
import type { AgentsStatus, Card, Link } from "./types";
import { domainName, linkKind } from "./links";
import { LinkChip, WorkspaceBadge } from "./Badges";
import { COLORS, textOn } from "./colors";
import { COMPLEXITY_LEVELS } from "./Complexity";
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

export function CardEditor({
  card,
  columns,
  colorTags,
  agents,
  onSave,
  onCancel,
  onDelete,
}: {
  card: Card;
  columns: string[];
  colorTags: Record<string, string>;
  agents: AgentsStatus;
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
  const workspaces = draft.workspaces ?? [];

  // Build a paste-ready instruction for an AI agent to work on this card: the
  // task, its links (so the agent has full context), and standing instructions
  // to link its Conductor workspace and any PR it opens back to this card (by
  // id) on the Corvid board.
  function buildAgentPrompt(): string {
    const lines: string[] = [];
    lines.push("Work on the following task from my Corvid board.");
    lines.push("");
    lines.push(`Task: ${draft.title.trim() || "(untitled)"}`);
    lines.push(`Card ID: ${draft.id}`);
    if (draft.complexity) lines.push(`Estimated complexity: ${draft.complexity}`);
    if (draft.notes?.trim()) {
      lines.push("");
      lines.push("Notes:");
      lines.push(draft.notes.trim());
    }
    const real = links.filter((l) => l.url.trim());
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
      `Before you start, if you are running in Conductor, link your workspace to this card so the board shows when you're working on it: with the corvid skill, run \`link-workspace ${draft.id}\`. It reads $CONDUCTOR_WORKSPACE_ID and does nothing if the card already has that workspace.`,
    );
    lines.push("");
    lines.push(
      `Whenever you open a pull request for this work, add its URL to this card (Card ID: ${draft.id}) on the Corvid board so it stays in sync.`,
    );
    return lines.join("\n");
  }

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
      await navigator.clipboard.writeText(buildAgentPrompt());
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
  }

  function removeWorkspace(id: string) {
    const rest = workspaces.filter((w) => w !== id);
    set("workspaces", rest.length ? rest : undefined);
  }

  function save() {
    // Keep an open edit or a typed-but-not-added URL rather than dropping it.
    const final = links.map((l, i) => (editing?.index === i ? editing.link : l));
    if (newUrl.trim()) final.push({ label: "", url: newUrl.trim() });
    const ws = newWorkspace.trim().toLowerCase();
    const finalWorkspaces = ws && !workspaces.includes(ws) ? [...workspaces, ws] : workspaces;
    onSave({
      ...draft,
      links: final.filter((l) => l.url.trim()),
      workspaces: finalWorkspaces.length ? finalWorkspaces : undefined,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{card.title ? "Edit card" : "New card"}</h2>
          <button type="button" className="btn" onClick={copyPrompt}>
            {promptCopied ? "Copied!" : "Copy prompt for agents"}
          </button>
        </div>

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

        <label className="field">
          <span>Column</span>
          <select value={draft.column} onChange={(e) => set("column", e.target.value)}>
            {columns.map((c) => (
              <option key={c} value={c}>{m("columnNames", c)}</option>
            ))}
          </select>
        </label>

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
            rows={2}
            value={m("cardNotes", draft.notes ?? "")}
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
          <div className="link-editor">
            <input
              placeholder="Workspace ID ($CONDUCTOR_WORKSPACE_ID)"
              value={newWorkspace}
              onChange={(e) => setNewWorkspace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addWorkspace();
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
          </div>
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
