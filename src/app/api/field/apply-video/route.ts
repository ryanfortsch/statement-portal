/**
 * Public client-upload token route for the recruiting funnel's optional intro
 * video. The apply page is unauthenticated, so this mints a short-lived Vercel
 * Blob client-upload token instead of accepting the file directly: the video
 * bytes go from the applicant's phone straight to Blob, never through this
 * function, which dodges the serverless request-body size limit.
 *
 * Abuse is bounded by the token itself — video MIME types only, hard 80MB cap.
 * The "under 30 seconds" rule is enforced client-side before upload (a short
 * iPhone clip lands well under the size cap); size is the server-side backstop.
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const MAX_BYTES = 80 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Video storage not configured.' }, { status: 503 });
  }

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
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['video/*'],
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
      }),
      // The client puts the returned URL into the form; nothing to persist here.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 400 });
  }
}
