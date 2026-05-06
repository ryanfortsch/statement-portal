import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { PROPERTIES } from '@/lib/properties';

/**
 * Persist a confirmed reservation note. Called after the AddNoteModal's
 * confirmation step -- the operator has reviewed the LLM extraction,
 * picked the right confirmation_code from the candidate list, and
 * (optionally) edited the body text.
 *
 * If an attachment came along on the original /api/notes/extract call,
 * the modal re-sends the file here so we can upload it to Supabase
 * Storage and store the public URL on the row. We don't keep the file
 * around between extract and save -- simpler than a temp-storage round
 * trip, and these uploads are <10MB.
 *
 * On insert we also delete any existing note from the same author for
 * the same confirmation_code (one note per (code, author) pair). This
 * lets the operator hit "Add note" twice on the same reservation to
 * correct an earlier note without manually deleting the old one.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const ATTACHMENT_BUCKET = 'reservation-note-attachments';

function sanitizeFilename(name: string): string {
  // Storage paths reject most special chars; keep only alphanumerics, dot, dash, underscore.
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const confirmationCode = ((formData.get('confirmation_code') as string) || '').trim();
    const propertyId = ((formData.get('property_id') as string) || '').trim() || null;
    const body = ((formData.get('body') as string) || '').trim();
    const sourceText = ((formData.get('source_text') as string) || '').trim() || null;
    const author = ((formData.get('author') as string) || '').trim() || null;

    let amountsReferenced: number[] | null = null;
    const amountsRaw = formData.get('amounts_referenced');
    if (typeof amountsRaw === 'string' && amountsRaw.trim()) {
      try {
        const parsed = JSON.parse(amountsRaw);
        if (Array.isArray(parsed)) {
          amountsReferenced = parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
          if (amountsReferenced.length === 0) amountsReferenced = null;
        }
      } catch {
        // Treat malformed amounts as none rather than failing the save.
      }
    }

    if (!confirmationCode) {
      return NextResponse.json({ error: 'confirmation_code is required' }, { status: 400 });
    }
    if (!body) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }
    if (propertyId && !PROPERTIES[propertyId]) {
      return NextResponse.json({ error: `Unknown property_id: ${propertyId}` }, { status: 400 });
    }

    // Optional attachment upload. Stored at:
    //   reservation-note-attachments/<confirmation_code>/<timestamp>-<filename>
    let sourceAttachmentUrl: string | null = null;
    const attachment = formData.get('attachment') as File | null;
    if (attachment && attachment.size > 0) {
      const safeName = sanitizeFilename(attachment.name || 'attachment');
      const path = `${confirmationCode}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, attachment, {
          contentType: attachment.type || 'application/octet-stream',
          upsert: false,
        });
      if (uploadErr) {
        // Don't lose the note over an upload failure -- save the note, surface the warning.
        console.warn('attachment upload failed, saving note without it:', uploadErr.message);
      } else {
        const { data: pub } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(path);
        sourceAttachmentUrl = pub?.publicUrl || null;
      }
    }

    // Replace any existing note from the same author for this code.
    if (author) {
      await supabase
        .from('reservation_notes')
        .delete()
        .eq('confirmation_code', confirmationCode)
        .eq('author', author);
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('reservation_notes')
      .insert({
        confirmation_code: confirmationCode,
        property_id: propertyId,
        body,
        author,
        source_text: sourceText,
        source_attachment_url: sourceAttachmentUrl,
        amounts_referenced: amountsReferenced,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return NextResponse.json({
      success: true,
      note: inserted,
    });
  } catch (err) {
    console.error('notes/save error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
