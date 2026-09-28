import { useCallback, useEffect, useRef, useState } from "react";
import type { VercelDeployment, VercelProject } from "./types";
import { loadVercelDeployments, loadVercelProjects } from "./api";
import { hasName } from "./links";

const REFRESH_MS = 15000;
// Stop polling after this long without a manual resume, so a forgotten-open
// sidebar doesn't hammer the API indefinitely.
const AUTO_PAUSE_MS = 4 * 60 * 60 * 1000; // 4 hours
// Hidden projects used to live in localStorage as project ids. They now live in
// data.hiddenVercelProjects (by name); this key is only read once to migrate.
const LEGACY_HIDDEN_KEY = "vercel_hidden_projects_v1";

function takeLegacyHidden(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_HIDDEN_KEY);
    localStorage.removeItem(LEGACY_HIDDEN_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Map a Vercel readyState to one of the shared badge tones.
function stateClass(s: string): string {
  if (s === "READY") return "ok";
  if (s === "ERROR") return "bad";
  if (s === "CANCELED") return "muted";
  return "run"; // BUILDING | QUEUED | INITIALIZING | BUILDING…
}

// A right-side sidebar listing recent Vercel deployments per project, with
// per-project hide toggles (unhide from Settings). Opens alongside the "My work" sidebar. Polls
// every 15s while active; pausable, and auto-pauses after 4h.
export function Deployments({
  paused,
  onPausedChange,
  hiddenProjects,
  onSetProjectHidden,
  findCardForDeployment,
  onLinkCard,
  onClose,
}: {
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  // Project names from data.hiddenVercelProjects. Stored as a hidden list (not
  // a shown list) so newly-appearing projects default to shown.
  hiddenProjects?: string[];
  onSetProjectHidden: (name: string, hidden: boolean) => void;
  findCardForDeployment: (dep: VercelDeployment) => string | null;
  onLinkCard: (cardId: string) => void;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<VercelProject[]>([]);
  const [deployments, setDeployments] = useState<
    Record<string, VercelDeployment[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const projectsRef = useRef<VercelProject[]>([]);
  projectsRef.current = projects;
  const hiddenRef = useRef(hiddenProjects);
  hiddenRef.current = hiddenProjects;

  const refresh = useCallback(async () => {
    // Hidden projects are left out entirely, so don't fetch their deployments.
    const ps = projectsRef.current.filter((p) => !hasName(hiddenRef.current, p.name));
    if (ps.length === 0) return;
    setRefreshing(true);
    try {
      const { deployments, error } = await loadVercelDeployments(
        ps.map((p) => ({ id: p.id, teamId: p.teamId })),
      );
      setDeployments(deployments);
      setError(error);
      setLastUpdated(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Initial load: projects, then their deployments.
  useEffect(() => {
    loadVercelProjects()
      .then(async ({ projects, error }) => {
        setProjects(projects);
        projectsRef.current = projects;
        if (error) setError(error);
        // Only migrate once projects loaded, since ids map to names through them.
        if (projects.length) {
          for (const id of takeLegacyHidden()) {
            const p = projects.find((p) => p.id === id);
            if (p) onSetProjectHidden(p.name, true);
          }
        }
        await refresh();
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  // Poll on an interval while active. A manual refresh works even when paused.
  useEffect(() => {
    if (paused) return;
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh, paused]);

  // Auto-pause after 4h of continuous polling; resuming resets the clock.
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => onPausedChange(true), AUTO_PAUSE_MS);
    return () => clearTimeout(id);
  }, [paused, onPausedChange]);

  // Refresh immediately when resumed so stale data updates without waiting.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!paused) refresh();
  }, [paused, refresh]);

  const visible = projects.filter((p) => !hasName(hiddenProjects, p.name));

  return (
    <aside className={`sidebar${paused ? " paused" : ""}`}>
      <div className="sidebar-head">
        <h2>Deployments</h2>
        <span className="hint" style={{ marginRight: 8 }}>
          {paused
            ? "paused"
            : lastUpdated
              ? refreshing
                ? "…"
                : timeAgo(lastUpdated)
              : ""}
        </span>
        <button
          className="btn ghost"
          onClick={() => onPausedChange(!paused)}
          title={paused ? "Resume polling" : "Pause polling"}
        >
          {paused ? "▶" : "⏸"}
        </button>
        <button
          className="btn ghost"
          onClick={refresh}
          title="Refresh now"
          disabled={refreshing}
        >
          ↻
        </button>
        <button className="btn ghost" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {loading ? (
        <p className="hint sidebar-hint">Loading…</p>
      ) : (
        <>
          {error && <p className="hint error sidebar-hint">{error}</p>}
          {paused && (
            <p className="hint sidebar-hint">
              Paused — not auto-refreshing. Press ▶ to resume.
            </p>
          )}
          {/* Hidden projects get no pill; they can only be shown again from Settings. */}
          {visible.length > 0 && (
            <div className="dep-toggles">
              {visible.map((p) => (
                <button
                  key={p.id}
                  className="pill active"
                  onClick={() => onSetProjectHidden(p.name, true)}
                  title="Hide (show it again from Settings)"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <div className="sidebar-body">
            {projects.length === 0 && !error && (
              <p className="hint">No Vercel projects.</p>
            )}
            {projects.length > 0 && visible.length === 0 && (
              <p className="hint">All projects are hidden. Show them from Settings.</p>
            )}
            {visible.map((p) => {
              const deps = deployments[p.id] ?? [];
              return (
                <section className="inbox-section" key={p.id}>
                  <h3>
                    {p.name} <span className="count">{deps.length}</span>
                  </h3>
                  {deps.length === 0 ? (
                    <p className="hint">No deployments.</p>
                  ) : (
                    deps.map((d) => {
                      const cardId = findCardForDeployment(d);
                      return (
                        <div className="dep-row" key={d.uid}>
                          <span className={`badge ${stateClass(d.readyState)}`}>
                            {d.readyState}
                          </span>
                          {cardId && (
                            <button
                              className={`dep-link ${stateClass(d.readyState)}`}
                              title="Highlight the linked card on the board"
                              onClick={() => onLinkCard(cardId)}
                            >
                              ◎ card
                            </button>
                          )}
                          <a
                            href={d.inspectorUrl ?? `https://${d.url}`}
                            target="_blank"
                            rel="noreferrer"
                            className="dep-ref"
                            title={d.url}
                          >
                            {d.target === "production"
                              ? "production"
                              : d.branch ?? d.target ?? d.url}
                          </a>
                          <span className="hint dep-time">
                            {timeAgo(d.createdAt)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
