import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, Data } from "./types";
import { loadData, refresh, resolveLink, saveData } from "./api";
import { IssueRow, PrRow } from "./Badges";
import { CardEditor } from "./CardEditor";

const EMPTY: Data = { columns: [], cards: [], cache: { prs: {}, issues: {} } };

// Fallback label for a link with no title: the site's second-level domain.
// "https://www.figma.com/file/…" -> "figma", "docs.google.com" -> "google".
function domainName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || "link";
  }
}

export default function App() {
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [quickLink, setQuickLink] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // initial load
  useEffect(() => {
    loadData().then((d) => {
      setData(d);
      setLoaded(true);
    });
  }, []);

  // debounced autosave
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveData(data), 400);
  }, [data, loaded]);

  const cache = data.cache ?? { prs: {}, issues: {} };

  async function doRefresh() {
    const prUrls = [...new Set(data.cards.flatMap((c) => c.prUrls))];
    const linearUrls = [
      ...new Set(data.cards.map((c) => c.linearUrl).filter(Boolean) as string[]),
    ];
    if (!prUrls.length && !linearUrls.length) return;
    setRefreshing(true);
    try {
      const fresh = await refresh(prUrls, linearUrls);
      setData((d) => ({
        ...d,
        cache: {
          prs: { ...d.cache?.prs, ...fresh.prs },
          issues: { ...d.cache?.issues, ...fresh.issues },
        },
      }));
      setLastRefresh(new Date().toLocaleTimeString());
    } finally {
      setRefreshing(false);
    }
  }

  function upsertCard(card: Card) {
    setData((d) => {
      const exists = d.cards.some((c) => c.id === card.id);
      return {
        ...d,
        cards: exists
          ? d.cards.map((c) => (c.id === card.id ? card : c))
          : [...d.cards, card],
      };
    });
  }

  function deleteCard(id: string) {
    setData((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
  }

  function toggleHidden(id: string) {
    setData((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === id ? { ...c, hidden: !c.hidden } : c)),
    }));
  }

  function moveCard(id: string, column: string) {
    setData((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === id ? { ...c, column } : c)),
    }));
  }

  // Quick-create a card from a pasted GitHub PR or Linear link. The card's
  // title is set to the resolved PR/issue title and its status is pre-cached.
  async function quickCreate() {
    const url = quickLink.trim();
    if (!url || quickBusy) return;
    const column = data.columns[0];
    if (!column) return;
    setQuickBusy(true);
    setQuickError(null);
    try {
      const result = await resolveLink(url);
      if (result.kind === "unknown" || result.status.error) {
        setQuickError(
          result.kind === "unknown" ? result.error : result.status.error!,
        );
        return;
      }
      const base: Card = {
        id: crypto.randomUUID(),
        title: result.status.title || url,
        column,
        hidden: false,
        prUrls: [],
        links: [],
      };
      if (result.kind === "pr") {
        base.prUrls = [url];
        setData((d) => ({
          ...d,
          cards: [...d.cards, base],
          cache: {
            prs: { ...d.cache?.prs, [url]: result.status },
            issues: { ...d.cache?.issues },
          },
        }));
      } else {
        base.linearUrl = url;
        setData((d) => ({
          ...d,
          cards: [...d.cards, base],
          cache: {
            prs: { ...d.cache?.prs },
            issues: { ...d.cache?.issues, [url]: result.status },
          },
        }));
      }
      setQuickLink("");
    } catch {
      setQuickError("Failed to resolve link");
    } finally {
      setQuickBusy(false);
    }
  }

  function newCard(column: string) {
    setEditing({
      id: crypto.randomUUID(),
      title: "",
      column,
      hidden: false,
      prUrls: [],
      links: [],
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pr-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Data;
        parsed.cache ??= { prs: {}, issues: {} };
        setData(parsed);
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  const cardsByColumn = useMemo(() => {
    const map: Record<string, Card[]> = {};
    for (const col of data.columns) map[col] = [];
    for (const c of data.cards) {
      if (c.hidden && !showHidden) continue;
      (map[c.column] ??= []).push(c);
    }
    return map;
  }, [data, showHidden]);

  const hiddenCount = data.cards.filter((c) => c.hidden).length;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>PR Tracker</h1>
        <form
          className="quick-create"
          onSubmit={(e) => {
            e.preventDefault();
            quickCreate();
          }}
        >
          <input
            type="text"
            placeholder="Paste a GitHub or Linear link…"
            value={quickLink}
            onChange={(e) => {
              setQuickLink(e.target.value);
              if (quickError) setQuickError(null);
            }}
            disabled={quickBusy}
          />
          <button
            type="submit"
            className="btn"
            disabled={quickBusy || !quickLink.trim()}
          >
            {quickBusy ? "Adding…" : "+ Add"}
          </button>
        </form>
        {quickError && <span className="hint error">{quickError}</span>}
        <div className="spacer" />
        <button className="btn primary" onClick={doRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
        {lastRefresh && <span className="hint">updated {lastRefresh}</span>}
        <label className="toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Show hidden{hiddenCount ? ` (${hiddenCount})` : ""}
        </label>
        <button className="btn" onClick={exportJson}>Export</button>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = "";
          }}
        />
      </header>

      <div className="board">
        {data.columns.map((col) => (
          <div
            key={col}
            className={`column${dragId ? " droppable" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) moveCard(dragId, col);
              setDragId(null);
            }}
          >
            <div className="column-head">
              <span>{col}</span>
              <span className="count">{cardsByColumn[col]?.length ?? 0}</span>
              <button className="add" onClick={() => newCard(col)} title="Add card">
                +
              </button>
            </div>
            <div className="cards">
              {(cardsByColumn[col] ?? []).map((card) => (
                <div
                  key={card.id}
                  className={`card${card.hidden ? " dim" : ""}`}
                  draggable
                  onDragStart={() => setDragId(card.id)}
                  onDragEnd={() => setDragId(null)}
                >
                  <div className="card-title-row">
                    <span className="card-title">{card.title || "(untitled)"}</span>
                    <div className="card-actions">
                      <button onClick={() => setEditing(card)} title="Edit">✎</button>
                      <button onClick={() => toggleHidden(card.id)} title={card.hidden ? "Unhide" : "Hide"}>
                        {card.hidden ? "◑" : "○"}
                      </button>
                    </div>
                  </div>

                  {card.notes && <div className="card-notes">{card.notes}</div>}

                  {card.linearUrl && (
                    <div className="group">
                      <IssueRow url={card.linearUrl} status={cache.issues[card.linearUrl]} />
                    </div>
                  )}

                  {card.prUrls.length > 0 && (
                    <div className="group">
                      {card.prUrls.map((u) => (
                        <PrRow key={u} url={u} status={cache.prs[u]} />
                      ))}
                    </div>
                  )}

                  {card.links.length > 0 && (
                    <div className="group links">
                      {card.links.map((l, i) => (
                        <a key={i} href={l.url} target="_blank" rel="noreferrer" className="chip">
                          {l.label?.trim() || domainName(l.url)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <CardEditor
          card={editing}
          columns={data.columns}
          onCancel={() => setEditing(null)}
          onSave={(c) => {
            upsertCard(c);
            setEditing(null);
          }}
          onDelete={() => {
            deleteCard(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
