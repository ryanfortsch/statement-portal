/**
 * Animated ship-wheel hero for the sign-in page. Two halves slide in
 * from each side and meet at the centerline — the wheel "rejoins" as
 * you arrive at Helm. SVG + CSS-only; no client JS, no Lottie, no
 * runtime deps.
 *
 * Implementation: one canonical wheel shape lives in <defs> and gets
 * referenced twice via <use> — once clipped to the left half, once to
 * the right. Each half is wrapped in a <g> that animates translateX
 * inward from ±32px. The clipPath is applied INSIDE the animated
 * group so the half-shape is computed first and then transformed as a
 * unit (otherwise the clip rectangle would stay still in viewport
 * coordinates and the moving wheel would slide through it).
 *
 * Respects prefers-reduced-motion via the rule in globals.css.
 */

const HANDLE_POSITIONS: Array<[number, number]> = [
  [100, 12],      // top
  [162.2, 37.8],  // top-right
  [188, 100],     // right
  [162.2, 162.2], // bottom-right
  [100, 188],     // bottom
  [37.8, 162.2],  // bottom-left
  [12, 100],      // left
  [37.8, 37.8],   // top-left
];

export function ShipWheel({ size = 140 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Helm"
      style={{ display: 'block', margin: '0 auto', color: 'var(--ink)' }}
    >
      <defs>
        <g id="rt-wheel-shape">
          {/* Outer ring */}
          <circle
            cx="100"
            cy="100"
            r="68"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
          />
          {/* Eight grip knobs around the perimeter */}
          {HANDLE_POSITIONS.map(([cx, cy], i) => (
            <circle key={`h${i}`} cx={cx} cy={cy} r="9" fill="currentColor" />
          ))}
          {/* Eight spokes from hub to handle */}
          {HANDLE_POSITIONS.map(([x, y], i) => (
            <line
              key={`s${i}`}
              x1="100"
              y1="100"
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}
          {/* Central hub: ink disc with a paper pinhole */}
          <circle cx="100" cy="100" r="14" fill="currentColor" />
          <circle cx="100" cy="100" r="5" fill="var(--paper)" />
        </g>
        {/* Half-viewport clip rectangles. The +/- 1px overlap on the
            centerline hides the sub-pixel hairline that otherwise shows
            up where the two halves meet on some browsers. */}
        <clipPath id="rt-wheel-clip-left">
          <rect x="-2" y="0" width="103" height="200" />
        </clipPath>
        <clipPath id="rt-wheel-clip-right">
          <rect x="99" y="0" width="103" height="200" />
        </clipPath>
      </defs>

      <g className="rt-helm-wheel-left">
        <g clipPath="url(#rt-wheel-clip-left)">
          <use href="#rt-wheel-shape" />
        </g>
      </g>
      <g className="rt-helm-wheel-right">
        <g clipPath="url(#rt-wheel-clip-right)">
          <use href="#rt-wheel-shape" />
        </g>
      </g>
    </svg>
  );
}
