import { NextResponse } from 'next/server';
import { loadGuestAppByToken } from '@/lib/guest-app-db';

/**
 * The guest app's own web manifest, one per home, so "Add to Home Screen"
 * saves THIS home's page under its own name (Helm's root manifest would
 * otherwise save Helm, and the icon would open on a sign-in screen).
 * start_url and scope are the token page itself.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await loadGuestAppByToken(token);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const start = `/h/${token}`;
  return NextResponse.json(
    {
      name: `${found.app.title} · Stay Cape Ann`,
      short_name: found.app.title.length <= 16 ? found.app.title : found.app.name,
      description: 'Your home guide: Wi-Fi, checkout, how the house works, and Cape Ann nearby.',
      id: start,
      start_url: start,
      scope: start,
      display: 'standalone',
      background_color: '#F3EFE4',
      theme_color: '#0F2A44',
      icons: [{ src: '/h/app-icon', sizes: '512x512', type: 'image/png', purpose: 'any' }],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } },
  );
}
