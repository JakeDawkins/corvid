import type { Cache, Data } from "./types";

export async function loadData(): Promise<Data> {
  const res = await fetch("/api/data");
  const data = (await res.json()) as Data;
  data.cache ??= { prs: {}, issues: {} };
  data.cache.prs ??= {};
  data.cache.issues ??= {};
  return data;
}

export async function saveData(data: Data): Promise<void> {
  await fetch("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
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
