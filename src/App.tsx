import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AgentsStatus, Card, ContextIndex, Data, IssueStatus, LinearResource, PrStatus } from "./types";
import { loadContextIndex, loadData, refresh, resolveLink, saveData } from "./api";
import { domainName, linearKey, linkKind, linkTitle, normalizeCard, parsePrUrl, toUrl } from "./links";
import type { VercelDeployment } from "./types";
import { CardLink, IssueLine, PrLine, ThreadBadge, WorkspaceTag, resourceLabel } from "./Badges";
import { CardEditor } from "./CardEditor";
import { ContextPage } from "./ContextPage";
import { ComplexityBars } from "./Complexity";
import { DueBadge } from "./Due";
import { Inbox } from "./Inbox";
import type { DragItem } from "./Inbox";
import { Deployments } from "./Deployments";
import { Settings } from "./Settings";
import { Search } from "./Search";
import { NeedsYouBanner } from "./NeedsYou";
import { byArchivedAt, editCard, stamp } from "./cards";
import { ClaudeLogo } from "./ClaudeLogo";
import { ArchiveIcon, CheckIcon, IdCardIcon, UnarchiveIcon } from "./icons";
import { BACKLOG_MATCH, CLAUDE_MATCH, TODO_MATCH, nextColumn } from "./columns";
import { MaskContext, makeMask, useMaskSettings } from "./mask";
import { useTheme } from "./theme";

const EMPTY: Data = { columns: [], cards: [], cache: { prs: {}, issues: {} }, colorTags: {} };

// Virtual column id for the far-right "Archived" column. Not a real user
// column; membership is driven by each card's `hidden` flag rather than its
// `column`. Archived cards keep the field's original name, `hidden`, so
// existing boards and agents keep working.
const ARCHIVED_COL = "__archived__";

// The open context page, from the URL: #/context/<card id>[/<tab>].
type ContextRoute = { cardId: string; tab?: string };

function parseRoute(hash: string): ContextRoute | null {
  const m = hash.match(/^#\/context\/([^/]+)(?:\/([^/]+))?$/);
  return m ? { cardId: decodeURIComponent(m[1]), tab: m[2] && decodeURIComponent(m[2]) } : null;
}

function routeHash(r: ContextRoute): string {
  return `#/context/${encodeURIComponent(r.cardId)}${r.tab ? `/${encodeURIComponent(r.tab)}` : ""}`;
}

// Settings > Next column after renaming column `from` to `to`, in both its
// keys and its targets.
function renameNextColumns(map: Record<string, string>, from: string, to: string) {
  return Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k === from ? to : k, v === from ? to : v]),
  );
}

// Settings > Next column without a deleted column. Columns that pointed at it
// go back to the default, the next column on the board.
function removeNextColumn(map: Record<string, string>, name: string) {
  return Object.fromEntries(Object.entries(map).filter(([k, v]) => k !== name && v !== name));
}

// Insert a new card at the TOP of its column: just before the first card already
// in that column, or at the front of the list if the column is empty.
function insertAtColumnTop(cards: Card[], card: Card): Card[] {
  const at = cards.findIndex((c) => c.column === card.column);
  const next = [...cards];
  if (at === -1) next.unshift(card);
  else next.splice(at, 0, card);
  return next;
}

export default function App() {
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Focus mode shows only the columns picked in Settings > Focused columns.
  const [focusMode, setFocusMode] = useState(false);
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
  const [showClaude, setShowClaude] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [deploymentsPaused, setDeploymentsPaused] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Live Conductor status of workspaces linked on cards, pushed by the server.
  const [agents, setAgents] = useState<AgentsStatus>({ workspaces: {} });
  // Cards with a project context, and a counter per card bumped when its
  // context changes on disk, so an open context page reloads.
  const [contexts, setContexts] = useState<ContextIndex>({});
  const [contextTicks, setContextTicks] = useState<Record<string, number>>({});
  const [contextRoute, setContextRoute] = useState<ContextRoute | null>(() => parseRoute(location.hash));
  // Whether the open context page was opened from the board (so closing it
  // goes back in history) rather than loaded from a link.
  const contextFromBoard = useRef(false);
  const [theme, setTheme] = useTheme();
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The open card editor's close-and-save, set by CardEditor.
  const closeEditor = useRef<(() => void) | null>(null);
  const [maskSettings, setMaskSettings] = useMaskSettings();
  const mask = useMemo(() => makeMask(maskSettings), [maskSettings]);
  const { m } = mask;

  // initial load
  useEffect(() => {
    loadData().then((d) => {
      setData(d);
      setLoaded(true);
    });
    loadContextIndex().then(setContexts).catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => setContextRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function openContext(cardId: string) {
    contextFromBoard.current = true;
    location.hash = routeHash({ cardId });
  }

  function closeContext() {
    if (contextFromBoard.current) {
      contextFromBoard.current = false;
      history.back();
    } else {
      history.replaceState(null, "", location.pathname + location.search);
      setContextRoute(null);
    }
  }

  // Switching tabs replaces the URL, so Back still returns to the board.
  function setContextTab(tab: string) {
    if (!contextRoute) return;
    const next = { ...contextRoute, tab };
    history.replaceState(null, "", routeHash(next));
    setContextRoute(next);
  }

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
    es.addEventListener("agents", (e) => {
      setAgents(JSON.parse((e as MessageEvent).data) as AgentsStatus);
    });
    es.addEventListener("context", (e) => {
      const { ids } = JSON.parse((e as MessageEvent).data) as { ids: string[] };
      setContextTicks((t) => {
        const next = { ...t };
        for (const id of ids) next[id] = (next[id] ?? 0) + 1;
        return next;
      });
      loadContextIndex().then(setContexts).catch(() => {});
    });
    return () => es.close();
  }, [loaded]);

  // Shift+M toggles masked mode, unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "m" || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      setMaskSettings((s) => ({ ...s, enabled: !s.enabled }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMaskSettings]);

  // Cmd+K (Ctrl+K elsewhere) toggles search, even from a field in the card editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setShowSearch((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reopening the Deployments sidebar should always start actively polling.
  useEffect(() => {
    if (!showDeployments) setDeploymentsPaused(false);
  }, [showDeployments]);

  const cache = data.cache ?? { prs: {}, issues: {} };

  // Fetch live status for the PR and Linear links among `urls` into the cache.
  async function refreshUrls(urls: string[]) {
    const prUrls = urls.filter((u) => linkKind(u) === "pr");
    const linearUrls = urls.filter((u) => linkKind(u) === "linear");
    if (!prUrls.length && !linearUrls.length) return;
    const fresh = await refresh(prUrls, linearUrls);
    setData((d) => ({
      ...d,
      cache: {
        prs: { ...d.cache?.prs, ...fresh.prs },
        issues: { ...d.cache?.issues, ...fresh.issues },
      },
    }));
  }

  async function doRefresh() {
    // Skip archived cards; their cached status is left as-is.
    const urls = [
      ...new Set(
        data.cards.filter((c) => !c.hidden).flatMap((c) => c.links.map((l) => l.url)),
      ),
    ];
    if (!urls.some((u) => linkKind(u) !== "generic")) return;
    setRefreshing(true);
    try {
      await refreshUrls(urls);
      setLastRefresh(new Date().toLocaleTimeString());
    } finally {
      setRefreshing(false);
    }
  }

  // Save the fields edited in the editor onto the live card (or add `card` as
  // new), so anything else an agent changed while the editor was open, like
  // `needsYou` or a linked workspace, isn't undone by the save.
  function upsertCard(card: Card, changes: Partial<Card>) {
    setData((d) => {
      const live = d.cards.find((c) => c.id === card.id);
      if (live && !Object.keys(changes).length) return d;
      const next = stamp(live, { ...(live ?? card), ...changes, needsYou: live?.needsYou });
      return {
        ...d,
        cards: live
          ? d.cards.map((c) => (c.id === card.id ? next : c))
          : [...d.cards, next],
      };
    });
  }

  function clearNeedsYou(id: string) {
    setData((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === id ? editCard(c, { needsYou: undefined }) : c)),
    }));
  }

  function deleteCard(id: string) {
    setData((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
  }

  function toggleArchived(id: string) {
    setData((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === id ? editCard(c, { hidden: !c.hidden }) : c)),
    }));
  }

  // Rename a column in place, moving its cards (archived ones included) with it.
  function renameColumn(from: string, to: string) {
    setData((d) => ({
      ...d,
      columns: d.columns.map((c) => (c === from ? to : c)),
      cards: d.cards.map((c) => (c.column === from ? { ...c, column: to } : c)),
      needsYouColumns: d.needsYouColumns?.map((c) => (c === from ? to : c)),
      highlightedColumns: d.highlightedColumns?.map((c) => (c === from ? to : c)),
      focusColumns: d.focusColumns?.map((c) => (c === from ? to : c)),
      nextColumns: d.nextColumns && renameNextColumns(d.nextColumns, from, to),
    }));
  }

  function addColumn(name: string) {
    setData((d) => ({ ...d, columns: [...d.columns, name] }));
  }

  // Swap a column with its neighbor; `delta` is -1 to move it left, 1 to move it right.
  function moveColumn(name: string, delta: -1 | 1) {
    setData((d) => {
      const from = d.columns.indexOf(name);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= d.columns.length) return d;
      const columns = [...d.columns];
      [columns[from], columns[to]] = [columns[to], columns[from]];
      return { ...d, columns };
    });
  }

  // Only offered for empty columns, so no cards need to move.
  function deleteColumn(name: string) {
    setData((d) => ({
      ...d,
      columns: d.columns.filter((c) => c !== name),
      needsYouColumns: d.needsYouColumns?.filter((c) => c !== name),
      highlightedColumns: d.highlightedColumns?.filter((c) => c !== name),
      focusColumns: d.focusColumns?.filter((c) => c !== name),
      nextColumns: d.nextColumns && removeNextColumn(d.nextColumns, name),
    }));
  }

  // Set where the advance button sends cards from `column`: a column name, ""
  // for nowhere, or undefined to go back to the next column on the board.
  function setNextColumn(column: string, target: string | undefined) {
    setData((d) => {
      const map = { ...d.nextColumns };
      if (target === undefined) delete map[column];
      else map[column] = target;
      return { ...d, nextColumns: map };
    });
  }

  // Add or remove a column from a per-column setting list: the high-contrast
  // "Needs you" style, the board highlight, or the focus mode set.
  function setColumnFlag(
    key: "needsYouColumns" | "highlightedColumns" | "focusColumns",
    column: string,
    on: boolean,
  ) {
    setData((d) => {
      const rest = (d[key] ?? []).filter((c) => c !== column);
      return { ...d, [key]: on ? [...rest, column] : rest };
    });
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

  // Hide or unhide a repo (My work) or Vercel project (Deployments) by name,
  // matched case-insensitively.
  function setNameHidden(
    key: "hiddenRepos" | "hiddenVercelProjects",
    name: string,
    hide: boolean,
  ) {
    setData((d) => {
      const rest = (d[key] ?? []).filter((n) => n.toLowerCase() !== name.toLowerCase());
      return { ...d, [key]: hide ? [...rest, name] : rest };
    });
  }
  const setRepoHidden = (name: string, hide: boolean) =>
    setNameHidden("hiddenRepos", name, hide);
  const setProjectHidden = (name: string, hide: boolean) =>
    setNameHidden("hiddenVercelProjects", name, hide);

  // Move a card to a column, placing it after the column's current last card so
  // it lands at the bottom of that list rather than keeping its old array slot.
  // Dropping onto the Archived column archives the card (keeping its real
  // column); dropping onto a real column unarchives it.
  function moveCard(id: string, column: string) {
    setData((d) => {
      const idx = d.cards.findIndex((c) => c.id === id);
      if (idx === -1) return d;
      if (column === ARCHIVED_COL) {
        return {
          ...d,
          cards: d.cards.map((c) => (c.id === id && !c.hidden ? editCard(c, { hidden: true }) : c)),
        };
      }
      const card = d.cards[idx];
      const moved =
        card.column === column && !card.hidden ? card : editCard(card, { column, hidden: false });
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
      const card = d.cards[from];
      rest.splice(
        insertAt,
        0,
        card.column === target.column && card.hidden === target.hidden
          ? card
          : editCard(card, { column: target.column, hidden: target.hidden }),
      );
      return { ...d, cards: rest };
    });
  }

  // Quick-create a card from any pasted link, at the top of the Todo column,
  // and flash it. PRs and Linear items start with their resolved title and
  // pre-cached status; other links, or ones that can't be resolved, start
  // with a placeholder title like "Slack link" to rename later.
  async function quickCreate() {
    const text = quickLink.trim();
    if (!text || quickBusy) return;
    const url = toUrl(text);
    if (!url) {
      setQuickError("That doesn't look like a link.");
      return;
    }
    const column = quickAddColumn;
    if (!column) return;
    setQuickBusy(true);
    setQuickError(null);
    try {
      const result =
        linkKind(url) === "generic" ? null : await resolveLink(url).catch(() => null);
      const status = result && result.kind !== "unknown" ? result.status : undefined;
      const card = stamp(undefined, {
        id: crypto.randomUUID(),
        title: (!status?.error && status?.title) || linkTitle(url),
        column,
        hidden: false,
        links: [{ label: "", url }],
      });
      setData((d) => ({
        ...d,
        cards: insertAtColumnTop(d.cards, card),
        cache: {
          prs: { ...d.cache?.prs, ...(result?.kind === "pr" && { [url]: result.status }) },
          issues: {
            ...d.cache?.issues,
            ...(result?.kind === "linear" && { [url]: result.status }),
          },
        },
      }));
      flashCard(card.id);
      scrollToCard.current = card.id;
      setQuickLink("");
    } finally {
      setQuickBusy(false);
    }
  }

  // Add a card straight from an already-resolved inbox item, pre-caching its
  // status so its badges show without a refresh (mirrors quickCreate).
  function addPrCard(status: PrStatus) {
    const column = backlogColumn;
    if (!column) return;
    const card = stamp(undefined, {
      id: crypto.randomUUID(),
      title: status.title || status.url,
      column,
      hidden: false,
      links: [{ label: "", url: status.url }],
    });
    setData((d) => ({
      ...d,
      cards: insertAtColumnTop(d.cards, card),
      cache: {
        prs: { ...d.cache?.prs, [status.url]: status },
        issues: { ...d.cache?.issues },
      },
    }));
  }

  function addLinearCard(status: IssueStatus) {
    const column = backlogColumn;
    if (!column) return;
    const card = stamp(undefined, {
      id: crypto.randomUUID(),
      title: status.title || status.url,
      column,
      hidden: false,
      links: [{ label: "", url: status.url }],
    });
    setData((d) => ({
      ...d,
      cards: insertAtColumnTop(d.cards, card),
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
          : editCard(c, { links: [...c.links, { label: "", url: item.status.url }] });
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

  // Inbox target: the Backlog column, falling back to the first column.
  const backlogColumn = useMemo(
    () => data.columns.find((c) => BACKLOG_MATCH.test(c)) ?? data.columns[0],
    [data.columns],
  );
  // Quick-add target: the Todo column, falling back to the inbox's.
  const quickAddColumn = data.columns.find((c) => TODO_MATCH.test(c)) ?? backlogColumn;
  // The "Suggested by Claude" column, surfaced via its own toolbar popover, and
  // the remaining columns that render on the board.
  const claudeColumn = useMemo(
    () => data.columns.find((c) => CLAUDE_MATCH.test(c)),
    [data.columns],
  );
  const boardColumns = useMemo(
    () => data.columns.filter((c) => !CLAUDE_MATCH.test(c)),
    [data.columns],
  );
  // Focus mode shows only the focus columns still on the board, in board order.
  const focusColumns = useMemo(
    () => boardColumns.filter((c) => data.focusColumns?.includes(c)),
    [boardColumns, data.focusColumns],
  );
  const focused = focusMode && focusColumns.length > 0;
  const visibleColumns = focused ? focusColumns : boardColumns;

  // Repos seen on the board or in the status cache, suggested when hiding a repo.
  const knownRepos = useMemo(() => {
    const urls = [
      ...data.cards.flatMap((c) => c.links.map((l) => l.url)),
      ...Object.keys(data.cache?.prs ?? {}),
    ];
    const repos = new Map<string, string>();
    for (const u of urls) {
      const ref = parsePrUrl(u);
      if (ref) {
        const slug = `${ref.owner}/${ref.repo}`;
        repos.set(slug.toLowerCase(), slug);
      }
    }
    return [...repos.values()].sort((a, b) => a.localeCompare(b));
  }, [data.cards, data.cache]);

  // Cards per column, archived ones included, for the Settings page.
  const columnCardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of data.cards) counts[c.column] = (counts[c.column] ?? 0) + 1;
    return counts;
  }, [data.cards]);

  const cardsByColumn = useMemo(() => {
    const map: Record<string, Card[]> = {};
    for (const col of data.columns) map[col] = [];
    for (const c of data.cards) {
      if (c.hidden) continue;
      (map[c.column] ??= []).push(c);
    }
    return map;
  }, [data]);

  // Most recently archived first, then the rest in board order.
  const archivedCards = useMemo(
    () => data.cards.filter((c) => c.hidden).sort(byArchivedAt),
    [data],
  );
  const archivedCount = archivedCards.length;
  const claudeCount = claudeColumn
    ? cardsByColumn[claudeColumn]?.length ?? 0
    : 0;

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

  function flashCard(id: string) {
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2400);
  }

  // A card just added, to scroll into view once it has rendered.
  const scrollToCard = useRef<string | null>(null);
  useEffect(() => {
    const id = scrollToCard.current;
    if (!id || !cardRefs.current[id]) return;
    scrollToCard.current = null;
    cardRefs.current[id]!.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // Briefly highlight a card (and scroll it into view), showing the Archived
  // column if it's archived.
  function highlightCard(id: string) {
    const card = data.cards.find((c) => c.id === id);
    if (!card) return;
    if (card.hidden) setShowArchived(true);
    if (focused && (card.hidden || !focusColumns.includes(card.column))) setFocusMode(false);
    flashCard(id);
    requestAnimationFrame(() =>
      cardRefs.current[id]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }),
    );
  }

  // Whether a card's "Needs you" message is shown high-contrast: only in the
  // columns picked in Settings, and never while the card is archived.
  const isLoud = (card: Card) =>
    !card.hidden && !!data.needsYouColumns?.includes(card.column);

  const renderCard = (card: Card) => {
    // Group the flat link list by kind for display: Linear lines, then PR lines
    // (merged sorted to the bottom), then misc links. Linear items' resources
    // (Notion specs, Figma designs) join the misc links, deduped by URL.
    const linearUrls = card.links
      .map((l) => l.url)
      .filter((u) => linkKind(u) === "linear");
    const prUrls = card.links
      .map((l) => l.url)
      .filter((u) => linkKind(u) === "pr")
      .sort(
        (a, b) =>
          (cache.prs[a]?.state === "MERGED" ? 1 : 0) -
          (cache.prs[b]?.state === "MERGED" ? 1 : 0),
      );
    const seenUrls = new Set<string>();
    const otherLinks: { url: string; label: string; type?: LinearResource["type"] }[] = [];
    for (const l of card.links) {
      if (linkKind(l.url) !== "generic" || seenUrls.has(l.url)) continue;
      seenUrls.add(l.url);
      otherLinks.push({
        url: l.url,
        label: l.label?.trim() ? m("linkLabels", l.label.trim()) : domainName(l.url),
      });
    }
    for (const u of linearUrls) {
      for (const r of cache.issues[u]?.resources ?? []) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        otherLinks.push({
          url: r.url,
          label: r.title?.trim() ? m("linearResources", resourceLabel(r)) : resourceLabel(r),
          type: r.type ?? "link",
        });
      }
    }
    const tag = card.color ? data.colorTags?.[card.color] : undefined;
    const loud = !!card.needsYou && isLoud(card);

    return (
    <div
      key={card.id}
      ref={(el) => {
        cardRefs.current[card.id] = el;
      }}
      className={`card${dragItem ? " link-target" : ""}${
        dragOverId === card.id ? " drop-before" : ""
      }${highlightId === card.id ? " highlight" : ""}`}
      style={
        card.color
          ? ({ borderLeftColor: card.color, "--card-color": card.color } as CSSProperties)
          : undefined
      }
      // Clicking anywhere on the card opens it, except links and buttons, which
      // keep their own behavior.
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("a, button, input, select, textarea, [role=button]")) return;
        setEditing(card);
      }}
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
          {m("cardTitles", card.title) || "(untitled)"}
        </span>
        <div className="card-actions">
          <button
            onClick={() => copyCardId(card.id)}
            title={copiedId === card.id ? "Copied ID" : "Copy card ID"}
          >
            {copiedId === card.id ? <CheckIcon size={15} /> : <IdCardIcon size={15} />}
          </button>
          <button onClick={() => toggleArchived(card.id)} title={card.hidden ? "Unarchive" : "Archive"}>
            {card.hidden ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
          </button>
        </div>
      </div>

      {card.needsYou && (
        <NeedsYouBanner
          value={card.needsYou}
          loud={loud}
          onCheck={() => clearNeedsYou(card.id)}
        />
      )}

      {card.notes && <div className="card-notes">{m("cardNotes", card.notes)}</div>}

      {linearUrls.length + prUrls.length > 0 && (
        <div className="status-lines">
          {linearUrls.map((u) => (
            <IssueLine key={u} url={u} status={cache.issues[u]} />
          ))}
          {prUrls.map((u) => (
            <PrLine key={u} url={u} status={cache.prs[u]} repoNames={data.repoNames} />
          ))}
        </div>
      )}

      {otherLinks.length > 0 && (
        <div className="card-links">
          {otherLinks.map((l, i) => (
            <CardLink key={i} url={l.url} label={l.label} type={l.type} />
          ))}
        </div>
      )}

      {(tag ||
        card.complexity ||
        card.dueDate ||
        !!card.workspaces?.length ||
        !!card.threads?.length ||
        contexts[card.id]) && (
        <div className="card-foot">
          {tag && (
            <span className="card-tag" style={{ "--card-color": card.color } as CSSProperties}>
              {m("colorLabels", tag)}
            </span>
          )}
          {card.complexity && <ComplexityBars value={card.complexity} color={card.color} />}
          {card.dueDate && (
            <DueBadge date={card.dueDate} thresholds={data.dueThresholds} muted={card.hidden} />
          )}
          <span className="spacer" />
          {card.workspaces?.map((id) => (
            <WorkspaceTag key={id} id={id} status={agents.workspaces[id]} />
          ))}
          {card.threads?.map((id) => (
            <ThreadBadge key={id} id={id} status={agents.threads?.[id]} compact />
          ))}
          {contexts[card.id] && (
            <button
              className="card-context"
              onClick={() => openContext(card.id)}
              title="Open project context"
              aria-label="Open project context"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
                <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
    );
  };

  return (
    <MaskContext.Provider value={mask}>
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
            <path fillRule="evenodd" d="M3.3 15.5 C3.6 14.3 4.0 13.8 4.9 13.5 C7.9 12.1 11.1 11.1 14.3 10.8 C15.7 8.1 18.2 6.4 21.1 6.6 C24.7 6.9 27.7 9.9 28.0 13.7 C28.3 16.9 27.3 19.7 25.5 21.9 C23.6 23.9 20.9 25.2 18.3 25.0 C16.1 24.8 14.5 23.5 14.2 21.4 C14.1 20.0 14.1 18.8 14.2 18.3 C10.7 17.5 7.1 16.6 3.3 15.5 Z M17.9 9.45 a2.05 2.05 0 1 0 0 4.1 a2.05 2.05 0 1 0 0 -4.1 Z" />
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
            placeholder="Paste any link…"
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
          className={`btn${showSearch ? " active" : ""}`}
          onClick={() => setShowSearch(true)}
          title="Search (⌘K)"
          aria-label="Search"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        {/* With no focus columns picked yet, opens Settings to pick some. */}
        <button
          className={`btn${focused ? " active" : ""}`}
          onClick={() => {
            if (focusColumns.length) setFocusMode(!focused);
            else setShowSettings(true);
          }}
          title={
            focused
              ? "Show all columns"
              : focusColumns.length
                ? "Focus columns picked in Settings"
                : "Pick columns to focus in Settings"
          }
          aria-label={focused ? "Show all columns" : "Focus columns"}
          aria-pressed={focused}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <line x1="12" y1="1" x2="12" y2="7" />
            <line x1="12" y1="17" x2="12" y2="23" />
            <line x1="1" y1="12" x2="7" y2="12" />
            <line x1="17" y1="12" x2="23" y2="12" />
          </svg>
        </button>
        {claudeColumn && (
          <button
            className={`btn claude-btn${showClaude ? " active" : ""}${
              claudeCount > 0 ? " has-items" : ""
            }`}
            onClick={() => setShowClaude((v) => !v)}
            title={m("columnNames", claudeColumn)}
          >
            <ClaudeLogo />
            Suggested
            {claudeCount > 0 && (
              <span className="claude-count">{claudeCount}</span>
            )}
          </button>
        )}
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
        <button
          className={`btn${showSettings ? " active" : ""}`}
          onClick={() => setShowSettings((v) => !v)}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
      </header>

      <div className="app-body">
      {showClaude && claudeColumn && (
        <aside
          className={`sidebar claude-sidebar${dragId ? " droppable" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId) moveCard(dragId, claudeColumn);
            setDragId(null);
            setDragOverId(null);
          }}
        >
          <div className="sidebar-head">
            <h2>
              {m("columnNames", claudeColumn)} <span className="count">{claudeCount}</span>
            </h2>
            <button
              className="btn ghost"
              onClick={() => newCard(claudeColumn)}
              title="Add card"
            >
              +
            </button>
            <button
              className="btn ghost"
              onClick={() => setShowClaude(false)}
              title="Close"
            >
              ✕
            </button>
          </div>
          <div className="cards">
            {(cardsByColumn[claudeColumn] ?? []).map(renderCard)}
          </div>
        </aside>
      )}
      <div className="board">
        {visibleColumns.map((col) => {
          const column = (
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
                <span>{m("columnNames", col)}</span>
                <span className="count">{cardsByColumn[col]?.length ?? 0}</span>
                <button className="add" onClick={() => newCard(col)} title="Add card">
                  +
                </button>
              </div>
              <div className="cards">
                {(cardsByColumn[col] ?? []).map(renderCard)}
              </div>
            </div>
          );
          // A highlighted column sits in a full-height lane behind it.
          return data.highlightedColumns?.includes(col) ? (
            <div key={col} className="column-lane">
              {column}
            </div>
          ) : (
            column
          );
        })}

        {!focused && (
          <div
            className={`column archived-column${dragId ? " droppable" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) moveCard(dragId, ARCHIVED_COL);
              setDragId(null);
              setDragOverId(null);
            }}
          >
            <div className="column-head">
              <span>Archived</span>
              <span className="count">{archivedCount}</span>
              <button
                className="toggle-archived"
                onClick={() => setShowArchived((v) => !v)}
                title={showArchived ? "Hide items" : "Show items"}
              >
                {showArchived ? "Hide" : "Show"}
              </button>
            </div>
            {showArchived && (
              <div className="cards">{archivedCards.map(renderCard)}</div>
            )}
          </div>
        )}
      </div>

      {(showInbox || showDeployments) && (
        <div className="sidebar-stack">
          {showInbox && (
            <Inbox
              targetColumn={backlogColumn}
              repoNames={data.repoNames}
              hiddenRepos={data.hiddenRepos}
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
              hiddenProjects={data.hiddenVercelProjects}
              onSetProjectHidden={setProjectHidden}
              findCardForDeployment={findCardForDeployment}
              onLinkCard={highlightCard}
              onClose={() => setShowDeployments(false)}
            />
          )}
        </div>
      )}

      {showSettings && (
        <Settings
          columns={data.columns}
          cardCounts={columnCardCounts}
          onRenameColumn={renameColumn}
          onAddColumn={addColumn}
          onDeleteColumn={deleteColumn}
          onMoveColumn={moveColumn}
          needsYouColumns={data.needsYouColumns ?? []}
          onSetNeedsYouColumn={(col, on) => setColumnFlag("needsYouColumns", col, on)}
          highlightedColumns={data.highlightedColumns ?? []}
          onSetHighlightedColumn={(col, on) => setColumnFlag("highlightedColumns", col, on)}
          focusColumns={data.focusColumns ?? []}
          onSetFocusColumn={(col, on) => setColumnFlag("focusColumns", col, on)}
          nextColumns={data.nextColumns ?? {}}
          onSetNextColumn={setNextColumn}
          dueThresholds={data.dueThresholds}
          onSetDueThresholds={(t) => setData((d) => ({ ...d, dueThresholds: t }))}
          hiddenRepos={data.hiddenRepos ?? []}
          knownRepos={knownRepos}
          onSetRepoHidden={setRepoHidden}
          hiddenVercelProjects={data.hiddenVercelProjects ?? []}
          onSetProjectHidden={setProjectHidden}
          colorTags={data.colorTags ?? {}}
          onSetColorTag={setColorTag}
          maskSettings={maskSettings}
          onSetMaskSettings={setMaskSettings}
          theme={theme}
          onSetTheme={setTheme}
          onExport={exportJson}
          onImport={importJson}
          onClose={() => setShowSettings(false)}
        />
      )}
      </div>

      {contextRoute && (
        <ContextPage
          key={contextRoute.cardId}
          cardId={contextRoute.cardId}
          card={data.cards.find((c) => c.id === contextRoute.cardId)}
          tab={contextRoute.tab}
          onTab={setContextTab}
          onClose={closeContext}
          onEditCard={() => {
            const card = data.cards.find((c) => c.id === contextRoute.cardId);
            if (card) setEditing(card);
          }}
          tick={contextTicks[contextRoute.cardId] ?? 0}
          active={!editing && !showSearch}
          agents={agents}
          cache={cache}
          repoNames={data.repoNames}
          colorTags={data.colorTags}
          isLoud={isLoud}
        />
      )}

      {editing && (
        <CardEditor
          // Remount when search swaps in another card, so the draft resets.
          key={editing.id}
          card={editing}
          columns={data.columns}
          nextColumnFor={(col) => nextColumn(data.columns, col, data.nextColumns)}
          colorTags={data.colorTags ?? {}}
          cache={cache}
          repoNames={data.repoNames}
          onRefreshLinks={(urls) => refreshUrls(urls).catch(() => {})}
          agents={agents}
          needsYou={data.cards.find((c) => c.id === editing.id)?.needsYou}
          needsYouLoud={isLoud(editing)}
          // A card not yet on the board (a new one) can't have context.
          hasContext={!!contexts[editing.id]}
          onOpenContext={
            data.cards.some((c) => c.id === editing.id)
              ? () => {
                  if (contextRoute?.cardId !== editing.id) openContext(editing.id);
                }
              : undefined
          }
          canArchive={data.cards.some((c) => c.id === editing.id)}
          onClearNeedsYou={() => clearNeedsYou(editing.id)}
          onCancel={() => setEditing(null)}
          closeRef={closeEditor}
          onSave={(changes) => {
            upsertCard(editing, changes);
            setEditing(null);
          }}
          onDelete={() => {
            deleteCard(editing.id);
            setEditing(null);
          }}
        />
      )}

      {showSearch && (
        <Search
          cards={data.cards}
          columns={data.columns}
          cache={cache}
          // Opening a card replaces any card already open in the editor,
          // saving its edits first (same as closing it with Escape).
          onOpen={(card) => {
            setShowSearch(false);
            if (card.id === editing?.id) return;
            closeEditor.current?.();
            setEditing(card);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
    </MaskContext.Provider>
  );
}
