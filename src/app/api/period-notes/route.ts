import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Per-month operator notes for the Statements module's monthly close-out.
 *
 * GET /api/period-notes?month=YYYY-MM
 *   -> List notes for a month, newest first.
 *
 * POST /api/period-notes  { month, body, property_id? }
 *   -> Create a new note. Body is plain text; property_id is optional.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const month = (request.nextUrl.searchParams.get('month') || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('period_notes')
    .select('id, month, property_id, body, created_by, created_at, resolved_at')
    .eq('month', month)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const month = String(body.month || '').trim();
  const text = String(body.body || '').trim();
  const propertyId = body.property_id ? String(body.property_id).trim() : null;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: 'note too long (max 2000 chars)' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('period_notes')
    .insert({ month, property_id: propertyId, body: text, created_by: session.user.email })
    .select('id, month, property_id, body, created_by, created_at, resolved_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
