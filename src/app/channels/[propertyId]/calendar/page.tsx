import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { getFleetProperty } from '@/lib/fleet';
import { regionLabel } from '@/lib/property-scope';
import { listBookingsForProperty, loadFeedHealth, type BookingEx, type FeedHealth } from '@/lib/channels';
import { loadPricingBundle, type PricingBundle } from '@/lib/property-rates';
import { loadCalendarDayMap } from '@/lib/calendar-days';
import { isOpenOn } from '@/lib/rental-periods';
import { todayInEastern } from '@/lib/sca-quotes-types';
import {
  authorityBadge,
  buildCalendarBars,
  buildCalendarCells,
  buildMonthGrid,
  fmtCellPrice,
  importFreshness,
  monthKey,
  monthOf,
  parseMonthParam,
  shiftMonth,
  UNSELLABLE_LABEL,
  type CalendarCellVM,
  type UnsellableReason,
} from '@/lib/calendar-model';
import { CHANNEL_LABELS, type BookingChannel } from '@/lib/channels-types';
import { type CalendarRowVM } from '../../calendar/MultiCalendarGrid';
import { bulkSetRateDaysForm } from '../../calendar/calendar-actions';
import { PropertyMonthCalendar } from '../PropertyMonthCalendar';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function PropertyMonthGridPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { propertyId } = await params;
  const sp = await searchParams;
  const property = await getFleetProperty(propertyId);
  if (!property) notFound();

  const now = new Date();
  const today = todayInEastern(now);
  const ym = parseMonthParam(one(sp.month)) ?? monthOf(today);
  const grid = buildMonthGrid(ym.year, ym.month);
  const helmRun = property.calendar_authority === 'helm';

  const [bookings, feeds, bundle, mirror] = await Promise.all([
    safe(() => listBookingsForProperty(propertyId, grid.gridStart, grid.gridEnd), [] as BookingEx[]),
    safe(() => loadFeedHealth(propertyId), [] as FeedHealth[]),
    helmRun ? safe(() => loadPricingBundle(propertyId, grid.gridStart, grid.gridEnd), null as PricingBundle | null) : Promise.resolve(null as PricingBundle | null),
    helmRun ? Promise.resolve(null) : safe(() => loadCalendarDayMap([propertyId], grid.gridStart, grid.gridEnd), null),
  ]);

  const live = bookings.filter((b) => b.status !== 'cancelled');
  const activeDirectFeeds = feeds.filter((f) => f.is_active && !!f.ical_import_url && f.channel !== 'guesty');
  const badge = authorityBadge(property, activeDirectFeeds.length > 0);
  const oldestImport = feeds.filter((f) => f.is_active && f.ical_import_url).map((f) => f.last_imported_at).sort((a, b) => (a ?? '').localeCompare(b ?? ''))[0] ?? null;

  const cells = buildCalendarCells({
    dates: grid.cells.map((c) => c.date),
    bookings: live,
    calendarAuthority: property.calendar_authority,
    plan: bundle?.plan ?? null,
    rateDays: bundle?.days,
    mirror: mirror?.get(propertyId),
    isOpen: bundle ? (d) => isOpenOn(bundle.periods, d) : undefined,
    today,
    now,
    timeZone: property.timezone,
  });
  const row: CalendarRowVM = {
    property: {
      id: property.id,
      name: property.name,
      region: property.region,
      regionLabel: regionLabel(property.region),
      calendarAuthority: property.calendar_authority,
      helmRun,
      badgeLabel: badge.label,
      badgeKind: badge.kind,
      freshness: importFreshness(oldestImport, now),
      freshnessDetail: '',
      hasPlan: !!bundle?.plan,
    },
    cells,
    bars: buildCalendarBars(live, { start: grid.gridStart, end: grid.gridEnd }, (c) => CHANNEL_LABELS[c as BookingChannel] ?? c),
  };

  const monthCells = cells.filter((c) => c.date >= grid.start && c.date <= grid.end);
  const summary = summarise(monthCells, today);
  const prev = shiftMonth(ym.year, ym.month, -1);
  const next = shiftMonth(ym.year, ym.month, 1);
  const saved = one(sp.saved);
  const error = one(sp.error);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow={`Helm · Channels · ${property.name} · Calendar`}
        title={property.name}
        emphasis={grid.label}
        description="Every night with its price, minimum stay, arrival and departure rules, the stay or hold on it, and the reason it cannot be sold. Click a night to edit, drag for a range, shift-click a second night to quote the span."
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 20 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/channels/${propertyId}`} style={ghostButton}>← {property.name} hub</Link>
          <Link href={`/channels/calendar?month=${monthKey(ym.year, ym.month)}`} style={ghostButton}>Multi-calendar →</Link>
          <span style={{ flex: 1 }} />
          <Link href={`/channels/${propertyId}/calendar?month=${monthKey(prev.year, prev.month)}`} style={secondaryButton}>← {monthShort(prev)}</Link>
          <Link href={`/channels/${propertyId}/calendar?month=${monthKey(monthOf(today).year, monthOf(today).month)}`} style={secondaryButton}>Today</Link>
          <Link href={`/channels/${propertyId}/calendar?month=${monthKey(next.year, next.month)}`} style={secondaryButton}>{monthShort(next)} →</Link>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Stat label="Booked nights" value={String(summary.booked)} sub={`of ${monthCells.length} in ${grid.label.split(' ')[0]}`} />
          <Stat label="Held" value={String(summary.held)} sub="owner, maintenance, closed" />
          <Stat label="Open to sell" value={String(summary.open)} sub={summary.futureUnsellable > 0 ? `${summary.futureUnsellable} unsellable by rule` : 'every future vacancy'} />
          <Stat label="Average open rate" value={summary.avgOpenCents != null ? fmtCellPrice(summary.avgOpenCents) : '-'} sub={helmRun ? "from Helm's plan" : 'Guesty / PriceLabs mirror'} last />
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
        <PropertyMonthCalendar row={row} weeks={grid.weeks.map((w) => w.map((c) => c.date))} monthStart={grid.start} monthEnd={grid.end} today={today} monthLabel={grid.label} />
      </section>

      {/* Unsellable nights, spelled out */}
      {summary.reasons.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Why a vacant night is not for sale</div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {summary.reasons.map((r) => (
              <div key={r.reason} style={{ display: 'grid', gridTemplateColumns: '190px 60px 1fr', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 12, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>{UNSELLABLE_LABEL[r.reason]}</span>
                <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>{r.dates.length} night{r.dates.length === 1 ? '' : 's'}</span>
                <span className="font-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{compressDates(r.dates)}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10, lineHeight: 1.5 }}>
            Past nights are omitted. Advance notice and booking window come from the rate plan; off season from the property&apos;s rental periods; closed from a per-night override.
          </p>
        </section>
      )}

      {/* Bulk set */}
      <section id="bulk" className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Set a range</div>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
          {(saved || error) && (
            <div style={{ borderLeft: `3px solid ${error ? 'var(--negative)' : 'var(--positive)'}`, padding: '10px 14px', background: 'var(--paper-2)', fontSize: 13, lineHeight: 1.5, marginBottom: 16, color: error ? 'var(--negative)' : 'var(--ink)' }}>
              {error || saved}
            </div>
          )}
          {!helmRun ? (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 640, margin: 0 }}>
              Guesty runs this calendar, so prices, minimums and closures are set in Guesty or PriceLabs and mirrored here. Bulk editing unlocks once the home is flipped to Helm on the{' '}
              <Link href={`/channels/${propertyId}#cutover`} style={{ color: 'var(--ink)' }}>hub</Link>.
            </p>
          ) : (
            <form action={bulkSetRateDaysForm} style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="month" value={monthKey(ym.year, ym.month)} />
              <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>
                Tick the fields to change; unticked fields keep each night&apos;s current value. A blank price returns the nights to the plan&apos;s own rate; a blank minimum returns them to the plan default.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="From (first night)">
                  <input name="start" type="date" required defaultValue={grid.start >= today ? grid.start : today} style={inputStyle} />
                </Field>
                <Field label="To (last night, inclusive)">
                  <input name="end" type="date" required defaultValue={grid.end} style={inputStyle} />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'end' }}>
                <Field label={<Tick name="touch_price" label="Nightly rate" />}>
                  <input name="nightly" type="text" inputMode="decimal" placeholder={bundle?.plan ? `plan: $${Math.round(bundle.plan.base_nightly_cents / 100)}` : 'no plan'} style={inputStyle} />
                </Field>
                <Field label={<Tick name="touch_min" label="Minimum nights" />}>
                  <input name="min_nights" type="number" min={1} max={365} placeholder={bundle?.plan ? `plan: ${bundle.plan.min_nights_default}` : ''} style={inputStyle} />
                </Field>
                <Field label={<Tick name="touch_closed" label="Closed" />}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, height: 40 }}>
                    <input name="closed" type="checkbox" /> not for sale
                  </label>
                </Field>
                <Field label={<Tick name="touch_note" label="Note" />}>
                  <input name="note" type="text" placeholder="why" style={inputStyle} />
                </Field>
              </div>
              <div>
                <SubmitButton label="Apply to range" busyLabel="Applying…" style={primaryButton} />
              </div>
            </form>
          )}
        </div>
      </section>

      <HelmFooter module={`Channels · ${property.name} · ${grid.label}`} right={badge.label} />
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

type Summary = {
  booked: number;
  held: number;
  open: number;
  futureUnsellable: number;
  avgOpenCents: number | null;
  reasons: Array<{ reason: UnsellableReason; dates: string[] }>;
};

function summarise(cells: CalendarCellVM[], today: string): Summary {
  let booked = 0;
  let held = 0;
  let open = 0;
  let openCents = 0;
  let openPriced = 0;
  const byReason = new Map<UnsellableReason, string[]>();
  for (const c of cells) {
    if (c.reason === 'stay') booked++;
    else if (c.reason === 'block' || c.reason === 'closed') held++;
    else if (c.reason == null) {
      open++;
      if (c.priceCents != null) {
        openCents += c.priceCents;
        openPriced++;
      }
    }
    if (c.reason && c.reason !== 'stay' && c.reason !== 'block' && c.reason !== 'past' && c.date >= today) {
      const list = byReason.get(c.reason) ?? [];
      list.push(c.date);
      byReason.set(c.reason, list);
    }
  }
  const reasons = [...byReason.entries()].map(([reason, dates]) => ({ reason, dates })).sort((a, b) => b.dates.length - a.dates.length);
  return {
    booked,
    held,
    open,
    futureUnsellable: reasons.reduce((n, r) => n + r.dates.length, 0),
    avgOpenCents: openPriced > 0 ? Math.round(openCents / openPriced) : null,
    reasons,
  };
}

/** "Oct 3 to 5, 9, 12 to 14" from sorted ISO dates. */
function compressDates(dates: string[]): string {
  const sorted = [...dates].sort();
  const runs: Array<[string, string]> = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && nextIso(last[1]) === d) last[1] = d;
    else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (a === b ? a.slice(5) : `${a.slice(5)} to ${b.slice(5)}`)).join(', ');
}

function nextIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
}

function monthShort(ym: { year: number; month: number }): string {
  return new Date(Date.UTC(ym.year, ym.month - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

function Tick({ name, label }: { name: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input type="checkbox" name={name} />
      {label}
    </span>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div style={{ padding: '22px 0 20px', borderRight: last ? 'none' : '1px solid var(--rule)', paddingRight: 16 }}>
      <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 34, fontWeight: 300, letterSpacing: '-0.02em', marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: '10px 12px',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  width: '100%',
  fontFamily: 'inherit',
};

const primaryButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '10px 20px',
  border: 'none',
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '7px 14px',
  border: '1px solid var(--ink)',
  textDecoration: 'none',
};

const ghostButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '6px 0',
  border: 'none',
  textDecoration: 'none',
};
