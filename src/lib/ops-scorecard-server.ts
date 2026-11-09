/**
 * Reads for the operations scorecard (ops-scorecard.ts has the rules). One
 * read per tile, each failing soft to null so one bad table costs its own
 * tile ("Unavailable"), never the band or the home page. Nothing here reads
 * money: the standards are about guests, work and records.
 */
import 'server-only';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { collapseWorkIssues } from '@/lib/work-issues';
import { loadWorkIssueLinks } from '@/lib/work-issues-server';
import { getReviewWindowStats } from '@/lib/reviews';
import { operatingDate } from '@/lib/operating-date';
import { CAPE_ANN_REGION } from '@/lib/property-scope';
import { ACCESS_COLUMNS, getPropertyAccessMap } from '@/lib/property-access';
import {
  MISSING_INFO_COLUMNS, NOTE_WINDOW_DAYS, RATING_WINDOW_DAYS,
  ageDays, countMissingInfo, hasClearNote, missingInfoTile, ratingTile, workTile,
  type MissingInfoColumn, type ScorecardTile,
} from '@/lib/ops-scorecard';

const ACTIVE = ['open', 'in_progress', 'scheduled'];

async function soft<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.warn('[ops-scorecard] read failed', err instanceof Error ? err.message : err);
    return null;
  }
}

async function readWork(today: string) {
  const since = new Date(Date.now() - NOTE_WINDOW_DAYS * 86_400_000).toISOString();
  const [rows, links, closed] = await Promise.all([
    selectAllPaged<{ id: string; property_id: string; created_at: string }>((from, to) =>
      supabase.from('work_slips').select('id, property_id, created_at').in('status', ACTIVE).order('id').range(from, to)),
    loadWorkIssueLinks(supabase),
    selectAllPaged<{ id: string; resolution_notes: string | null }>((from, to) =>
      supabase.from('work_slips').select('id, resolution_notes').eq('status', 'done').gte('completed_at', since).order('id').range(from, to)),
  ]);
  const open = collapseWorkIssues(rows, links).length;
  const oldest = rows.reduce<string | null>((min, r) => (!min || r.created_at < min ? r.created_at : min), null);
  return {
    open,
    oldestDays: oldest ? ageDays(oldest, today) : null,
    closed: closed.length,
    closedWithNote: closed.filter((r) => hasClearNote(r.resolution_notes)).length,
  };
}

/** The managed Cape Ann homes (active, not Rising Tide's own), with the
 *  facts the property page shows; blanks are what it shows as empty. The
 *  credentials (key location, Wi-Fi password) live in property_access since
 *  20260620b, so they are read there and merged back, as the page does. */
async function readMissingInfo() {
  const accessCols = new Set<string>(ACCESS_COLUMNS);
  const propertyCols = MISSING_INFO_COLUMNS.filter((c) => !accessCols.has(c));
  const { data, error } = await supabase
    .from('properties')
    .select(['id', 'region', 'is_rising_tide_owned', ...propertyCols].join(', '))
    .eq('is_active', true)
    .limit(500);
  if (error) throw new Error(error.message);
  type Row = { id: string; region: string | null; is_rising_tide_owned: boolean | null } & Partial<Record<MissingInfoColumn, unknown>>;
  const homes = ((data ?? []) as unknown as Row[]).filter(
    (p) => (p.region ?? CAPE_ANN_REGION) === CAPE_ANN_REGION && !p.is_rising_tide_owned,
  );
  const access = await getPropertyAccessMap(homes.map((h) => h.id));
  return countMissingInfo(homes.map((h) => ({ ...h, ...(access.get(h.id) ?? {}) })));
}

export async function loadOpsScorecard(): Promise<ScorecardTile[] | null> {
  if (!isServiceConfigured) return null;
  const today = operatingDate();
  const [rating, work, missing] = await Promise.all([
    soft(getReviewWindowStats(RATING_WINDOW_DAYS, { strict: true })),
    soft(readWork(today)),
    soft(readMissingInfo()),
  ]);
  return [ratingTile(rating), workTile(work), missingInfoTile(missing)];
}
