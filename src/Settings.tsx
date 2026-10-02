import { useEffect, useRef, useState } from "react";
import { BACKLOG_MATCH, CLAUDE_MATCH } from "./columns";
import { loadVercelProjects } from "./api";
import { COLORS } from "./colors";
import { hasName } from "./links";
import { MASK_CATEGORIES, categoryOn, useMask } from "./mask";
import type { MaskSettings } from "./mask";
import { THEMES } from "./theme";
import type { Theme } from "./theme";
import type { VercelProject } from "./types";

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
  hiddenRepos,
  knownRepos,
  onSetRepoHidden,
  hiddenVercelProjects,
  onSetProjectHidden,
  colorTags,
  onSetColorTag,
  maskSettings,
  onSetMaskSettings,
  theme,
  onSetTheme,
  onExport,
  onImport,
  onClose,
}: {
  columns: string[];
  // Cards per column, hidden cards included.
  cardCounts: Record<string, number>;
  onRenameColumn: (from: string, to: string) => void;
  onAddColumn: (name: string) => void;
  onDeleteColumn: (name: string) => void;
  hiddenRepos: string[];
  // "owner/repo" slugs seen on the board, offered as suggestions.
  knownRepos: string[];
  onSetRepoHidden: (repo: string, hidden: boolean) => void;
  hiddenVercelProjects: string[];
  onSetProjectHidden: (name: string, hidden: boolean) => void;
  colorTags: Record<string, string>;
  onSetColorTag: (color: string, name: string) => void;
  maskSettings: MaskSettings;
  onSetMaskSettings: (s: MaskSettings) => void;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
  onExport: () => void;
  // Replaces the whole board with the file's contents.
  onImport: (file: File) => void;
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
        <h3>Appearance</h3>
        <p className="hint">Saved in this browser. System follows your OS light/dark setting.</p>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              className={`segmented-option${theme === t.value ? " selected" : ""}`}
              onClick={() => onSetTheme(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

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

      <MaskedMode settings={maskSettings} onChange={onSetMaskSettings} />
      <ColorLabels tags={colorTags} onSetTag={onSetColorTag} />
      <HiddenRepos hidden={hiddenRepos} known={knownRepos} onSetHidden={onSetRepoHidden} />
      <HiddenVercelProjects hidden={hiddenVercelProjects} onSetHidden={onSetProjectHidden} />
      <ImportExport onExport={onExport} onImport={onImport} />
    </div>
  );
}

function ImportExport({
  onExport,
  onImport,
}: {
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section className="settings-section">
      <h3>Import and export</h3>
      <p className="hint">
        Export downloads the whole board as JSON. Importing a file replaces the current board with
        its contents.
      </p>
      <div className="settings-row-main">
        <button className="btn" onClick={onExport}>Export</button>
        <button className="btn" onClick={() => fileInput.current?.click()}>Import</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}

function MaskedMode({
  settings,
  onChange,
}: {
  settings: MaskSettings;
  onChange: (s: MaskSettings) => void;
}) {
  return (
    <section className="settings-section">
      <h3>Masked mode</h3>
      <p className="hint">
        Swaps sensitive text for placeholder words so the board can be shared in screenshots. Your
        data isn't changed. Press Shift+M anywhere to toggle it.
      </p>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
        />
        Mask sensitive text
      </label>
      <details className="settings-details">
        <summary>Choose what to mask</summary>
        {MASK_CATEGORIES.map((c) => (
          <label className="settings-check" key={c.key}>
            <input
              type="checkbox"
              checked={categoryOn(settings, c.key)}
              onChange={(e) =>
                onChange({ ...settings, categories: { ...settings.categories, [c.key]: e.target.checked } })
              }
            />
            {c.label}
          </label>
        ))}
      </details>
    </section>
  );
}

function ColorLabels({
  tags,
  onSetTag,
}: {
  tags: Record<string, string>;
  onSetTag: (color: string, name: string) => void;
}) {
  const { m, on } = useMask();
  return (
    <section className="settings-section">
      <h3>Color labels</h3>
      <p className="hint">A label is shown on every card using that color. Leave blank for no label.</p>
      {COLORS.filter((c) => c.value).map((c) => (
        <div className="settings-row" key={c.value}>
          <div className="settings-row-main settings-color">
            <span className="swatch" style={{ background: c.value }} aria-hidden="true" />
            <input
              value={m("colorLabels", tags[c.value!] ?? "")}
              readOnly={on("colorLabels")}
              onChange={(e) => onSetTag(c.value!, e.target.value)}
              placeholder={`Label for ${c.name.toLowerCase()} (e.g. sales)`}
              aria-label={`Label for ${c.name}`}
            />
          </div>
        </div>
      ))}
    </section>
  );
}

// Accepts "owner/repo" or any github.com URL inside the repo.
function parseRepo(input: string): string | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

function HiddenRepos({
  hidden,
  known,
  onSetHidden,
}: {
  hidden: string[];
  known: string[];
  onSetHidden: (repo: string, hidden: boolean) => void;
}) {
  const { m } = useMask();
  const [value, setValue] = useState("");
  const repo = parseRepo(value);
  const error = !value.trim()
    ? null
    : !repo
      ? 'Enter a repo as "owner/repo" or paste a GitHub link.'
      : hasName(hidden, repo)
        ? "That repo is already hidden."
        : null;

  return (
    <section className="settings-section">
      <h3>Hidden repositories</h3>
      <p className="hint">Open PRs from these repos are left out of My work.</p>
      {hidden.length === 0 && <p className="hint">No hidden repositories.</p>}
      {hidden.map((r) => (
        <div className="settings-row" key={r}>
          <div className="settings-row-main">
            <span className="settings-name">{m("repoNames", r)}</span>
            <button type="button" className="btn" onClick={() => onSetHidden(r, false)}>
              Unhide
            </button>
          </div>
        </div>
      ))}
      <form
        className="settings-row settings-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (repo && !error) {
            onSetHidden(repo, true);
            setValue("");
          }
        }}
      >
        <div className="settings-row-main">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="owner/repo"
            aria-label="Repository to hide"
            list="known-repos"
          />
          <datalist id="known-repos">
            {known
              .filter((r) => !hasName(hidden, r))
              .map((r) => (
                <option key={r} value={r} />
              ))}
          </datalist>
          <button type="submit" className="btn" disabled={!repo || !!error}>
            Hide repo
          </button>
        </div>
        {error && <span className="hint error">{error}</span>}
      </form>
    </section>
  );
}

function HiddenVercelProjects({
  hidden,
  onSetHidden,
}: {
  hidden: string[];
  onSetHidden: (name: string, hidden: boolean) => void;
}) {
  const { m } = useMask();
  const [projects, setProjects] = useState<VercelProject[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadVercelProjects().then(({ projects, error }) => {
      setProjects(projects);
      setError(error);
    });
  }, []);

  // Names in the data file that no loaded project matches (renamed, deleted, or
  // Vercel unreachable), so they can still be unhidden.
  const unmatched = hidden.filter((n) => !projects?.some((p) => p.name.toLowerCase() === n.toLowerCase()));

  return (
    <section className="settings-section">
      <h3>Vercel projects</h3>
      <p className="hint">Click a project to show or hide it in Deployments.</p>
      {error && <p className="hint error">{error}</p>}
      {projects === null ? (
        <p className="hint">Loading…</p>
      ) : (
        <div className="settings-pills">
          {projects.map((p) => {
            const on = !hasName(hidden, p.name);
            return (
              <button
                key={p.id}
                className={`pill${on ? " active" : ""}`}
                onClick={() => onSetHidden(p.name, on)}
                title={on ? "Hide" : "Show"}
              >
                {m("repoNames", p.name)}
              </button>
            );
          })}
          {unmatched.map((n) => (
            <button
              key={n}
              className="pill"
              onClick={() => onSetHidden(n, false)}
              title="Not found in Vercel. Click to remove from the hidden list."
            >
              {m("repoNames", n)}
            </button>
          ))}
          {projects.length === 0 && unmatched.length === 0 && !error && (
            <p className="hint">No Vercel projects.</p>
          )}
        </div>
      )}
    </section>
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
  const { m, on } = useMask();
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
          value={m("columnNames", value)}
          readOnly={on("columnNames")}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setValue(name);
          }}
          aria-label={`Rename column ${m("columnNames", name)}`}
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
