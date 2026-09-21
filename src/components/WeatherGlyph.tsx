import type { ShootGrade, Sky } from '@/lib/weather-types';

/**
 * The sky in one small mark. Stroked with currentColor at 24x24 like the
 * rest of Helm's inline icons, so the caller sets size and colour.
 *
 * No 'use client' and no hooks: the planner grid (client) and the shoot
 * page (server) both render it.
 */

/**
 * Grade -> ink: green go, amber maybe, red no. All three are tones Helm
 * already uses for those meanings, so the forecast row reads like the rest
 * of the app.
 *
 * Poor is the at-risk red the packets board uses for a slipping job, NOT
 * `--signal`. In this palette `--signal` is a bronze (#946d2e) sitting a
 * few degrees from the amber of `fair`: side by side on a live forecast
 * the two were one colour, and a row that cannot separate "workable" from
 * "rained out" is not worth printing.
 */
export const GRADE_TINT: Record<ShootGrade, string> = {
  good: 'var(--positive)',
  fair: '#7a5512',
  poor: '#c0392b',
};

export const GRADE_WORD: Record<ShootGrade, string> = {
  good: 'good light',
  fair: 'workable',
  poor: 'poor for filming',
};

export function WeatherGlyph({ sky, size = 14 }: { sky: Sky; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    style: { flexShrink: 0, display: 'block' },
  };
  const cloud = <path d="M7 18h9.5a3.5 3.5 0 000-7 5 5 0 00-9.6 1.3A3.2 3.2 0 007 18z" />;
  switch (sky) {
    case 'clear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4" />
        </svg>
      );
    case 'partly':
      return (
        <svg {...common}>
          <circle cx="8.5" cy="8" r="3.1" />
          <path d="M8.5 2.6v1.4M3.1 8h1.4M4.6 4.1l1 1M12.4 4.1l-1 1" />
          {cloud}
        </svg>
      );
    case 'cloudy':
      return <svg {...common}>{cloud}</svg>;
    case 'fog':
      return (
        <svg {...common}>
          <path d="M4 8h16M6 12h14M4 16h12M8 20h11" />
        </svg>
      );
    case 'rain':
      return (
        <svg {...common}>
          {cloud}
          <path d="M9 20.5l-.8 1.8M13 20.5l-.8 1.8M17 20.5l-.8 1.8" />
        </svg>
      );
    case 'snow':
      return (
        <svg {...common}>
          {cloud}
          <path d="M9 21h.01M13 21.6h.01M17 21h.01" strokeWidth={2.4} />
        </svg>
      );
    case 'storm':
      return (
        <svg {...common}>
          {cloud}
          <path d="M13 19.5l-2.6 3h3l-2 3" />
        </svg>
      );
  }
}
