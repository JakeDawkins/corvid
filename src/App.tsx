import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, Data, IssueStatus, PrStatus } from "./types";
import { loadData, refresh, resolveLink, saveData } from "./api";
import { linearKey, linkKind, normalizeCard } from "./links";
import { IssueRow, PrRow } from "./Badges";
import { CardEditor } from "./CardEditor";
import { Inbox } from "./Inbox";
import type { DragItem } from "./Inbox";

const EMPTY: Data = { columns: [], cards: [], cache: { prs: {}, issues: {} } };

// Virtual column id for the far-right "Hidden" column. Not a real user column;
// membership is driven by each card's `hidden` flag rather than its `column`.
const HIDDEN_COL = "__hidden__";

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
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [quickLink, setQuickLink] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [showInbox, setShowInbox] = useState(false);
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
    const urls = [
      ...new Set(data.cards.flatMap((c) => c.links.map((l) => l.url))),
    ];
    const prUrls = urls.filter((u) => linkKind(u) === "pr");
    const linearUrls = urls.filter((u) => linkKind(u) === "linear");
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

  // Move a card to a column, placing it after the column's current last card so
  // it lands at the bottom of that list rather than keeping its old array slot.
  // Dropping onto the Hidden column hides the card (keeping its real column);
  // dropping onto a real column unhides it.
  function moveCard(id: string, column: string) {
    setData((d) => {
      const idx = d.cards.findIndex((c) => c.id === id);
      if (idx === -1) return d;
      if (column === HIDDEN_COL) {
        return {
          ...d,
          cards: d.cards.map((c) => (c.id === id ? { ...c, hidden: true } : c)),
        };
      }
      const moved = { ...d.cards[idx], column, hidden: false };
      const rest = d.cards.filter((c) => c.id !== id);
      let insertAt = rest.length;
      for (let i = rest.length - 1; i >= 0; i--) {
        if (rest[i].column === column) {
          insertAt = i + 1;
          break;
        }
      }
      rest.splice(insertAt, 0, moved);
      return { ...d, cards: rest };
    });
  }

  // Reorder by dropping the dragged card onto another card: insert it just before
  // the target and adopt the target's column (so this also works across columns).
  function reorderCard(id: string, targetId: string) {
    if (id === targetId) return;
    setData((d) => {
      const from = d.cards.findIndex((c) => c.id === id);
      const target = d.cards.find((c) => c.id === targetId);
      if (from === -1 || !target) return d;
      const rest = d.cards.filter((c) => c.id !== id);
      const insertAt = rest.findIndex((c) => c.id === targetId);
      rest.splice(insertAt, 0, {
        ...d.cards[from],
        column: target.column,
        hidden: target.hidden,
      });
      return { ...d, cards: rest };
    });
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
        links: [{ label: "", url }],
      };
      if (result.kind === "pr") {
        setData((d) => ({
          ...d,
          cards: [...d.cards, base],
          cache: {
            prs: { ...d.cache?.prs, [url]: result.status },
            issues: { ...d.cache?.issues },
          },
        }));
      } else {
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

  // Add a card straight from an already-resolved inbox item, pre-caching its
  // status so its badges show without a refresh (mirrors quickCreate).
  function addPrCard(status: PrStatus) {
    const column = data.columns[0];
    if (!column) return;
    const card: Card = {
      id: crypto.randomUUID(),
      title: status.title || status.url,
      column,
      hidden: false,
      links: [{ label: "", url: status.url }],
    };
    setData((d) => ({
      ...d,
      cards: [...d.cards, card],
      cache: {
        prs: { ...d.cache?.prs, [status.url]: status },
        issues: { ...d.cache?.issues },
      },
    }));
  }

  function addLinearCard(status: IssueStatus) {
    const column = data.columns[0];
    if (!column) return;
    const card: Card = {
      id: crypto.randomUUID(),
      title: status.title || status.url,
      column,
      hidden: false,
      links: [{ label: "", url: status.url }],
    };
    setData((d) => ({
      ...d,
      cards: [...d.cards, card],
      cache: {
        prs: { ...d.cache?.prs },
        issues: { ...d.cache?.issues, [status.url]: status },
      },
    }));
  }

  // Link a dragged inbox item onto an existing card, pre-caching its status.
  function linkItemToCard(cardId: string, item: DragItem) {
    setData((d) => {
      const cards = d.cards.map((c) => {
        if (c.id !== cardId) return c;
        return c.links.some((l) => l.url === item.status.url)
          ? c
          : { ...c, links: [...c.links, { label: "", url: item.status.url }] };
      });
      const cache = {
        prs: { ...d.cache?.prs },
        issues: { ...d.cache?.issues },
      };
      if (item.kind === "pr") cache.prs[item.status.url] = item.status;
      else cache.issues[item.status.url] = item.status;
      return { ...d, cards, cache };
    });
  }

  function newCard(column: string) {
    setEditing({
      id: crypto.randomUUID(),
      title: "",
      column,
      hidden: false,
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
        parsed.cards = (parsed.cards ?? []).map(normalizeCard);
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
      if (c.hidden) continue;
      (map[c.column] ??= []).push(c);
    }
    return map;
  }, [data]);

  const hiddenCards = useMemo(
    () => data.cards.filter((c) => c.hidden),
    [data],
  );
  const hiddenCount = hiddenCards.length;

  // URLs already on the board, so the inbox can mark them instead of re-adding.
  const existingPrUrls = useMemo(
    () =>
      new Set(
        data.cards
          .flatMap((c) => c.links.map((l) => l.url))
          .filter((u) => linkKind(u) === "pr"),
      ),
    [data.cards],
  );
  // Normalized so an item counts as "on the board" even if its card's URL uses a
  // different slug/query than the inbox's canonical URL for the same entity.
  const existingLinearKeys = useMemo(
    () =>
      new Set(
        data.cards
          .flatMap((c) => c.links.map((l) => l.url))
          .filter((u) => linkKind(u) === "linear")
          .map(linearKey),
      ),
    [data.cards],
  );

  const renderCard = (card: Card) => {
    // Group the flat link list by kind for display: Linear rows, then PR rows
    // (merged sorted to the bottom), then misc links as chips.
    const linearUrls = card.links
      .map((l) => l.url)
      .filter((u) => linkKind(u) === "linear");
    const prUrls = card.links
      .map((l) => l.url)
      .filter((u) => linkKind(u) === "pr");
    const otherLinks = card.links.filter((l) => linkKind(l.url) === "generic");

    return (
    <div
      key={card.id}
      className={`card${dragItem ? " link-target" : ""}${
        dragOverId === card.id ? " drop-before" : ""
      }`}
      style={card.color ? { border: `2px solid ${card.color}` } : undefined}
      draggable
      onDragStart={() => setDragId(card.id)}
      onDragEnd={() => {
        setDragId(null);
        setDragOverId(null);
      }}
      onDragOver={(e) => {
        if (dragItem) e.preventDefault();
        else if (dragId && dragId !== card.id) {
          e.preventDefault();
          setDragOverId(card.id);
        }
      }}
      onDragLeave={() => {
        if (dragOverId === card.id) setDragOverId(null);
      }}
      onDrop={(e) => {
        if (dragItem) {
          e.stopPropagation();
          linkItemToCard(card.id, dragItem);
          setDragItem(null);
        } else if (dragId) {
          e.stopPropagation();
          reorderCard(dragId, card.id);
          setDragId(null);
          setDragOverId(null);
        }
      }}
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

      {otherLinks.length > 0 && (
        <div className="group links">
          {otherLinks.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer" className="chip">
              {l.label?.trim() || domainName(l.url)}
            </a>
          ))}
        </div>
      )}

      {card.notes && <div className="card-notes">{card.notes}</div>}

      {linearUrls.length > 0 && (
        <div className="group linear">
          {linearUrls.map((u) => (
            <IssueRow key={u} url={u} status={cache.issues[u]} />
          ))}
        </div>
      )}

      {prUrls.length > 0 && (
        <div className="group prs">
          {[...prUrls]
            .sort(
              (a, b) =>
                (cache.prs[a]?.state === "MERGED" ? 1 : 0) -
                (cache.prs[b]?.state === "MERGED" ? 1 : 0),
            )
            .map((u) => (
              <PrRow key={u} url={u} status={cache.prs[u]} />
            ))}
        </div>
      )}
    </div>
    );
  };

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
        <button
          className={`btn${showInbox ? " active" : ""}`}
          onClick={() => setShowInbox((v) => !v)}
        >
          ☰ My work
        </button>
        <button className="btn primary" onClick={doRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
        {lastRefresh && <span className="hint">updated {lastRefresh}</span>}
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

      <div className="app-body">
      <div className="board">
        {data.columns.map((col) => (
          <div
            key={col}
            className={`column${dragId ? " droppable" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) moveCard(dragId, col);
              setDragId(null);
              setDragOverId(null);
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
              {(cardsByColumn[col] ?? []).map(renderCard)}
            </div>
          </div>
        ))}

        <div
          className={`column hidden-column${dragId ? " droppable" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId) moveCard(dragId, HIDDEN_COL);
            setDragId(null);
            setDragOverId(null);
          }}
        >
          <div className="column-head">
            <span>Hidden</span>
            <span className="count">{hiddenCount}</span>
            <button
              className="toggle-hidden"
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? "Hide items" : "Show items"}
            >
              {showHidden ? "Hide" : "Show"}
            </button>
          </div>
          {showHidden && (
            <div className="cards">{hiddenCards.map(renderCard)}</div>
          )}
        </div>
      </div>

      {showInbox && (
        <Inbox
          targetColumn={data.columns[0]}
          existingPrUrls={existingPrUrls}
          existingLinearKeys={existingLinearKeys}
          onAddPr={addPrCard}
          onAddLinear={addLinearCard}
          onDragItem={setDragItem}
          onDragEnd={() => setDragItem(null)}
          onClose={() => setShowInbox(false)}
        />
      )}
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
