import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';

/**
 * Review Stories -> the queue on Dotti's Mac.
 *
 * The daily story runner used to read reviews by shelling out to the linked
 * Supabase CLI. That works from a shell and fails from launchd: the CLI keeps
 * its login token in the macOS login keychain, which a launchd agent cannot
 * read, so the 9:09 refresh threw every morning from 2026-09-21 and no review
 * written after the 19th ever entered the rotation. The render itself carried
 * on from the already-seeded queue, so nothing looked wrong.
 *
 * Serving the same rows over HTTPS moves the daily job onto the leg that
 * already survives launchd: STORY_FACTORY_SECRET out of Helm's .env.local,
 * which is an ordinary file, exactly as the Drive copier and the mailer read
 * it. No keychain, no CLI, no Supabase key on the Mac.
 *
 * POST { secret, days? } -> { ok, days, rows: [...] }
 *
 * Fail-closed on the shared secret, same as /api/review-stories/drive and
 * /api/notify-dotti: an unset env means every request is rejected. Read only.
 */

export const maxDuration = 60;

const DEFAULT_DAYS = 14;
const MAX_DAYS = 400;
const MIN_REVIEW_CHARS = 40;

function secretMatches(given: string): boolean {
  const expected = process.env.STORY_FACTORY_SECRET;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type ReviewRow = {
  id: string;
  property_id: string | null;
  channel: string | null;
  overall_rating: number | null;
  guest_name: string | null;
  review_created_at: string | null;
  public_review: string | null;
  source: string | null;
};

type PropertyRow = {
  id: string;
  name: string | null;
  title: string | null;
  city: string | null;
};

export async function POST(request: NextRequest) {
  let payload: { secret?: string; days?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  if (!secretMatches(payload.secret ?? '')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const asked = Number(payload.days);
  const days = Number.isFinite(asked)
    ? Math.min(MAX_DAYS, Math.max(1, Math.floor(asked)))
    : DEFAULT_DAYS;

  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Five-star reviews with enough text to fill a card. csv-fallback rows are
  // excluded because their guest_name is often a confirmation code.
  const reviews = await selectAllPaged<ReviewRow>((from, to) =>
    supabaseAdmin
      .from('reviews')
      .select('id, property_id, channel, overall_rating, guest_name, review_created_at, public_review, source')
      .gte('review_created_at', since)
      .gte('overall_rating', 5)
      .order('review_created_at', { ascending: false })
      .range(from, to),
  );

  // Only homes still in the fleet, and the story card needs the external
  // title and town, so a review whose property is gone is dropped.
  const properties = await selectAllPaged<PropertyRow>((from, to) =>
    supabaseAdmin
      .from('properties')
      .select('id, name, title, city')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to),
  );
  const byId = new Map(properties.map((p) => [p.id, p]));

  const rows = reviews
    .filter((r) =>
      r.source !== 'csv-fallback' &&
      (r.public_review ?? '').trim().length >= MIN_REVIEW_CHARS &&
      r.property_id && byId.has(r.property_id))
    .map((r) => {
      const p = byId.get(r.property_id as string) as PropertyRow;
      return {
        id: r.id,
        property_id: r.property_id,
        property_name: p.name,
        property_title: p.title,
        city: p.city,
        channel: r.channel,
        overall_rating: r.overall_rating,
        guest_name: r.guest_name,
        review_created_at: r.review_created_at,
        public_review: r.public_review,
      };
    });

  return NextResponse.json({ ok: true, days, rows });
}
