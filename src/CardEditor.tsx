import { useState } from "react";
import type { Card, Link } from "./types";
import { linkKind } from "./links";

// Human label for a link's auto-detected kind, shown beside each link row.
const KIND_LABEL: Record<ReturnType<typeof linkKind>, string> = {
  pr: "PR",
  linear: "Linear",
  generic: "Link",
};

// Preset card accent colors. `undefined` = no color.
const COLORS = [
  { name: "None", value: undefined },
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f76b15" },
  { name: "Yellow", value: "#ffb224" },
  { name: "Green", value: "#30a46c" },
  { name: "Blue", value: "#3b9eff" },
  { name: "Purple", value: "#8e4ec6" },
  { name: "Pink", value: "#e93d82" },
];

export function CardEditor({
  card,
  columns,
  onSave,
  onCancel,
  onDelete,
}: {
  card: Card;
  columns: string[];
  onSave: (c: Card) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Card>({ ...card });

  function set<K extends keyof Card>(key: K, value: Card[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const [links, setLinks] = useState<Link[]>(card.links);

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
                title={c.name}
                className={`swatch${draft.color === c.value ? " selected" : ""}${
                  c.value ? "" : " none"
                }`}
                style={c.value ? { background: c.value } : undefined}
                onClick={() => set("color", c.value)}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span>Links (GitHub PRs, Linear, Slack, Notion, Figma…)</span>
          {links.map((l, i) => (
            <div key={i} className="link-editor">
              <input
                placeholder="Label (optional)"
                value={l.label}
                onChange={(e) =>
                  setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
              <input
                placeholder="https://…"
                value={l.url}
                onChange={(e) =>
                  setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                }
              />
              {l.url.trim() && (
                <span className="link-kind">{KIND_LABEL[linkKind(l.url)]}</span>
              )}
              <button className="btn" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn" onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}>
            + Add link
          </button>
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
