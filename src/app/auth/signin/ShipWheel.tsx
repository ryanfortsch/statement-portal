/**
 * Animated ship-wheel for the sign-in page. Two halves drift in from
 * each side, slow as they approach, slam together at the centerline,
 * and recoil briefly before settling — the "vault lock" moment. The
 * keyframes do all the dramatic timing; the SVG geometry just needs
 * to be substantial enough that the impact reads.
 *
 * Iteration over the first pass (which Dotti said looked like a
 * spider web): thicker filled donut rim instead of a thin stroked
 * ring, chunkier handle knobs, fewer-but-bolder spokes. The whole
 * shape carries weight now so the slam looks like two heavy halves
 * meeting, not two skeleton fragments.
 *
 * Implementation: one canonical wheel in <defs>, referenced twice via
 * <use>, each clipped to one half. The clipPath sits INSIDE the
 * animated <g> so the half-shape is computed first and then
 * transformed as a unit — otherwise the clip stays still in viewport
 * coordinates and the moving wheel slides through it. Respects
 * prefers-reduced-motion via globals.css.
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

export function ShipWheel({ size = 96 }: { size?: number }) {
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

          {/* Filled donut rim. Outer disc in ink, inner disc in paper —
              the difference is the wood-thick rim. Gives the wheel
              real visual weight at small sizes. */}
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

      {/* Brief flash at the seam at the moment of impact. Scales up
          and fades out — reads as a "thud" rather than a sparkle. */}
      <line
        x1="100"
        y1="38"
        x2="100"
        y2="162"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="rt-helm-wheel-impact"
      />
    </svg>
  );
}
