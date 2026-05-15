import { NextRequest, NextResponse } from 'next/server';

// Temporary diagnostic for the To-header puzzle on the daily brief.
// Hit /api/debug-headers?id=<gmail_message_id> and the route dumps every
// header Gmail returns for that message so we can see why splitRecipients
// is producing an empty array. Remove after the bug is found.

export const runtime = 'nodejs';

async function getToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID || '',
      client_secret: process.env.GMAIL_CLIENT_SECRET || '',
      refresh_token: process.env.GMAIL_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const token = await getToken();
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Delivered-To`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await r.json();
  const headers = data?.payload?.headers ?? [];
  const get = (n: string) =>
    headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === n.toLowerCase())?.value ?? null;
  const toRaw = get('to');
  const ccRaw = get('cc');
  // Char-by-char inspection of the To value so we can tell whether
  // it's actually < > or &lt; &gt; or something else.
  const toBytes = toRaw ? Array.from(toRaw as string).map(c => `${c}(${c.charCodeAt(0)})`).slice(0, 60).join(' ') : null;
  return NextResponse.json({
    headers,
    toRaw,
    ccRaw,
    toBytes,
    status: r.status,
  });
}
