/**
 * The Stay Cape Ann mark, current cut (Dotti supplied the artwork on
 * 2026-09-25): an outline circle, a plain gabled house, a rounded sand beam
 * under it, and water filling the circle below a chord. No sun and no
 * wordmark. The geometry is the SCA repo's app/icon.svg and SiteHeader.tsx,
 * normalised to the same 200-unit box; change it there and here together.
 *
 * Two cuts exist: navy house + sand beam on cream (the default here, for the
 * 4 x 6 placards) and cream house + gold beam on navy. Pass the colours for
 * the second.
 */
export function ScaMark({
  size = 40,
  navy = '#0F2A44',
  sand = '#C8B89A',
}: {
  size?: number;
  navy?: string;
  sand?: string;
}) {
  return (
    <div className="rt-mark" aria-hidden="true" style={{ lineHeight: 0 }}>
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <path d="M16.5 145.3 L183.5 145.3 A95 95 0 0 1 16.5 145.3 Z" fill={navy} />
        <circle cx="100" cy="100" r="95" fill="none" stroke={navy} strokeWidth="5" />
        <path d="M100 47.9 L136.8 79.6 L136.8 110.5 L63.6 110.5 L63.6 79.6 Z" fill={navy} />
        <rect x="39.1" y="114.6" width="121.4" height="4.4" rx="2.2" fill={sand} />
      </svg>
    </div>
  );
}
