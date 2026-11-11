import { ImageResponse } from 'next/og';

/**
 * The guest app's home-screen icon: the Stay Cape Ann mark on cream, so a
 * guest who saves the page sees the brand they booked, not Helm's.
 */
export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F3EFE4' }}>
        <svg viewBox="0 0 200 200" width="360" height="360">
          <path d="M16.5 145.3 L183.5 145.3 A95 95 0 0 1 16.5 145.3 Z" fill="#0F2A44" />
          <circle cx="100" cy="100" r="95" fill="none" stroke="#0F2A44" strokeWidth="5" />
          <path d="M100 47.9 L136.8 79.6 L136.8 110.5 L63.6 110.5 L63.6 79.6 Z" fill="#0F2A44" />
          <rect x="39.1" y="114.6" width="121.4" height="4.4" rx="2.2" fill="#C8B89A" />
        </svg>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
