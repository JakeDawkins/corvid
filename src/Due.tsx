import { CalendarIcon } from "./icons";
import type { DueThresholds } from "./types";

// Used until the user changes them in Settings: due today or tomorrow is
// urgent, due in two days is soon, anything later just shows the days left.
export const DEFAULT_DUE_THRESHOLDS: DueThresholds = { urgentDays: 1, soonDays: 2 };

// overdue: the date has passed. urgent/soon: within that threshold. later:
// further out, shown without emphasis.
export type DueTone = "overdue" | "urgent" | "soon" | "later";

// Parse a YYYY-MM-DD due date as local midnight (Date parses the bare form as UTC).
function parseDay(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// Whole days from today to the due date: 0 today, 1 tomorrow, negative once past.
export function daysUntil(date: string, now = new Date()): number | null {
  const due = parseDay(date);
  if (!due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Rounded so a DST change (a 23 or 25 hour day) doesn't shift the count.
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function dueStatus(
  date: string,
  thresholds: DueThresholds = DEFAULT_DUE_THRESHOLDS,
): { days: number; tone: DueTone; label: string } | null {
  const days = daysUntil(date);
  if (days === null) return null;
  const tone: DueTone =
    days < 0 ? "overdue" : days <= thresholds.urgentDays ? "urgent" : days <= thresholds.soonDays ? "soon" : "later";
  const label =
    days < 0
      ? `${-days}d overdue`
      : days === 0
        ? "Today"
        : days === 1
          ? "Tomorrow"
          : `${days} days`;
  return { days, tone, label };
}

// Long form for tooltips, e.g. "Fri Oct 24 2026".
export function formatDueDate(date: string): string {
  const d = parseDay(date);
  return d ? d.toDateString() : date;
}

// The card's due date pill: the days left, tinted by urgency. Archived cards
// show it without urgency, since nothing is waiting on them.
export function DueBadge({
  date,
  thresholds,
  muted,
}: {
  date: string;
  thresholds?: DueThresholds;
  muted?: boolean;
}) {
  const status = dueStatus(date, thresholds);
  if (!status) return null;
  return (
    <span
      className={`due-badge ${muted ? "later" : status.tone}`}
      title={`Due ${formatDueDate(date)}`}
    >
      <CalendarIcon size={11} />
      {status.label}
    </span>
  );
}
