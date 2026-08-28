import { useState } from "react";
import type { Card, Link } from "./types";
import { linkKind } from "./links";
import { COLORS } from "./colors";

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

  function set<K extends keyof Card>(key: K, value: Card[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // Always keep a trailing empty row so a new link field is ready without a button.
  const [links, setLinks] = useState<Link[]>([...card.links, { label: "", url: "" }]);

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
        <h2>{card.title ? "Edit card" : "New card"}</h2>

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
