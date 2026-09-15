import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { getQuoteByToken, isQuoteToken } from '@/lib/sca-quotes';
import { deriveQuoteStatus, toPublicQuote } from '@/lib/sca-quotes-types';

/**
 * GET /api/sca-quotes/<token>
 *
 * The bridge staycapeann.com reads a custom quote through when a guest opens
 * /quote/<token>. Returns the PublicQuote wire shape (sca-quotes-types.ts):
 * no internal name, no notes, no reference quote, no Stripe ids.
 *
 * A voided quote and a never-sent draft are both 404, deliberately: the link
 * must read as dead, not as "here is a quote you were not meant to see yet".
 * Expiry is derived at read time so a quote that lapsed an hour ago reads as
 * expired before the nightly cron stamps the column; the column is stamped
 * here best-effort so the operator list agrees.
 *
 * Auth: STAY_CONCIERGE_KEY in the x-stay-concierge-key header, never a query
 * string. Allowlisted in src/proxy.ts PUBLIC_API_PREFIXES.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  const { token } = await ctx.params;
  if (!isQuoteToken(token)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  let row;
  try {
    row = await getQuoteByToken(token);
  } catch (err) {
    console.error('[sca-quotes] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
  if (!row || row.voided_at || row.status === 'voided' || row.status === 'draft') {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const now = new Date();
  const status = deriveQuoteStatus(row, now);
  if (status === 'expired' && row.status !== 'expired') {
    // Best-effort: the wire status is already right; the column is for the
    // operator list. A failed stamp must not turn a readable quote into a 500.
    await supabaseAdmin
      .from('sca_quotes')
      .update({ status: 'expired' })
      .eq('id', row.id)
      .in('status', ['draft', 'sent'])
      .then(({ error }) => {
        if (error) console.warn('[sca-quotes] expiry stamp failed:', error.message);
      });
  }

  return NextResponse.json({ ok: true, quote: toPublicQuote(row, now) });
}
