/**
 * Client-upload token route for the property Listing tab's photo gallery
 * (ListingPanel.tsx). The browser asks here for a short-lived Vercel Blob
 * client token, then PUTs the bytes straight to Blob; the photo never rides
 * through a server action, whose body is capped at 4 MB (next.config.ts)
 * under a 4.5 MB platform ceiling. Once Blob returns the URL, the panel
 * records it with recordUploadedPhotoAction in listing-actions.ts.
 *
 * Gate: the proxy already turns anonymous /api callers away (this path is
 * not in PUBLIC_API_PREFIXES) and the handler checks the session again.
 * The token itself is the other guard: listings/<property>/<file> only,
 * for a property the registry knows, image types only, 12 MB max, ten
 * minutes to use it, no overwrite.
 *
 * No onUploadCompleted on purpose. With one, handleUpload mints a callback
 * URL for Blob's servers to POST to, and this route is session-gated so
 * that callback could only ever 401. The gallery row is written by the
 * panel's follow-up action instead, which also carries caption and size.
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { auth } from '@/auth';
import { isServiceConfigured, supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Twins of the cap and type list ListingPanel.tsx checks before a byte
// leaves the browser ("12 MB max"). The token enforces them; the panel
// only saves the operator a wasted upload.
const MAX_BYTES = 12 * 1024 * 1024;
const CONTENT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const TOKEN_TTL_MS = 10 * 60 * 1000;
// listings/<property_id>/<one file segment>.<ext>: no nesting, no dot
// segments, no escaping the property's folder.
const PATHNAME = /^listings\/([a-z0-9_]{1,60})\/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,8}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Photo storage is not configured (BLOB_READ_WRITE_TOKEN).' }, { status: 503 });
  }
  if (!isServiceConfigured) return NextResponse.json({ error: 'Service role not configured' }, { status: 503 });

  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const propertyId = PATHNAME.exec(pathname)?.[1];
        if (!propertyId) throw new Error('Photos upload under listings/<property>/ only.');
        const { data, error } = await supabaseAdmin.from('properties').select('id').eq('id', propertyId).maybeSingle();
        if (error) throw new Error(`registry read: ${error.message}`);
        if (!data) throw new Error(`Unknown property ${propertyId}.`);
        return {
          allowedContentTypes: CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: Date.now() + TOKEN_TTL_MS,
        };
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload refused' }, { status: 400 });
  }
}
