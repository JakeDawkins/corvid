// Cards added from the inbox land at the TOP of this column (matched
// case-insensitively), falling back to the first column.
export const BACKLOG_MATCH = /^backlog$/i;
// Cards quick-added from a pasted link land at the TOP of this column, falling
// back to the Backlog column.
export const TODO_MATCH = /^to[\s-]?do$/i;
// The "Suggested by Claude" column is surfaced through a toolbar popover rather
// than as a permanent board column.
export const CLAUDE_MATCH = /claude/i;
