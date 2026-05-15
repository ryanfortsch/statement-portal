/**
 * Animated ship-wheel for the sign-in page. The "portal" pass.
 *
 * Three-stage choreography (timings in globals.css):
 *   DRIFT  (0 - ~65%): halves slide in from ±90px offscreen.
 *   IMPACT (~68%):   halves meet, recoil INTO each other, wobble.
 *   LOCK + STEER (~68% onward): whole wheel rotates 90° as it seats,
 *                  then continues a very slow drift (120s/turn).
 *
 * Geometry pass: the previous draft read as a black ring with balls
 * stuck on the ends. This rebuild treats the wheel like an actual
 * carved object - cylindrical wooden grip pegs aligned with each
 * spoke (not balls), a bevel groove inside the rim where a real
 * wheel would have joinery, and a hub with a decorative paper ring
 * + smaller center pin instead of a single dot.
 *
 * Implementation notes:
 *   - One canonical wheel shape lives in <defs> and is referenced
 *     twice via <use>, each clipped to one half.
 *   - clipPath sits INSIDE the animated <g> so the half-shape is
 *     composed first and then transformed as a unit.
 *   - .rt-helm-wheel-spin wraps BOTH halves so the lock + steer
 *     rotation applies to the joined wheel as a whole.
 *   - prefers-reduced-motion kills every animation in globals.css.
 */

/** Eight handle positions around the wheel, expressed as compass
 *  angles (0 = top / 12 o'clock, clockwise). Used both for the
 *  spoke endpoints and for the rotation transform on each peg. */
const HANDLE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

function handleTip(angle: number, radius: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [100 + radius * Math.sin(rad), 100 - radius * Math.cos(rad)];
}

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
          {/* Spokes (back layer). Each line runs from hub center to
              the spoke's outer endpoint at radius 86 - that's just
              inside where the grip peg starts, so the spoke and peg
              read as one continuous wood element. */}
          {HANDLE_ANGLES.map((angle, i) => {
            const [x, y] = handleTip(angle, 86);
            return (
              <line
                key={`spoke-back-${i}`}
                x1="100"
                y1="100"
                x2={x}
                y2={y}
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
              />
            );
          })}

          {/* Filled donut rim. Outer ink disc minus inner paper disc
              gives a 14px-wide wooden rim. */}
          <circle cx="100" cy="100" r="72" fill="currentColor" />

          {/* Bevel groove inside the rim. A thin paper-colored ring
              sitting between the outer disc and the inner cutout - reads
              as the kind of joinery line a turned wooden wheel actually
              has. Drawn BEFORE the inner cutout so the cutout doesn't
              hide it. */}
          <circle
            cx="100"
            cy="100"
            r="66"
            fill="none"
            stroke="var(--paper)"
            strokeWidth="1.2"
          />

          {/* Inner cutout — the paper shows through here, between hub
              and rim. */}
          <circle cx="100" cy="100" r="58" fill="var(--paper)" />

          {/* Spokes (front layer). Redraw so they read continuously
              through the paper inner disc, hub to grip. */}
          {HANDLE_ANGLES.map((angle, i) => {
            const [x, y] = handleTip(angle, 86);
            return (
              <line
                key={`spoke-front-${i}`}
                x1="100"
                y1="100"
                x2={x}
                y2={y}
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
              />
            );
          })}

          {/* Cylindrical grip pegs. Each is a rounded rectangle
              positioned at the top of the wheel (between y=5 outer
              tip and y=28 where the rim's outer edge sits), then
              rotated to the correct handle angle around (100, 100).
              Height 23, width 12, fully rounded (rx=6) so the peg
              ends look like turned wooden caps - a half-dome at the
              tip, a half-dome where it meets the rim. */}
          {HANDLE_ANGLES.map((angle, i) => (
            <rect
              key={`peg-${i}`}
              x="94"
              y="5"
              width="12"
              height="23"
              rx="6"
              fill="currentColor"
              transform={`rotate(${angle} 100 100)`}
            />
          ))}

          {/* Hub assembly: ink disc, decorative paper ring inside it
              (reads as a turned groove), smaller ink pin at the very
              center. Three concentric pieces instead of one flat dot. */}
          <circle cx="100" cy="100" r="18" fill="currentColor" />
          <circle
            cx="100"
            cy="100"
            r="11.5"
            fill="none"
            stroke="var(--paper)"
            strokeWidth="1.2"
          />
          <circle cx="100" cy="100" r="4.5" fill="currentColor" />
        </g>

        {/* Half-viewport clip rectangles. The 1px overlap on either
            side of the centerline hides the sub-pixel hairline that
            otherwise shows up where the two halves meet. */}
        <clipPath id="rt-wheel-clip-left">
          <rect x="-12" y="-12" width="113" height="224" />
        </clipPath>
        <clipPath id="rt-wheel-clip-right">
          <rect x="99" y="-12" width="113" height="224" />
        </clipPath>
      </defs>

      {/* Spin wrapper rotates the WHOLE joined wheel after impact
          (90° lock) and continues a very slow steer thereafter. */}
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
