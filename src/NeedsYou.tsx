import type { NeedsYou } from "./types";
import { useMask } from "./mask";
import { timeAgo } from "./time";

// A card's "Needs you" message: why the agent stopped and what to do about it.
// Loud (solid, high-contrast) in the columns picked in Settings, muted elsewhere.
export function NeedsYouBanner({
  value,
  loud,
  onClear,
}: {
  value: NeedsYou;
  loud: boolean;
  // Shown as a Clear button when set (the card editor).
  onClear?: () => void;
}) {
  const { m } = useMask();
  const since = Date.parse(value.since);
  return (
    <div className={`needs-you${loud ? " loud" : ""}`} role="status">
      <div className="needs-you-head">
        <span className="needs-you-label">Needs you</span>
        {!Number.isNaN(since) && (
          <span className="needs-you-since" title={new Date(since).toLocaleString()}>
            {timeAgo(since)}
          </span>
        )}
        {onClear && (
          <button type="button" className="needs-you-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {value.reason && <div className="needs-you-reason">{m("needsYou", value.reason)}</div>}
      {value.action && <div className="needs-you-action">{m("needsYou", value.action)}</div>}
    </div>
  );
}
