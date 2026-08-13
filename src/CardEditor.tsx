import { useState } from "react";
import type { Card, Link } from "./types";

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

  // PR urls edited as newline-separated text
  const [prText, setPrText] = useState(card.prUrls.join("\n"));
  const [links, setLinks] = useState<Link[]>(card.links);

  function save() {
    const prUrls = prText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({
      ...draft,
      prUrls,
      links: links.filter((l) => l.url.trim()),
      linearUrl: draft.linearUrl?.trim() || undefined,
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

        <label className="field">
          <span>Linear issue URL</span>
          <input
            value={draft.linearUrl ?? ""}
            onChange={(e) => set("linearUrl", e.target.value)}
            placeholder="https://linear.app/…/issue/ENG-123/…"
          />
        </label>

        <label className="field">
          <span>GitHub PR URLs (one per line)</span>
          <textarea
            rows={3}
            value={prText}
            onChange={(e) => setPrText(e.target.value)}
            placeholder="https://github.com/org/repo/pull/123"
          />
        </label>

        <div className="field">
          <span>Other links (Slack, Notion, Figma…)</span>
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
