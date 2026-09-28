import { useState } from "react";
import { BACKLOG_MATCH, CLAUDE_MATCH } from "./columns";

// Why a proposed column name can't be used, or null if it's fine. `current` is
// the column being renamed, so keeping (or re-casing) its own name is allowed.
function nameError(next: string, columns: string[], current?: string): string | null {
  if (!next) return "Name can't be empty.";
  if (columns.some((c) => c !== current && c.toLowerCase() === next.toLowerCase()))
    return "A column with that name already exists.";
  return null;
}

export function Settings({
  columns,
  cardCounts,
  onRenameColumn,
  onAddColumn,
  onDeleteColumn,
  onClose,
}: {
  columns: string[];
  // Cards per column, hidden cards included.
  cardCounts: Record<string, number>;
  onRenameColumn: (from: string, to: string) => void;
  onAddColumn: (name: string) => void;
  onDeleteColumn: (name: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const next = newName.trim();
  const addError = next ? nameError(next, columns) : null;

  return (
    <div className="settings">
      <div className="settings-head">
        <button className="settings-back" onClick={onClose} title="Back to board" aria-label="Back to board">
          ←
        </button>
        <h2>Settings</h2>
      </div>

      <section className="settings-section">
        <h3>Columns</h3>
        <p className="hint">Renaming a column keeps all of its cards in it. Only empty columns can be deleted.</p>
        {columns.map((col) => (
          // Keyed by name so the row resets to the new name after a rename.
          <ColumnRow
            key={col}
            name={col}
            columns={columns}
            cardCount={cardCounts[col] ?? 0}
            onRename={onRenameColumn}
            onDelete={onDeleteColumn}
          />
        ))}
        <form
          className="settings-row settings-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (next && !addError) {
              onAddColumn(next);
              setNewName("");
            }
          }}
        >
          <div className="settings-row-main">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New column name"
              aria-label="New column name"
            />
            <button type="submit" className="btn" disabled={!next || !!addError}>
              Add column
            </button>
          </div>
          {addError && <span className="hint error">{addError}</span>}
        </form>
      </section>
    </div>
  );
}

function ColumnRow({
  name,
  columns,
  cardCount,
  onRename,
  onDelete,
}: {
  name: string;
  columns: string[];
  cardCount: number;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  const next = value.trim();
  const changed = next !== name;
  const error = nameError(next, columns, name);
  const deleteBlocked =
    cardCount > 0
      ? `Move or delete its ${cardCount} card${cardCount === 1 ? "" : "s"} (including hidden ones) before deleting this column.`
      : columns.length === 1
        ? "The board needs at least one column."
        : null;

  // Columns whose special behavior is tied to their name.
  let hint: string | null = null;
  if (CLAUDE_MATCH.test(name)) {
    hint = CLAUDE_MATCH.test(next)
      ? 'Shown in the Suggested popover while its name contains "claude". The suggested-tasks routine writes to it by name.'
      : 'Without "claude" in the name, this becomes a regular board column and the suggested-tasks routine can\'t find it.';
  } else if (BACKLOG_MATCH.test(name)) {
    hint = BACKLOG_MATCH.test(next)
      ? "Quick-added and My work cards land here."
      : 'Quick-added and My work cards land here only while it\'s named "Backlog"; otherwise they go to the first column.';
  }

  return (
    <form
      className="settings-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed && !error) onRename(name, next);
      }}
    >
      <div className="settings-row-main">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setValue(name);
          }}
          aria-label={`Rename column ${name}`}
        />
        <button type="submit" className="btn primary" disabled={!changed || !!error}>
          Rename
        </button>
        {/* Title lives on a wrapper: disabled buttons don't reliably show tooltips. */}
        <span title={deleteBlocked ?? `Delete "${name}"`}>
          <button
            type="button"
            className="btn danger"
            disabled={!!deleteBlocked}
            onClick={() => onDelete(name)}
          >
            Delete
          </button>
        </span>
      </div>
      {changed && error ? (
        <span className="hint error">{error}</span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </form>
  );
}
