import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, Data, IssueStatus, PrStatus } from "./types";
import { loadData, refresh, resolveLink, saveData } from "./api";
import { linearKey, linkKind, normalizeCard, parsePrUrl } from "./links";
import type { VercelDeployment } from "./types";
import { IssueRow, PrRow } from "./Badges";
import { CardEditor } from "./CardEditor";
import { textOn } from "./colors";
import { ComplexityBars } from "./Complexity";
import { Inbox } from "./Inbox";
import type { DragItem } from "./Inbox";
import { Deployments } from "./Deployments";

const EMPTY: Data = { columns: [], cards: [], cache: { prs: {}, issues: {} }, colorTags: {} };

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
  const [showDeployments, setShowDeployments] = useState(false);
  const [deploymentsPaused, setDeploymentsPaused] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // initial load
  useEffect(() => {
    loadData().then((d) => {
      setData(d);
      setLoaded(true);
    });
  }, []);

  // debounced autosave
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while a local edit is queued or being written; used to let UI changes
  // win over a concurrent external file change instead of reloading over them.
  const pendingSave = useRef(false);
  // Set before applying an external reload so the resulting state change doesn't
  // trigger a redundant save back to disk.
  const skipNextSave = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSave.current = true;
    saveTimer.current = setTimeout(async () => {
      await saveData(data);
      pendingSave.current = false;
    }, 400);
  }, [data, loaded]);

  // Reload when data.json changes on disk from outside the UI (e.g. a skill),
  // unless the UI has unsaved edits — those take precedence.
  useEffect(() => {
    if (!loaded) return;
    const es = new EventSource("/api/events");
    es.addEventListener("data", async () => {
      if (pendingSave.current) return;
      const fresh = await loadData();
      skipNextSave.current = true;
      setData(fresh);
    });
    return () => es.close();
  }, [loaded]);

  // Reopening the Deployments sidebar should always start actively polling.
  useEffect(() => {
    if (!showDeployments) setDeploymentsPaused(false);
  }, [showDeployments]);

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

  // Name (or rename) an accent color globally. An empty name clears the tag.
  function setColorTag(color: string, name: string) {
    setData((d) => {
      const tags = { ...d.colorTags };
      if (name.trim()) tags[color] = name;
      else delete tags[color];
      return { ...d, colorTags: tags };
    });
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
    a.download = `corvid-${new Date().toISOString().slice(0, 10)}.json`;
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

  // Find a board card whose PR link matches a deployment's org/repo/PR number,
  // so the Deployments sidebar can link a preview build back to its card.
  function findCardForDeployment(dep: VercelDeployment): string | null {
    if (!dep.prNumber || !dep.repo) return null;
    const org = dep.org?.toLowerCase();
    const repo = dep.repo.toLowerCase();
    for (const card of data.cards) {
      for (const l of card.links) {
        const pr = parsePrUrl(l.url);
        if (
          pr &&
          pr.number === dep.prNumber &&
          pr.repo.toLowerCase() === repo &&
          (!org || pr.owner.toLowerCase() === org)
        ) {
          return card.id;
        }
      }
    }
    return null;
  }

  // Copy a card's id to the clipboard (for referencing it with AI agents),
  // flashing a brief "copied" state on that card's button.
  async function copyCardId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  // Briefly highlight a card (and scroll it into view), unhiding it if needed.
  function highlightCard(id: string) {
    const card = data.cards.find((c) => c.id === id);
    if (!card) return;
    if (card.hidden) setShowHidden(true);
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2400);
    requestAnimationFrame(() =>
      cardRefs.current[id]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }),
    );
  }

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
      ref={(el) => {
        cardRefs.current[card.id] = el;
      }}
      className={`card${dragItem ? " link-target" : ""}${
        dragOverId === card.id ? " drop-before" : ""
      }${highlightId === card.id ? " highlight" : ""}`}
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
      <div
        className={`card-title-row${card.color ? " colored" : ""}`}
        style={card.color ? { background: card.color, color: textOn(card.color) } : undefined}
      >
        {card.color && data.colorTags?.[card.color] && (
          <span className="card-tag">{data.colorTags[card.color]}</span>
        )}
        <span
          className="card-title"
          role="button"
          tabIndex={0}
          title="Open details"
          onClick={() => setEditing(card)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(card);
            }
          }}
        >
          {card.title || "(untitled)"}
        </span>
        <div className="card-actions">
          <button
            onClick={() => copyCardId(card.id)}
            title={copiedId === card.id ? "Copied ID" : "Copy card ID"}
          >
            {copiedId === card.id ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          <button onClick={() => toggleHidden(card.id)} title={card.hidden ? "Unhide" : "Hide"}>
            {card.hidden ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {card.complexity && (
        <ComplexityBars value={card.complexity} color={card.color} />
      )}

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
        <div className="brand">
          <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 4 C17.3 4 18.1 5.4 18.1 7.2 C22 5.5 27 5 30.5 7.5 C26.5 8.5 22 10.5 18.7 13.5 L18 19.5 L20 22.5 L16 20.8 L12 22.5 L14 19.5 L13.3 13.5 C10 10.5 5.5 8.5 1.5 7.5 C5 5 10 5.5 13.9 7.2 C13.9 5.4 14.7 4 16 4 Z" />
          </svg>
          <h1>Corvid</h1>
        </div>
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
        <button
          className={`btn${showDeployments ? " active" : ""}${
            showDeployments && deploymentsPaused ? " paused" : ""
          }`}
          onClick={() => setShowDeployments((v) => !v)}
        >
          ▲ Deployments{showDeployments && deploymentsPaused ? " (paused)" : ""}
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

      {showDeployments && (
        <Deployments
          paused={deploymentsPaused}
          onPausedChange={setDeploymentsPaused}
          findCardForDeployment={findCardForDeployment}
          onLinkCard={highlightCard}
          onClose={() => setShowDeployments(false)}
        />
      )}
      </div>

      {editing && (
        <CardEditor
          card={editing}
          columns={data.columns}
          colorTags={data.colorTags ?? {}}
          onSetColorTag={setColorTag}
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
