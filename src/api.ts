import type {
  Cache,
  CardContext,
  ConductorRepo,
  ContextIndex,
  ContextProject,
  ContextType,
  Data,
  Inbox,
  IssueStatus,
  PrStatus,
  VercelDeployment,
  VercelProject,
} from "./types";
import { normalizeCard } from "./links";

export type ResolvedLink =
  | { kind: "pr"; status: PrStatus }
  | { kind: "linear"; status: IssueStatus }
  | { kind: "unknown"; error: string };

export async function resolveLink(url: string): Promise<ResolvedLink> {
  const res = await fetch("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return (await res.json()) as ResolvedLink;
}

export async function loadData(): Promise<Data> {
  const res = await fetch("/api/data");
  const data = (await res.json()) as Data;
  data.cache ??= { prs: {}, issues: {} };
  data.cache.prs ??= {};
  data.cache.issues ??= {};
  data.cards = data.cards.map(normalizeCard);
  return data;
}

export async function saveData(data: Data): Promise<void> {
  await fetch("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function loadInbox(): Promise<Inbox> {
  const res = await fetch("/api/inbox");
  const inbox = (await res.json()) as Inbox;
  inbox.prs ??= [];
  inbox.issues ??= [];
  inbox.projects ??= [];
  return inbox;
}

export async function loadVercelProjects(): Promise<{
  projects: VercelProject[];
  error?: string;
}> {
  const res = await fetch("/api/vercel/projects");
  const data = (await res.json()) as {
    projects?: VercelProject[];
    error?: string;
  };
  return { projects: data.projects ?? [], error: data.error };
}

export async function loadVercelDeployments(
  projects: { id: string; teamId?: string }[],
): Promise<{ deployments: Record<string, VercelDeployment[]>; error?: string }> {
  const res = await fetch("/api/vercel/deployments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projects }),
  });
  const data = (await res.json()) as {
    deployments?: Record<string, VercelDeployment[]>;
    error?: string;
  };
  return { deployments: data.deployments ?? {}, error: data.error };
}

export async function loadConductorRepos(): Promise<{
  repos: ConductorRepo[];
  error?: string;
  notRunning?: boolean;
}> {
  const res = await fetch("/api/conductor/repos");
  const data = (await res.json()) as {
    repos?: ConductorRepo[];
    error?: string;
    notRunning?: boolean;
  };
  return { repos: data.repos ?? [], error: data.error, notRunning: data.notRunning };
}

export async function refresh(
  prUrls: string[],
  linearUrls: string[],
): Promise<Cache> {
  const res = await fetch("/api/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prUrls, linearUrls }),
  });
  return (await res.json()) as Cache;
}

export async function loadContextIndex(): Promise<ContextIndex> {
  const res = await fetch("/api/context");
  return ((await res.json()) as { contexts?: ContextIndex }).contexts ?? {};
}

export async function loadContext(cardId: string): Promise<CardContext | null> {
  const res = await fetch(`/api/context/${encodeURIComponent(cardId)}`);
  return ((await res.json()) as { context?: CardContext | null }).context ?? null;
}

// Result of a context write: the context as it now is on disk, and an error
// if the write was refused. `conflict` means the tab changed on disk since the
// editor loaded it.
export type ContextResult = {
  context: CardContext | null;
  error?: string;
  conflict?: boolean;
};

async function contextRequest(method: string, path: string, body: unknown): Promise<ContextResult> {
  const res = await fetch(`/api/context/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ContextResult;
}

export function createContext(cardId: string, type: ContextType): Promise<ContextResult> {
  return contextRequest("POST", encodeURIComponent(cardId), { type });
}

export function saveContextProject(
  cardId: string,
  fields: Partial<ContextProject>,
): Promise<ContextResult> {
  return contextRequest("PUT", `${encodeURIComponent(cardId)}/project`, fields);
}

export function saveContextTab(
  cardId: string,
  tab: string,
  content: string,
  baseHash: string,
): Promise<ContextResult> {
  return contextRequest("PUT", `${encodeURIComponent(cardId)}/tabs/${encodeURIComponent(tab)}`, {
    content,
    baseHash,
  });
}
