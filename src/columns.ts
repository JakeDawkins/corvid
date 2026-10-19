// Cards added from the inbox land at the TOP of this column (matched
// case-insensitively), falling back to the first column.
export const BACKLOG_MATCH = /^backlog$/i;
// Cards quick-added from a pasted link land at the TOP of this column, falling
// back to the Backlog column.
export const TODO_MATCH = /^to[\s-]?do$/i;
// The "Suggested by Claude" column is surfaced through a toolbar popover rather
// than as a permanent board column.
export const CLAUDE_MATCH = /claude/i;

// Where the card detail view's advance button sends a card in `current`: the
// column set in Settings > Next column, else the next column on the board
// (skipping the suggestions column). Undefined when there's nowhere to go: the
// last column, or one whose next column is set to none ("").
export function nextColumn(
  columns: string[],
  current: string,
  nextColumns?: Record<string, string>,
): string | undefined {
  const set = nextColumns?.[current];
  if (set === "") return undefined;
  if (set && set !== current && columns.includes(set)) return set;
  const board = columns.filter((c) => !CLAUDE_MATCH.test(c));
  const i = board.indexOf(current);
  return i >= 0 && i < board.length - 1 ? board[i + 1] : undefined;
}
