// The T3 Code mark: "T3" on a dark rounded square, like its app icon. Used on
// T3 Code thread links.
export function T3Logo({ className = "t3-logo" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#1f1a4d" />
      <text
        x="12"
        y="16.6"
        textAnchor="middle"
        fontSize="12"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="#fff"
      >
        T3
      </text>
    </svg>
  );
}
