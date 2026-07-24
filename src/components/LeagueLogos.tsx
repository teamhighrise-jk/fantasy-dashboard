/**
 * Small recreated ESPN / CBS marks for the Watchlist free-agent column.
 * Inline SVG (self-contained, crisp at small sizes — no external dependency).
 */

/** ESPN: red rounded square with a single capital "E". */
export function EspnLogo({ height = 14 }: { height?: number }) {
  return (
    <svg
      height={height}
      viewBox="0 0 24 24"
      role="img"
      aria-label="ESPN"
      style={{ display: "block" }}
    >
      <rect width="24" height="24" rx="4" fill="#D50A0A" />
      <text
        x="12"
        y="18"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontStyle="italic"
        fontWeight="700"
        fontSize="17"
        fill="#ffffff"
      >
        E
      </text>
    </svg>
  );
}

/** CBS: the eye mark — white lens with a dark pupil. */
export function CbsLogo({ height = 14 }: { height?: number }) {
  return (
    <svg
      height={height}
      viewBox="0 0 32 22"
      role="img"
      aria-label="CBS"
      style={{ display: "block" }}
    >
      <path
        d="M16 1.5 C 25 1.5, 30.5 11, 30.5 11 C 30.5 11, 25 20.5, 16 20.5 C 7 20.5, 1.5 11, 1.5 11 C 1.5 11, 7 1.5, 16 1.5 Z"
        fill="#ffffff"
        stroke="#0b0b0c"
        strokeWidth="1.5"
      />
      <circle cx="16" cy="11" r="5.2" fill="#0b0b0c" />
    </svg>
  );
}
