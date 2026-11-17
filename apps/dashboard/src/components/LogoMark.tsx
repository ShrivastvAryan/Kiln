/**
 * Kiln mark: code brackets < > with an upward "ship it" arrow.
 * Same glyph as the app icons. Keep the paths in sync with scripts/generate-icons.mjs.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M7 7.25 2.25 12 7 16.75" />
      <path d="M17 7.25 21.75 12 17 16.75" />
      <path d="M12 18V6.25" />
      <path d="m9.25 9 2.75-2.75L14.75 9" />
    </svg>
  );
}
