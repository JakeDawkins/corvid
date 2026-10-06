import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Cache, Card } from "./types";
import { linkKind } from "./links";
import { useMask } from "./mask";
import type { MaskCategory } from "./mask";

// What a search hit matched on, in priority order: a card title beats a Linear
// task id, which beats a link's title, which beats its raw URL.
type FieldKind = "title" | "linear" | "label" | "url";
const RANK: Record<FieldKind, number> = { title: 0, linear: 1, label: 2, url: 3 };

type Field = { kind: FieldKind; text: string; mask?: MaskCategory };
type Hit = { card: Card; field: Field; score: number };

// Cap the list so typing stays snappy on a big board.
const MAX_RESULTS = 50;

// Linear task id ("PLA-123") from an issue URL, or null for anything else.
function linearId(url: string): string | null {
  const m = url.match(/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

// Everything a card can be found by. Link titles are the user's label or, failing
// that, the PR/issue title from the status cache.
function cardFields(card: Card, cache: Cache): Field[] {
  const fields: Field[] = [{ kind: "title", text: card.title, mask: "cardTitles" }];
  const ids = new Set<string>();
  for (const l of card.links) {
    const id = linearId(l.url) ?? cache.issues[l.url]?.identifier;
    if (id && !ids.has(id)) {
      ids.add(id);
      fields.push({ kind: "linear", text: id });
    }
  }
  for (const l of card.links) {
    if (l.label.trim()) fields.push({ kind: "label", text: l.label.trim(), mask: "linkLabels" });
    const kind = linkKind(l.url);
    const fetched =
      kind === "pr" ? cache.prs[l.url]?.title : kind === "linear" ? cache.issues[l.url]?.title : undefined;
    if (fetched) {
      fields.push({ kind: "label", text: fetched, mask: kind === "pr" ? "prTitles" : "linearTitles" });
    }
  }
  for (const l of card.links) fields.push({ kind: "url", text: l.url, mask: "urls" });
  return fields;
}

// Score a field against the query, lower is better, or null if it doesn't match.
// Every word of the query must appear in the field. Within a kind, a match at
// the very start beats one at a word start, which beats one mid-word.
function scoreField(field: Field, query: string, words: string[]): number | null {
  const text = field.text.toLowerCase();
  if (!words.every((w) => text.includes(w))) return null;
  const at = text.indexOf(query);
  const quality = at === 0 ? 0 : at > 0 && !/[a-z0-9]/.test(text[at - 1]) ? 1 : 2;
  return RANK[field.kind] * 3 + quality;
}

function search(cards: Card[], cache: Cache, raw: string): Hit[] {
  const query = raw.trim().toLowerCase();
  if (!query) {
    return cards
      .slice(0, MAX_RESULTS)
      .map((card) => ({ card, field: { kind: "title", text: card.title }, score: 0 }));
  }
  const words = query.split(/\s+/);
  const hits: Hit[] = [];
  for (const card of cards) {
    let best: Hit | null = null;
    for (const field of cardFields(card, cache)) {
      const score = scoreField(field, query, words);
      if (score !== null && (!best || score < best.score)) best = { card, field, score };
    }
    if (best) hits.push(best);
  }
  // Array.sort is stable, so equal scores keep board order.
  return hits.sort((a, b) => a.score - b.score).slice(0, MAX_RESULTS);
}

// Wrap each query word's occurrences in <mark>.
function highlight(text: string, words: string[]): ReactNode {
  const ws = words.filter(Boolean);
  if (!ws.length) return text;
  const escaped = ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

const KIND_LABEL: Record<Exclude<FieldKind, "title">, string> = {
  linear: "Linear",
  label: "Link",
  url: "URL",
};

// Spotlight-style card finder, opened with Cmd+K. Arrow keys move the
// selection, Return opens it, Escape closes. Keyboard focus never leaves the
// input, so it works without a mouse.
export function Search({
  cards,
  columns,
  cache,
  onOpen,
  onClose,
}: {
  // Cards in board order; hidden ones last.
  cards: Card[];
  columns: string[];
  cache: Cache;
  onOpen: (card: Card) => void;
  onClose: () => void;
}) {
  const { m } = useMask();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Board order: by column, then position within it, with hidden cards last.
  const ordered = useMemo(() => {
    const col = (c: Card) => (c.hidden ? columns.length : columns.indexOf(c.column));
    return [...cards].sort((a, b) => col(a) - col(b));
  }, [cards, columns]);
  const hits = useMemo(() => search(ordered, cache, query), [ordered, cache, query]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  useEffect(() => setSelected(0), [query]);

  // Keep the selected row in view while arrowing through a long list.
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Restore focus to whatever had it (e.g. a field in the card editor) when the
  // search closes without opening a card. Captured on first render, before the
  // input's autoFocus takes it.
  const [prevFocus] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(
    () => () => {
      if (prevFocus?.isConnected && document.activeElement === document.body) prevFocus.focus();
    },
    [prevFocus],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (hits[selected]) onOpen(hits[selected].card);
    } else if (e.key === "Escape") {
      // Close just the search, not a card editor open underneath.
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div
        className="search"
        role="dialog"
        aria-label="Search cards"
        onClick={(e) => e.stopPropagation()}
        // Keep focus in the input when clicking elsewhere in the panel.
        onMouseDown={(e) => {
          if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
        }}
      >
        <div className="search-input">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search cards, Linear ids, links…"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded
            aria-controls="search-results"
            aria-activedescendant={hits[selected] ? `search-hit-${selected}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <div className="search-results" id="search-results" role="listbox" ref={listRef}>
          {hits.length === 0 && <div className="search-empty">No matching cards</div>}
          {hits.map(({ card, field }, i) => {
            const detail = field.kind === "title" ? null : field;
            return (
              <div
                key={card.id}
                id={`search-hit-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === selected}
                className={`search-hit${i === selected ? " selected" : ""}`}
                style={card.color ? ({ "--card-color": card.color } as CSSProperties) : undefined}
                onMouseMove={() => setSelected(i)}
                onClick={() => onOpen(card)}
              >
                <span className="search-hit-dot" />
                <div className="search-hit-main">
                  <div className="search-hit-title">
                    {highlight(m("cardTitles", card.title) || "(untitled)", words)}
                  </div>
                  {detail && (
                    <div className="search-hit-detail">
                      <span className="search-hit-kind">{KIND_LABEL[detail.kind as Exclude<FieldKind, "title">]}</span>
                      {highlight(detail.mask ? m(detail.mask, detail.text) : detail.text, words)}
                    </div>
                  )}
                </div>
                <span className="search-hit-col">
                  {card.hidden ? "Hidden" : m("columnNames", card.column)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="search-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to open</span>
          <span><kbd>esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
