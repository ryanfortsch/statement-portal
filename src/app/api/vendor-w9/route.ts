import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Toggle whether a vendor has a W9 on file in QuickBooks.
 *
 * POST { vendor_key, display_name, on_file: boolean, notes?: string }
 *
 * Helm doesn't store the W9 document itself -- QB is the system of
 * record. This endpoint just persists the flag the operator ticks on
 * the 1099 candidates table so year-end has a clean signal.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const vendor_key = ((body.vendor_key as string) || '').trim().toLowerCase();
    const display_name = ((body.display_name as string) || '').trim();
    const on_file = !!body.on_file;
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;
    if (!vendor_key) {
      return NextResponse.json({ error: 'vendor_key is required' }, { status: 400 });
    }
    if (!display_name) {
      return NextResponse.json({ error: 'display_name is required' }, { status: 400 });
    }
    const { error } = await supabase
      .from('vendor_w9')
      .upsert(
        { vendor_key, display_name, on_file, notes, updated_at: new Date().toISOString() },
        { onConflict: 'vendor_key' },
      );
    if (error) {
      // Tolerate the table not existing yet (migration unapplied).
      const missing = error.code === 'PGRST205' || /does not exist|Could not find the table/i.test(error.message || '');
      if (missing) {
        return NextResponse.json(
          { error: 'vendor_w9 table missing -- run supabase-schema-vendor-w9.sql first.' },
          { status: 503 },
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true, vendor_key, on_file });
  } catch (err) {
    console.error('vendor-w9 POST error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
