// Icons shared by the board card and the card detail view, in the app's
// 2px-stroke style.
type IconProps = { size?: number };

function Icon({ size = 16, strokeWidth = 2, children }: IconProps & { strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

// Copy card ID.
export function IdCardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6.17 15a3 3 0 0 1 5.66 0" />
      <path d="M16 10h2" />
      <path d="M16 14h2" />
    </Icon>
  );
}

// Shown briefly after a copy.
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props} strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </Icon>
  );
}

export function ArchiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </Icon>
  );
}

// Unarchive: the archive box with an arrow coming out of it.
export function UnarchiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h2" />
      <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
      <path d="m9 15 3-3 3 3" />
      <path d="M12 12v9" />
    </Icon>
  );
}
