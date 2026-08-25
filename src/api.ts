import type {
  Cache,
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
