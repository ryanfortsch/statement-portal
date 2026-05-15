/**
 * Animated ship-wheel for the sign-in page. The "portal" pass.
 *
 * Three-stage choreography (timings in globals.css):
 *
 *   Stage 1 — DRIFT (0 - ~65% of timeline)
 *     Two halves slide in from ±90px offscreen. Linear approach with
 *     opacity ramping up early so the user sees them coming. The
 *     halves are clipped at the centerline so each one is a real
 *     half-wheel, not a full wheel sliding under a mask.
 *
 *   Stage 2 — IMPACT (~68% of timeline)
 *     Halves arrive at the centerline. Each one recoils slightly past
 *     center (translateX overshoots into the OTHER half's space by a
 *     few px), then wobbles back and settles. The opposing recoils
 *     compress the seam, releasing it like a vault bolt seating.
 *
 *   Stage 3 — LOCK + STEER (~68% onward)
 *     The whole wheel (both halves wrapped in a single <g>) rotates
 *     90° as the halves settle. That's the "turning the lock" moment.
 *     Once locked, a much slower continuous rotation kicks in (120s
 *     per revolution) — barely perceptible, but the wheel is alive
 *     rather than frozen.
 *
 * Implementation notes:
 *   - One canonical wheel shape lives in <defs> and is referenced twice
 *     via <use>, each clipped to one half. The clipPath is INSIDE the
 *     animated <g> so the half-shape is computed first, then
 *     transformed as a unit.
 *   - The spin group wraps BOTH halves so the lock + steer rotation
 *     applies to the joined wheel as a whole, while each half still
 *     runs its own translation/wobble underneath.
 *   - Drop-shadow filter on the outer SVG gives material weight so it
 *     feels like a heavy object, not a flat icon.
 *   - prefers-reduced-motion kills all four animations via globals.css.
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

export function ShipWheel({ size = 112 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Helm"
      style={{
        display: 'block',
        margin: '0 auto',
        color: 'var(--ink)',
        overflow: 'visible',
        filter: 'drop-shadow(0 8px 20px rgba(30, 46, 52, 0.22))',
      }}
    >
      <defs>
        <g id="rt-wheel-shape">
          {/* Spokes go from the center out to the handle knobs, drawn
              FIRST so the filled rim sits on top and "covers" the
              middle of each spoke — same way a real wheel reads. */}
          {HANDLE_POSITIONS.map(([x, y], i) => (
            <line
              key={`s${i}`}
              x1="100"
              y1="100"
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
            />
          ))}

          {/* Filled donut rim. Outer disc ink, inner disc paper — the
              difference is the wood-thick rim. Reads as a real wooden
              wheel at any size. */}
          <circle cx="100" cy="100" r="72" fill="currentColor" />
          <circle cx="100" cy="100" r="58" fill="var(--paper)" />

          {/* Re-draw the spokes ON TOP of the paper inner disc so they
              read continuously from hub to handle, not chopped off at
              the inner rim edge. */}
          {HANDLE_POSITIONS.map(([x, y], i) => (
            <line
              key={`si${i}`}
              x1="100"
              y1="100"
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
            />
          ))}

          {/* Chunky handle knobs outside the rim. */}
          {HANDLE_POSITIONS.map(([cx, cy], i) => (
            <circle key={`h${i}`} cx={cx} cy={cy} r="11" fill="currentColor" />
          ))}

          {/* Hub: ink disc with a paper pinhole. */}
          <circle cx="100" cy="100" r="17" fill="currentColor" />
          <circle cx="100" cy="100" r="5" fill="var(--paper)" />
        </g>

        {/* Half-viewport clip rectangles. The 1px overlap on either
            side of the centerline hides the sub-pixel hairline that
            otherwise shows up where the two halves meet. */}
        <clipPath id="rt-wheel-clip-left">
          <rect x="-2" y="0" width="103" height="200" />
        </clipPath>
        <clipPath id="rt-wheel-clip-right">
          <rect x="99" y="0" width="103" height="200" />
        </clipPath>
      </defs>

      {/* Spin wrapper rotates the WHOLE joined wheel after impact and
          continues a very slow steer thereafter. Both halves live
          inside it so the lock turn applies to them as one object. */}
      <g className="rt-helm-wheel-spin">
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
      </g>
    </svg>
  );
}
