// The Claude starburst mark. Used for the Suggested toolbar button and, spinning,
// as the "agent working" indicator on cards.
export function ClaudeLogo({ className = "claude-logo" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.2c.5 0 .9.4.9.9l.35 5.03 3.2-3.88a.9.9 0 0 1 1.42 1.1l-2.9 4.13 4.83-1.57a.9.9 0 0 1 .56 1.71l-4.83 1.57 4.83 1.57a.9.9 0 0 1-.56 1.71l-4.83-1.57 2.9 4.13a.9.9 0 0 1-1.42 1.1l-3.2-3.88-.35 5.03a.9.9 0 0 1-1.8 0l-.35-5.03-3.2 3.88a.9.9 0 0 1-1.42-1.1l2.9-4.13-4.83 1.57a.9.9 0 1 1-.56-1.71l4.83-1.57-4.83-1.57a.9.9 0 0 1 .56-1.71l4.83 1.57-2.9-4.13a.9.9 0 0 1 1.42-1.1l3.2 3.88.35-5.03c0-.5.4-.9.9-.9Z" />
    </svg>
  );
}
