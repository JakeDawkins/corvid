import { useEffect, useState } from "react";
import type { Card, Link } from "./types";
import { linkKind } from "./links";
import { COLORS } from "./colors";
import { COMPLEXITY_LEVELS } from "./Complexity";

// Human label for a link's auto-detected kind, shown beside each link row.
const KIND_LABEL: Record<ReturnType<typeof linkKind>, string> = {
  pr: "PR",
  linear: "Linear",
  generic: "Link",
};

export function CardEditor({
  card,
  columns,
  colorTags,
  onSetColorTag,
  onSave,
  onCancel,
  onDelete,
}: {
  card: Card;
  columns: string[];
  colorTags: Record<string, string>;
  onSetColorTag: (color: string, name: string) => void;
  onSave: (c: Card) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Card>({ ...card });
  const [promptCopied, setPromptCopied] = useState(false);

  function set<K extends keyof Card>(key: K, value: Card[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // Always keep a trailing empty row so a new link field is ready without a button.
  const [links, setLinks] = useState<Link[]>([...card.links, { label: "", url: "" }]);

  // Build a paste-ready instruction for an AI agent to work on this card: the
  // task, its links (so the agent has full context), and a standing instruction
  // to add any PR it opens back to this card (by id) on the Corvid board.
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

  function updateLink(i: number, patch: Partial<Link>) {
    setLinks((ls) => {
      const next = ls.map((x, j) => (j === i ? { ...x, ...patch } : x));
      const last = next[next.length - 1];
      if (last.label.trim() || last.url.trim()) next.push({ label: "", url: "" });
      return next;
    });
  }

  function save() {
    onSave({
      ...draft,
      links: links.filter((l) => l.url.trim()),
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
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="What are you working on?"
          />
        </label>

        <label className="field">
          <span>Column</span>
          <select value={draft.column} onChange={(e) => set("column", e.target.value)}>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
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
            value={draft.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Optional"
          />
        </label>

        <div className="field">
          <span>Color</span>
          <div className="color-swatches">
            {COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                title={(c.value && colorTags[c.value]) || c.name}
                className={`swatch${draft.color === c.value ? " selected" : ""}${
                  c.value ? "" : " none"
                }`}
                style={c.value ? { background: c.value } : undefined}
                onClick={() => set("color", c.value)}
              />
            ))}
          </div>
          {draft.color && (
            <input
              className="color-tag-input"
              placeholder="Tag name for this color (e.g. sales)"
              value={colorTags[draft.color] ?? ""}
              onChange={(e) => onSetColorTag(draft.color!, e.target.value)}
            />
          )}
        </div>

        <div className="field">
          <span>Links (GitHub PRs, Linear, Slack, Notion, Figma…)</span>
          {links.map((l, i) => (
            <div key={i} className="link-editor">
              <input
                placeholder="Label (optional)"
                value={l.label}
                onChange={(e) => updateLink(i, { label: e.target.value })}
              />
              <input
                placeholder="https://…"
                value={l.url}
                onChange={(e) => updateLink(i, { url: e.target.value })}
              />
              {l.url.trim() && (
                <span className="link-kind">{KIND_LABEL[linkKind(l.url)]}</span>
              )}
              {i < links.length - 1 && (
                <button className="btn" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
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
