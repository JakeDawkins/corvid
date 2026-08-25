import { useCallback, useEffect, useRef, useState } from "react";
import type { VercelDeployment, VercelProject } from "./types";
import { loadVercelDeployments, loadVercelProjects } from "./api";

const REFRESH_MS = 15000;
// Which projects are hidden, persisted so toggles survive reloads. We store the
// hidden set (not the shown set) so newly-appearing projects default to shown.
const HIDDEN_KEY = "vercel_hidden_projects_v1";

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
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
// per-project show/hide toggles. Opens alongside the "My work" sidebar.
export function Deployments({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<VercelProject[]>([]);
  const [deployments, setDeployments] = useState<
    Record<string, VercelDeployment[]>
  >({});
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const projectsRef = useRef<VercelProject[]>([]);
  projectsRef.current = projects;

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch {
      // ignore storage failures
    }
  }, [hidden]);

  const refresh = useCallback(async () => {
    const ps = projectsRef.current;
    if (ps.length === 0) return;
    setRefreshing(true);
    try {
      const { deployments, error } = await loadVercelDeployments(
        ps.map((p) => ({ id: p.id, teamId: p.teamId })),
      );
      setDeployments(deployments);
      if (error) setError(error);
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
        await refresh();
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  // Auto-refresh on an interval.
  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = projects.filter((p) => !hidden.has(p.id));

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h2>Deployments</h2>
        {lastUpdated && (
          <span className="hint" style={{ marginRight: 8 }}>
            {refreshing ? "…" : timeAgo(lastUpdated)}
          </span>
        )}
        <button
          className="btn ghost"
          onClick={refresh}
          title="Refresh"
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
          {projects.length > 0 && (
            <div className="dep-toggles">
              {projects.map((p) => {
                const on = !hidden.has(p.id);
                return (
                  <button
                    key={p.id}
                    className={`pill${on ? " active" : ""}`}
                    onClick={() => toggle(p.id)}
                    title={on ? "Hide" : "Show"}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="sidebar-body">
            {projects.length === 0 && !error && (
              <p className="hint">No Vercel projects.</p>
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
                    deps.map((d) => (
                      <div className="dep-row" key={d.uid}>
                        <span className={`badge ${stateClass(d.readyState)}`}>
                          {d.readyState}
                        </span>
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
                    ))
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
