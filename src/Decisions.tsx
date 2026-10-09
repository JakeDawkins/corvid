import { useState } from "react";
import { Markdown, renderInline, statusClass, stripComments } from "./Markdown";

// The Decisions tab is Markdown with one block per decision:
//
//   ### D01: Use a signed one-time link
//   - Status: Settled
//   - Date: 2026-10-02
//   - Owner: Jordan
//   - Context: ...
//
// The page shows each block as an expandable card, grouped by status. Text
// before the first decision shows above the cards.

export type Decision = {
  id?: string;
  title: string;
  // Field values by lowercased name ("status", "decision", ...).
  fields: Record<string, string>;
  // Field names as written, in order.
  order: string[];
  // Anything in the block that isn't a field.
  extra: string;
};

const HEADING_RE = /^(#{2,4})\s+(.*)$/;
const ID_RE = /^(D[\w.-]*\d[\w.-]*)\s*[:.–—-]\s*(.*)$/;
const FIELD_RE = /^[-*]\s+(?:\*\*|__)?([A-Za-z][A-Za-z /]{0,30}?)(?:\*\*|__)?:(?:\*\*|__)?\s*(.*)$/;

export function parseDecisions(md: string): { intro: string; decisions: Decision[] } {
  const intro: string[] = [];
  const decisions: Decision[] = [];
  let cur: Decision | null = null;
  let extra: string[] = [];
  let lastField: string | null = null;
  const finish = () => {
    if (cur) {
      cur.extra = extra.join("\n").trim();
      decisions.push(cur);
    }
  };
  for (const line of stripComments(md).split("\n")) {
    const h = line.match(HEADING_RE);
    const id = h?.[2].trim().match(ID_RE);
    // A decision starts at a "### ..." heading, or any heading that starts
    // with an id like D01. Other headings before the first one are intro.
    if (h && (h[1] === "###" || id)) {
      finish();
      cur = { id: id?.[1], title: (id ? id[2] : h[2]).trim(), fields: {}, order: [], extra: "" };
      extra = [];
      lastField = null;
      continue;
    }
    if (!cur) {
      intro.push(line);
      continue;
    }
    // Group headings between decisions ("## Settled") are dropped: the page
    // groups by status itself.
    if (h) continue;
    const f = line.match(FIELD_RE);
    if (f) {
      const key = f[1].trim().toLowerCase();
      if (!(key in cur.fields)) cur.order.push(f[1].trim());
      cur.fields[key] = f[2].trim();
      lastField = key;
    } else if (lastField && /^\s{2,}\S/.test(line)) {
      // An indented line continues the field above.
      cur.fields[lastField] += `\n${line.trim()}`;
    } else {
      if (line.trim()) lastField = null;
      extra.push(line);
    }
  }
  finish();
  return { intro: intro.join("\n").trim(), decisions };
}

// Display status: the first word of the Status field, when it's one of the
// five. "Settled scope" is Settled; anything unknown is Open.
export function decisionStatus(d: Decision): string {
  const s = (d.fields.status ?? "").toLowerCase();
  for (const known of ["Open", "Proposed", "Settled", "Deferred", "Reversed"]) {
    if (s.startsWith(known.toLowerCase())) return known;
  }
  return "Open";
}

// Fields shown in the expanded card, in order. Missing ones read "Not recorded".
const CORE_FIELDS = ["Context", "Options", "Decision", "Reason", "Consequences", "Evidence"];
// Shown in the closed card instead.
const HEAD_FIELDS = ["status", "date", "owner", "stage"];

function Inline({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: renderInline(text) }} />;
}

function DecisionCard({ d }: { d: Decision }) {
  const [open, setOpen] = useState(false);
  const status = decisionStatus(d);
  const summary = d.fields.decision || d.fields.direction || d.fields.context;
  const meta = [d.fields.owner, d.fields.date].filter(Boolean).join(" · ");
  const recorded = d.fields.status && d.fields.status.toLowerCase() !== status.toLowerCase() ? d.fields.status : "";
  const otherFields = d.order.filter(
    (f) => !HEAD_FIELDS.includes(f.toLowerCase()) && !CORE_FIELDS.some((c) => c.toLowerCase() === f.toLowerCase()),
  );
  return (
    <div className={`decision${open ? " open" : ""}`} id={d.id ? `decision-${d.id.toLowerCase()}` : undefined}>
      <button type="button" className="decision-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="decision-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        {d.id && <span className="decision-id">{d.id}</span>}
        <span className="decision-title">
          <Inline text={d.title} />
        </span>
        {d.fields.stage && <span className="chip">{d.fields.stage}</span>}
        <span className={`status-chip ${statusClass(status) ?? ""}`} title={recorded || undefined}>
          {status}
        </span>
      </button>
      {(summary || meta) && (
        <div className="decision-summary">
          {summary && (
            <div>
              <Inline text={summary.split("\n")[0]} />
            </div>
          )}
          {meta && <div className="hint">{meta}</div>}
        </div>
      )}
      {open && (
        <dl className="decision-fields">
          {recorded && (
            <div className="decision-field">
              <dt>Recorded status</dt>
              <dd>{recorded}</dd>
            </div>
          )}
          {[...CORE_FIELDS, ...otherFields].map((name) => {
            const value = d.fields[name.toLowerCase()];
            return (
              <div key={name} className="decision-field">
                <dt>{name}</dt>
                <dd className={value ? "" : "hint"}>
                  {value ? <Markdown text={value} className="inline-md" /> : "Not recorded"}
                </dd>
              </div>
            );
          })}
          {d.extra && (
            <div className="decision-field">
              <dt>Notes</dt>
              <dd>
                <Markdown text={d.extra} className="inline-md" />
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

export function DecisionsView({ text }: { text: string }) {
  const { intro, decisions } = parseDecisions(text);
  const group = (statuses: string[]) => decisions.filter((d) => statuses.includes(decisionStatus(d)));
  const open = group(["Open", "Proposed"]);
  const settled = group(["Settled"]);
  const history = group(["Deferred", "Reversed"]);
  return (
    <div className="decisions">
      {intro && <Markdown text={intro} />}
      {open.length > 0 && (
        <section>
          <h2 id="s-open">Open and proposed</h2>
          {open.map((d, i) => (
            <DecisionCard key={d.id ?? i} d={d} />
          ))}
        </section>
      )}
      {settled.length > 0 && (
        <section>
          <h2 id="s-settled">Settled</h2>
          {settled.map((d, i) => (
            <DecisionCard key={d.id ?? i} d={d} />
          ))}
        </section>
      )}
      {history.length > 0 && (
        <details className="decision-history">
          <summary>
            <h2 id="s-history">Deferred and reversed ({history.length})</h2>
          </summary>
          {history.map((d, i) => (
            <DecisionCard key={d.id ?? i} d={d} />
          ))}
        </details>
      )}
    </div>
  );
}

// Section index entries for the Decisions tab, matching DecisionsView.
export function decisionHeadings(text: string) {
  const { decisions } = parseDecisions(text);
  const has = (s: string[]) => decisions.some((d) => s.includes(decisionStatus(d)));
  return [
    has(["Open", "Proposed"]) && { id: "s-open", text: "Open and proposed", level: 2 },
    has(["Settled"]) && { id: "s-settled", text: "Settled", level: 2 },
    has(["Deferred", "Reversed"]) && { id: "s-history", text: "Deferred and reversed", level: 2 },
  ].filter(Boolean) as { id: string; text: string; level: number }[];
}
