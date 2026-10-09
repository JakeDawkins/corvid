import { useLayoutEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Context tabs are Markdown written by agents and by hand. They render as
// GitHub-flavored Markdown, sanitized, with three additions: ```mermaid blocks
// become diagrams, status words in table cells become colored chips, and
// headings get ids for the section index.

// HTML comments hold the outline's guidance, so they never render.
export function stripComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, "");
}

// DOMPurify's default URI rule, plus conductor:// (workspace links) and slack://.
const ALLOWED_URI =
  /^(?:(?:https?|mailto|tel|conductor|slack):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: ALLOWED_URI });
}

export function renderMarkdown(md: string): string {
  return sanitize(marked.parse(stripComments(md), { async: false, gfm: true }) as string);
}

export function renderInline(md: string): string {
  return sanitize(marked.parseInline(md, { async: false, gfm: true }) as string);
}

// Chip color for a status word in a table cell: QA checks, delivery state,
// decision and monitoring status. Anything else stays plain text.
const STATUS_CLASS: Record<string, string> = {
  pass: "ok",
  passed: "ok",
  done: "ok",
  fixed: "ok",
  settled: "ok",
  active: "ok",
  complete: "ok",
  fail: "bad",
  failed: "bad",
  blocked: "bad",
  "not done": "bad",
  partial: "run",
  "partial or mock": "run",
  "in progress": "run",
  open: "run",
  proposed: "run",
  planned: "run",
  "worked around": "run",
  "not run": "muted",
  "not started": "muted",
  skipped: "muted",
  deferred: "muted",
  reversed: "muted",
  stopped: "muted",
};

export function statusClass(text: string): string | undefined {
  return STATUS_CLASS[text.trim().replace(/\.$/, "").toLowerCase()];
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

// Counts of each QA status in tables that have a Status column, e.g. the QA
// plan's checklist. Run logs ("Result") and issues ("State") don't count.
export function countStatuses(md: string, statuses: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const want = new Map(statuses.map((s) => [s.toLowerCase(), s]));
  for (const t of marked.lexer(stripComments(md))) {
    if (t.type !== "table") continue;
    const col = (t.header as { text: string }[]).findIndex((h) => h.text.trim().toLowerCase() === "status");
    if (col === -1) continue;
    for (const row of t.rows as { text: string }[][]) {
      const s = want.get((row[col]?.text ?? "").replace(/[*_`]/g, "").trim().toLowerCase());
      if (s) counts[s] = (counts[s] ?? 0) + 1;
    }
  }
  return counts;
}

let mermaidId = 0;

async function renderMermaid(pre: HTMLElement, code: string) {
  const box = document.createElement("div");
  box.className = "mermaid-diagram";
  pre.replaceWith(box);
  try {
    const { default: mermaid } = await import("mermaid");
    const light = document.documentElement.dataset.theme === "light";
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: light ? "default" : "dark" });
    const { svg, bindFunctions } = await mermaid.render(`mermaid-${++mermaidId}`, code);
    box.innerHTML = svg;
    bindFunctions?.(box);
  } catch (e) {
    box.className = "mermaid-error";
    box.textContent = `Diagram error: ${e instanceof Error ? e.message : String(e)}\n\n${code}`;
  }
}

export type Heading = { id: string; text: string; level: number };

export function Markdown({
  text,
  className = "",
  onHeadings,
}: {
  text: string;
  className?: string;
  // Receives the rendered h2 and h3 headings, with the ids given to them.
  onHeadings?: (headings: Heading[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(text), [text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const a of el.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (/^https?:/i.test(a.getAttribute("href") ?? "")) {
        a.target = "_blank";
        a.rel = "noreferrer";
      }
    }
    for (const td of el.querySelectorAll("td")) {
      if (td.querySelector(".status-chip")) continue;
      const cls = statusClass(td.textContent ?? "");
      if (!cls) continue;
      const chip = document.createElement("span");
      chip.className = `status-chip ${cls}`;
      chip.append(...td.childNodes);
      td.append(chip);
    }
    for (const code of el.querySelectorAll<HTMLElement>("pre > code.language-mermaid")) {
      void renderMermaid(code.parentElement!, code.textContent ?? "");
    }
    const used = new Set<string>();
    const headings: Heading[] = [];
    for (const h of el.querySelectorAll<HTMLElement>("h2, h3")) {
      let id = `s-${slug(h.textContent ?? "")}`;
      for (let n = 2; used.has(id); n++) id = `s-${slug(h.textContent ?? "")}-${n}`;
      used.add(id);
      h.id = id;
      headings.push({ id, text: h.textContent ?? "", level: h.tagName === "H2" ? 2 : 3 });
    }
    onHeadings?.(headings);
  }, [html]);

  return <div ref={ref} className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
