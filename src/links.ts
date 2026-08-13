// Normalize a Linear URL to a stable identity so the same issue/project matches
// regardless of URL slug, trailing slash, or query params. Mirrors the server's
// parseLinearUrl. Falls back to the trimmed URL if it isn't a recognized shape.
export function linearKey(url: string): string {
  const s = String(url);
  const issue = s.match(/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+)-(\d+)/i);
  if (issue) return `issue:${issue[1].toUpperCase()}-${Number(issue[2])}`;
  const project = s.match(
    /linear\.app\/[^/]+\/project\/[^/]*?-([0-9a-f]{8,})(?:\/|\?|$)/i,
  );
  if (project) return `project:${project[1].toLowerCase()}`;
  return s.trim();
}
