import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { CopyableUrl } from '../listings/CopyableUrl';
import { getFleetProperty } from '@/lib/fleet';
import { regionLabel } from '@/lib/property-scope';
import {
  anonymousPulls,
  listAutomationSendsForProperty,
  listBookingsForProperty,
  loadFeedHealth,
  type AutomationSendRow,
  type BookingEx,
  type FeedHealth,
} from '@/lib/channels';
import { evaluateCutoverPreflight, listPmsEvents, loadCutoverFacts, type CutoverCheck, type CutoverPreflight, type PmsEvent } from '@/lib/cutover';
import { loadPricingBundle, type PricingBundle } from '@/lib/property-rates';
import { loadCalendarDayMap } from '@/lib/calendar-days';
import { isOpenOn } from '@/lib/rental-periods';
import { shiftIsoDay, todayInEastern } from '@/lib/sca-quotes-types';
import {
  authorityBadge,
  buildCalendarBars,
  buildCalendarCells,
  buildMonthGrid,
  channelColor,
  importFreshness,
  monthKey,
  monthOf,
  parseMonthParam,
  pullFreshness,
  relativeAge,
  shiftMonth,
  sourceGlyph,
  type Freshness,
} from '@/lib/calendar-model';
import { CHANNEL_LABELS, PRIMARY_CHANNELS, STATUS_LABELS, type BookingChannel } from '@/lib/channels-types';
import { type CalendarRowVM } from '../calendar/MultiCalendarGrid';
import { PropertyMonthCalendar } from './PropertyMonthCalendar';
import { flipCalendarAuthorityAction } from './cutover-actions';
import { syncOneListing, tickExportSubscribed } from '../listings/actions';

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

export default async function ChannelsPropertyPage({
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

  const windowStart = shiftIsoDay(today, -90);
  const windowEnd = shiftIsoDay(today, 400);
  const gridStart = grid.gridStart < windowStart ? grid.gridStart : windowStart;
  const gridEnd = grid.gridEnd > windowEnd ? grid.gridEnd : windowEnd;

  const [bookings, feeds, anonPulls, sends, events, factsOrError, bundle, mirror] = await Promise.all([
    safe(() => listBookingsForProperty(propertyId, gridStart, gridEnd), [] as BookingEx[]),
    safe(() => loadFeedHealth(propertyId), [] as FeedHealth[]),
    safe(() => anonymousPulls(propertyId), []),
    safe(() => listAutomationSendsForProperty(propertyId, now.toISOString(), new Date(now.getTime() + 14 * 86_400_000).toISOString()), [] as AutomationSendRow[]),
    safe(() => listPmsEvents(propertyId), [] as PmsEvent[]),
    loadCutoverFacts(propertyId).then(
      (facts) => ({ facts, error: null as string | null }),
      (err: unknown) => ({ facts: null, error: err instanceof Error ? err.message : String(err) }),
    ),
    helmRun ? safe(() => loadPricingBundle(propertyId, grid.gridStart, grid.gridEnd), null as PricingBundle | null) : Promise.resolve(null as PricingBundle | null),
    helmRun ? Promise.resolve(null) : safe(() => loadCalendarDayMap([propertyId], grid.gridStart, grid.gridEnd), null),
  ]);

  const preflight: CutoverPreflight | null = factsOrError.facts ? evaluateCutoverPreflight(factsOrError.facts) : null;
  const activeDirectFeeds = feeds.filter((f) => f.is_active && !!f.ical_import_url && f.channel !== 'guesty');
  const badge = authorityBadge(property, activeDirectFeeds.length > 0);

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'helm.risingtidestr.com';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const exportUrl = property.ical_export_token ? `${proto}://${host}/api/channels/ical/${property.ical_export_token}` : null;

  const live = bookings.filter((b) => b.status !== 'cancelled');
  const upcoming = live.filter((b) => b.check_out > today && b.status !== 'block').sort((a, b) => a.check_in.localeCompare(b.check_in));
  const recent = live
    .filter((b) => b.check_out <= today && b.status !== 'block')
    .sort((a, b) => b.check_out.localeCompare(a.check_out))
    .slice(0, 10);
  const stats = computeStats(live, today);

  // The month grid row, same shape the multi-calendar draws.
  const gridDates = grid.cells.map((c) => c.date);
  const oldestImport = activeDirectFeeds.length > 0 || feeds.some((f) => f.is_active && f.ical_import_url)
    ? feeds.filter((f) => f.is_active && f.ical_import_url).map((f) => f.last_imported_at).sort((a, b) => (a ?? '').localeCompare(b ?? ''))[0] ?? null
    : undefined;
  const lastPull = helmRun ? feeds.map((f) => f.last_pull?.pulled_at ?? null).filter(Boolean).sort().reverse()[0] ?? null : undefined;
  const rowVM: CalendarRowVM = {
    property: {
      id: property.id,
      name: property.name,
      region: property.region,
      regionLabel: regionLabel(property.region),
      calendarAuthority: property.calendar_authority,
      helmRun,
      badgeLabel: badge.label,
      badgeKind: badge.kind,
      freshness: worst(importFreshness(oldestImport ?? null, now), lastPull === undefined ? null : pullFreshness(lastPull, now)),
      freshnessDetail: '',
      hasPlan: !!bundle?.plan,
    },
    cells: buildCalendarCells({
      dates: gridDates,
      bookings: live,
      calendarAuthority: property.calendar_authority,
      plan: bundle?.plan ?? null,
      rateDays: bundle?.days,
      mirror: mirror?.get(propertyId),
      isOpen: bundle ? (d) => isOpenOn(bundle.periods, d) : undefined,
      today,
      now,
      timeZone: property.timezone,
    }),
    bars: buildCalendarBars(live, { start: grid.gridStart, end: grid.gridEnd }, (c) => CHANNEL_LABELS[c as BookingChannel] ?? c),
  };

  const prev = shiftMonth(ym.year, ym.month, -1);
  const next = shiftMonth(ym.year, ym.month, 1);
  const flipped = one(sp.flipped);
  const flipNote = one(sp.flip_note);
  const flipError = one(sp.flip_error);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow={`Helm · Channels · ${property.name}`}
        title={property.name}
        emphasis={property.title ?? ''}
        description={`${[property.address, property.city, regionLabel(property.region)].filter(Boolean).join(' · ')}. Who runs this home today, what each OTA sees and when, and exactly what would break if you flipped it.`}
        belowDescription={
          <div style={{ marginTop: 14 }}>
            <Badge badge={badge} />
          </div>
        }
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButton}>← Channels</Link>
          <Link href={`/properties/${propertyId}`} style={ghostButton}>Property record →</Link>
          <Link href={`/channels/${propertyId}/calendar?month=${monthKey(ym.year, ym.month)}`} style={ghostButton}>Month grid →</Link>
          <Link href={`/book/${propertyId}`} target="_blank" style={ghostButton}>Public booking page ↗</Link>
          <span style={{ flex: 1 }} />
          <Link href={`/channels/bookings/new?property=${propertyId}`} style={primaryButton}>+ Booking</Link>
          <Link href={`/channels/bookings/new?property=${propertyId}&type=block`} style={secondaryButton}>+ Block</Link>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Stat label="Stays this month" value={String(stats.bookingsThisMonth)} />
          <Stat label="Upcoming" value={String(upcoming.length)} sub="next 400 days" />
          <Stat label="Occupancy · 30d" value={`${stats.occupancyNext30}%`} sub={`${stats.bookedNightsNext30}/30 nights`} />
          <Stat label="Feeds importing" value={`${activeDirectFeeds.length}`} sub={`${feeds.filter((f) => f.is_active).length} channel rows`} last />
        </div>
      </section>

      {/* ── Cutover panel ─────────────────────────────────────────────── */}
      <section id="cutover" className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14, color: helmRun ? 'var(--positive)' : 'var(--signal)' }}>Cutover</div>
        <div style={{ borderTop: `2px solid ${helmRun ? 'var(--positive)' : 'var(--signal)'}`, paddingTop: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 1fr)', gap: 36 }}>
            <div>
              <h2 className="font-serif" style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-0.01em', margin: '0 0 8px' }}>
                {helmRun ? 'Helm runs this home.' : 'Guesty runs this home.'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560, margin: '0 0 18px' }}>
                {helmRun
                  ? `Since ${property.cutover_at ? fmtStamp(property.cutover_at) : 'the flip'}. Every Guesty pass skips it, Helm writes its calendar mirror, Helm's rate plan prices it, and the OTAs read Helm's export.`
                  : badge.kind === 'shadow'
                  ? 'Shadow mode: Helm imports the OTA feeds directly so its calendar is populated before the flip, while Guesty stays authoritative. Each check below must be green before the switch.'
                  : 'Helm mirrors Guesty. Wire the OTA feeds on the wiring page to enter shadow mode; each check below must be green before the switch.'}
              </p>

              {(flipped || flipError) && (
                <div
                  style={{
                    borderLeft: `3px solid ${flipError ? 'var(--negative)' : 'var(--positive)'}`,
                    padding: '12px 16px',
                    background: 'var(--paper-2)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    marginBottom: 18,
                    color: flipError ? 'var(--negative)' : 'var(--ink)',
                  }}
                >
                  {flipError || flipNote || (flipped === 'helm' ? 'Flipped to Helm.' : 'Reverted to Guesty.')}
                </div>
              )}

              {factsOrError.error && (
                <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--negative)', marginBottom: 18 }}>
                  Preflight could not load: {factsOrError.error}
                </div>
              )}

              {preflight && (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--rule)' }}>
                  {preflight.checks.map((c) => (
                    <CheckRow key={c.key} check={c} />
                  ))}
                </ol>
              )}
            </div>

            <div>
              {!helmRun && preflight && (
                <form action={flipCalendarAuthorityAction} style={{ border: '1px solid var(--ink)', padding: '20px 20px 22px', background: 'var(--paper)' }}>
                  <input type="hidden" name="property_id" value={propertyId} />
                  <input type="hidden" name="target" value="helm" />
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Flip to Helm</div>
                  {preflight.dataOk ? (
                    <>
                      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 14px' }}>
                        The six data checks are green. Tick the two acknowledgements, type the property id, and flip. The action retires any Guesty aggregate feed row, parks the Guesty listing id, sets Helm as authority, writes the audit event and rebuilds the calendar mirror for today-90 to today+540.
                      </p>
                      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.45, marginBottom: 10 }}>
                        <input type="checkbox" name="ack_automations" required style={{ marginTop: 2 }} />
                        <span>I reviewed the automation rules for this home on the Automations tab.</span>
                      </label>
                      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.45, marginBottom: 14 }}>
                        <input type="checkbox" name="ack_guesty_disconnect" required style={{ marginTop: 2 }} />
                        <span>The Airbnb, VRBO and Booking.com connections are disconnected in Guesty and each OTA imports Helm&apos;s export.</span>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                        <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>Type the property id to confirm</span>
                        <input name="confirm" type="text" required pattern={escapeForPattern(propertyId)} placeholder={propertyId} autoComplete="off" className="font-mono" style={inputStyle} />
                      </label>
                      <SubmitButton label="Flip to Helm" busyLabel="Flipping…" style={{ ...primaryButton, width: '100%', justifyContent: 'center' }} />
                    </>
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
                      The Flip button appears once every data check is green. Red rows say what to fix and where.
                    </p>
                  )}
                </form>
              )}

              <form action={flipCalendarAuthorityAction} style={{ border: '1px dashed var(--rule)', padding: '18px 20px 20px', marginTop: helmRun ? 0 : 16, background: 'var(--paper-2)' }}>
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="target" value="guesty" />
                <div className="eyebrow" style={{ marginBottom: 10 }}>Revert to Guesty</div>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 12px' }}>
                  {helmRun
                    ? "Sets the switch back and restores the parked Guesty listing id. It does not recreate the listing in Guesty, reconnect any channel, or undo anything done in Guesty or the OTAs. The next Guesty calendar sync overwrites Helm's mirror rows for this home only if the listing still exists in Guesty; until then the Helm rows stand."
                    : 'Guesty already runs this home; there is nothing to revert. The button stays here so the path back is always visible.'}
                </p>
                <SubmitButton
                  label="Revert to Guesty"
                  busyLabel="Reverting…"
                  spinnerTone="ink"
                  disabled={!helmRun}
                  style={{ ...secondaryButton, width: '100%', justifyContent: 'center', opacity: helmRun ? 1 : 0.5 }}
                />
              </form>
            </div>
          </div>

          <div style={{ marginTop: 28 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>History</div>
            {events.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: 0 }}>No flips recorded for this home.</p>
            ) : (
              <div style={{ borderTop: '1px solid var(--rule)' }}>
                {events.map((e) => (
                  <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '170px 160px 1fr', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 12, alignItems: 'baseline' }}>
                    <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtStamp(e.created_at)}</span>
                    <span>
                      <span style={{ color: 'var(--ink-3)' }}>{e.from_authority}</span> → <strong style={{ color: e.to_authority === 'helm' ? 'var(--positive)' : 'var(--ink)' }}>{e.to_authority}</strong>
                    </span>
                    <span style={{ color: 'var(--ink-3)' }}>
                      {e.actor_email}
                      {Object.keys(e.detail).length > 0 && (
                        <span className="font-mono" style={{ marginLeft: 10, fontSize: 11, color: 'var(--ink-4)' }}>
                          {Object.entries(e.detail).map(([k, v]) => `${k}=${String(v)}`).join(' ')}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Month grid ────────────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="eyebrow">Calendar</div>
          <Link href={`/channels/${propertyId}?month=${monthKey(prev.year, prev.month)}#calendar`} style={ghostButton}>← {monthShort(prev)}</Link>
          <Link href={`/channels/${propertyId}?month=${monthKey(monthOf(today).year, monthOf(today).month)}#calendar`} style={ghostButton}>Today</Link>
          <Link href={`/channels/${propertyId}?month=${monthKey(next.year, next.month)}#calendar`} style={ghostButton}>{monthShort(next)} →</Link>
          <span className="font-serif" style={{ fontSize: 20 }}>{grid.label}</span>
          <span style={{ flex: 1 }} />
          <Link href={`/channels/${propertyId}/calendar?month=${monthKey(ym.year, ym.month)}`} style={ghostButton}>Full month grid →</Link>
        </div>
        <div id="calendar">
          <PropertyMonthCalendar row={rowVM} weeks={grid.weeks.map((w) => w.map((c) => c.date))} monthStart={grid.start} monthEnd={grid.end} today={today} monthLabel={grid.label} compact />
        </div>
      </section>

      {/* ── Feed health ───────────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Channels</div>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {orderedFeeds(feeds).map(({ channel, feed }) => (
            <FeedRow key={channel} channel={channel} feed={feed} helmRun={helmRun} now={now} />
          ))}
        </div>
        {anonPulls.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
            {anonPulls.length} recent pull{anonPulls.length === 1 ? '' : 's'} of the export came from a client the user agent did not identify (last {relativeAge(anonPulls[0].pulled_at, now)}).
          </p>
        )}
      </section>

      {exportUrl && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Helm → channels · the export every OTA should import</div>
          <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12, maxWidth: 720, lineHeight: 1.55 }}>
              Canonical confirmed, completed and block rows only, no guest names. Every pull is logged, and the last pull per OTA is the second dot on each channel row above. After the flip this feed is the only thing keeping Airbnb, VRBO and Booking.com from selling the same night twice.
            </p>
            <CopyableUrl value={exportUrl} />
          </div>
        </section>
      )}

      {/* ── Stays ─────────────────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Upcoming · {upcoming.length} stay{upcoming.length === 1 ? '' : 's'}</div>
        {upcoming.length > 0 ? <BookingsTable bookings={upcoming.slice(0, 20)} today={today} /> : <EmptyState message="No upcoming stays on the books." />}
        {upcoming.length > 20 && (
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
            Showing 20 of {upcoming.length}. <Link href={`/channels/bookings?property=${propertyId}`} style={{ color: 'var(--ink)' }}>All stays for this home →</Link>
          </p>
        )}
      </section>

      {recent.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Recent · last {recent.length}</div>
          <BookingsTable bookings={recent} today={today} dimmed />
        </section>
      )}

      {/* ── Automation sends ──────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Automation sends · next 14 days</div>
        {sends.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0', fontSize: 13, color: 'var(--ink-3)' }}>
            Nothing scheduled.{' '}
            {!property.automations_enabled && (
              <>
                Automations are off for this home{helmRun ? '' : ' and only run once Helm is the calendar authority'}.{' '}
                <Link href={`/properties/${propertyId}?tab=automations`} style={{ color: 'var(--ink)' }}>Automations tab →</Link>
              </>
            )}
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {sends.map((s) => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '150px 160px 1fr 130px', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--rule)', fontSize: 12, alignItems: 'baseline' }}>
                <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtStamp(s.fire_at)}</span>
                <span style={{ fontWeight: 600, letterSpacing: '.04em' }}>{(s.automation_key ?? s.trigger ?? 'rule').replace(/_/g, ' ')}</span>
                <span style={{ color: 'var(--ink-3)' }}>
                  <Link href={`/channels/bookings/${s.booking_id}`} style={{ color: 'var(--ink)' }}>
                    {s.planned_check_in} to {s.planned_check_out}
                  </Link>
                  {s.to_address ? ` · ${s.to_address}` : ''}
                  {s.missing_fields.length > 0 ? ` · missing ${s.missing_fields.join(', ')}` : ''}
                  {s.error ? ` · ${s.error}` : ''}
                </span>
                <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', textAlign: 'right', color: sendTone(s.status) }}>{s.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Tiles to the property record ──────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>On the property record</div>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Tile href={`/properties/${propertyId}?tab=rates`} title="Rates and policies" body={bundle?.plan ? `Base $${Math.round(bundle.plan.base_nightly_cents / 100)} a night, ${bundle.plan.min_nights_default} night minimum, cleaning $${Math.round(bundle.plan.cleaning_fee_cents / 100)}.` : helmRun ? 'No rate plan yet. Helm cannot price a night without one.' : 'The plan Helm will price from after the flip; the seed mirrors Guesty.'} />
          <Tile href={`/properties/${propertyId}?tab=listing`} title="Listing content" body="Title, summary, the space, rooms and beds, amenities and photos: the guest-facing record Helm feeds to staycapeann.com." />
          <Tile href={`/properties/${propertyId}?tab=automations`} title="Automations" body={property.automations_enabled ? 'On for this home. Fleet defaults with per-property overrides; sends need approval unless a rule says auto.' : 'Off for this home. Review the fleet rules and overrides before the flip.'} last />
        </div>
      </section>

      <HelmFooter module={`Channels · ${property.name}`} right={badge.label} />
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Badge({ badge }: { badge: ReturnType<typeof authorityBadge> }) {
  const color = badge.kind === 'helm' ? 'var(--positive)' : badge.kind === 'shadow' ? 'var(--signal)' : 'var(--ink-3)';
  return (
    <span
      title={badge.detail}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: `1px solid ${color}`,
        color,
        padding: '5px 12px',
        fontSize: 10,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {badge.label}
    </span>
  );
}

function CheckRow({ check }: { check: CutoverCheck }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--rule)', alignItems: 'start' }}>
      <span
        aria-label={check.ok ? 'green' : 'red'}
        style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: check.ok ? 'var(--positive)' : 'var(--negative)', marginTop: 3 }}
      />
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{check.label}</span>
          {check.acknowledgement && <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>your tick</span>}
          {check.href && !check.ok && (
            <Link href={check.href} style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'underline' }}>
              fix →
            </Link>
          )}
        </div>
        <div style={{ fontSize: 12, color: check.ok ? 'var(--ink-3)' : 'var(--negative)', lineHeight: 1.5, marginTop: 2 }}>{check.detail}</div>
      </div>
    </li>
  );
}

function orderedFeeds(feeds: FeedHealth[]): Array<{ channel: string; feed: FeedHealth | undefined }> {
  const out: Array<{ channel: string; feed: FeedHealth | undefined }> = PRIMARY_CHANNELS.map((c) => ({ channel: c, feed: feeds.find((f) => f.channel === c) }));
  for (const f of feeds) {
    if (!(PRIMARY_CHANNELS as string[]).includes(f.channel)) out.push({ channel: f.channel, feed: f });
  }
  return out;
}

function dotColor(f: Freshness): string {
  return f === 'fresh' ? 'var(--positive)' : f === 'aging' ? 'var(--signal)' : f === 'stale' ? 'var(--negative)' : 'var(--rule)';
}

function FeedRow({ channel, feed, helmRun, now }: { channel: string; feed: FeedHealth | undefined; helmRun: boolean; now: Date }) {
  const isDirect = channel === 'direct';
  const isGuesty = channel === 'guesty';
  const label = CHANNEL_LABELS[channel as BookingChannel] ?? channel;
  const importState: Freshness = !feed || !feed.ical_import_url ? 'never' : feed.last_import_status === 'error' ? 'stale' : importFreshness(feed.last_imported_at, now);
  const pullState: Freshness = feed?.last_pull ? pullFreshness(feed.last_pull.pulled_at, now) : 'never';
  const subtitle = !feed
    ? 'not configured'
    : isDirect
    ? 'Direct stays land in Helm; no inbound feed'
    : !feed.is_active
    ? `retired${feed.updated_at ? ` ${relativeAge(feed.updated_at, now)}` : ''}`
    : !feed.ical_import_url
    ? 'iCal URL not set'
    : feed.last_import_status === 'error'
    ? `error ${relativeAge(feed.last_imported_at, now)}: ${feed.last_import_error ?? 'unknown'}`
    : feed.last_imported_at
    ? `imported ${relativeAge(feed.last_imported_at, now)} · ${feed.last_import_event_count ?? 0} events`
    : 'configured · awaiting first sync';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 220px 190px auto', gap: 14, padding: '13px 0', alignItems: 'baseline', borderBottom: '1px solid var(--rule)', opacity: feed && !feed.is_active ? 0.6 : 1 }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ display: 'inline-block', width: 6, height: 18, background: channelColor(channel, false), transform: 'translateY(3px)' }} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase' }}>{label}</span>
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        {!isDirect && <Dot color={dotColor(importState)} title={`Helm import: ${importState}`} />}
        <span>{subtitle}</span>
        {feed?.external_listing_url && (
          <a href={feed.external_listing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-3)', textDecoration: 'underline' }}>
            open in {label} ↗
          </a>
        )}
        {feed?.external_listing_id && <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{feed.external_listing_id}</span>}
        {feed && !isDirect && !isGuesty && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>rates: {feed.rates_managed_by}</span>}
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
        {feed && !isDirect && !isGuesty ? (
          <>
            <Dot color={dotColor(pullState)} title={`OTA pull of Helm's export: ${pullState}`} />
            <span>{feed.last_pull ? `pulled ${relativeAge(feed.last_pull.pulled_at, now)}` : helmRun ? 'never pulled Helm' : 'reads Guesty, not Helm'}</span>
          </>
        ) : (
          <span style={{ color: 'var(--ink-4)' }}>-</span>
        )}
      </span>
      <span style={{ fontSize: 11 }}>
        {feed && !isDirect && !isGuesty ? (
          <form action={tickExportSubscribed} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
            <input type="hidden" name="id" value={feed.id} />
            <input type="hidden" name="export_subscribed" value={feed.export_subscribed ? 'false' : 'true'} />
            <SubmitButton
              label={feed.export_subscribed ? '☑ imports Helm' : '☐ imports Helm'}
              busyLabel="Saving…"
              spinnerTone="ink"
              style={{ ...linkButton, color: feed.export_subscribed ? 'var(--positive)' : 'var(--ink-3)' }}
            />
            {feed.export_subscribed && feed.export_subscribed_at && <span style={{ color: 'var(--ink-4)' }}>{feed.export_subscribed_at.slice(0, 10)}</span>}
          </form>
        ) : (
          <span style={{ color: 'var(--ink-4)' }}>-</span>
        )}
      </span>
      <span style={{ display: 'inline-flex', gap: 12, alignItems: 'baseline' }}>
        {feed && feed.is_active && feed.ical_import_url && (
          <form action={syncOneListing}>
            <input type="hidden" name="id" value={feed.id} />
            <SubmitButton label="sync" busyLabel="syncing…" spinnerTone="ink" style={linkButton} />
          </form>
        )}
        <Link href="/channels/listings" style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'underline' }}>
          wiring →
        </Link>
      </span>
    </div>
  );
}

function Dot({ color, title }: { color: string; title: string }) {
  return <span title={title} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, border: color === 'var(--rule)' ? '1px solid var(--ink-4)' : 'none', transform: 'translateY(1px)' }} />;
}

function BookingsTable({ bookings, today, dimmed = false }: { bookings: BookingEx[]; today: string; dimmed?: boolean }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', opacity: dimmed ? 0.75 : 1 }}>
      {bookings.map((b) => {
        const g = sourceGlyph(b);
        const inHouse = b.check_in <= today && b.check_out > today;
        return (
          <Link key={b.id} href={`/channels/bookings/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '12px 24px 190px 1fr 70px 90px 100px', gap: 12, padding: '11px 0', alignItems: 'baseline', borderBottom: '1px solid var(--rule)' }}>
              <span style={{ display: 'inline-block', width: 6, height: 20, background: channelColor(b.channel, b.status === 'block'), transform: 'translateY(3px)' }} />
              <span title={g.label} style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>{g.glyph}</span>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {b.check_in} → {b.check_out}
              </span>
              <span style={{ fontSize: 13 }}>
                {b.guest_name ?? <em style={{ color: 'var(--ink-4)' }}>{CHANNEL_LABELS[b.channel] ?? b.channel} stay</em>}
                {inHouse && <span className="eyebrow" style={{ marginLeft: 10, color: 'var(--positive)' }}>in house</span>}
                {b.external_confirmation_code && <span className="font-mono" style={{ marginLeft: 10, fontSize: 10, color: 'var(--ink-4)' }}>{b.external_confirmation_code}</span>}
              </span>
              <span className="tabular-nums" style={{ fontSize: 12, textAlign: 'right' }}>{b.nights ?? '-'} nts</span>
              <span style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'right', color: 'var(--ink-3)' }}>{CHANNEL_LABELS[b.channel] ?? b.channel}</span>
              <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', textAlign: 'right', color: 'var(--ink-3)' }}>{STATUS_LABELS[b.status] ?? b.status}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Tile({ href, title, body, last }: { href: string; title: string; body: string; last?: boolean }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit', padding: '20px 18px 22px 0', borderRight: last ? 'none' : '1px solid var(--rule)', marginRight: last ? 0 : 18, display: 'block' }}>
      <div className="font-serif" style={{ fontSize: 20, fontWeight: 400, marginBottom: 6 }}>{title} →</div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>{body}</p>
    </Link>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '32px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)', fontSize: 14, margin: 0 }}>{message}</p>
    </div>
  );
}

function Stat({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div style={{ padding: '24px 0 22px', borderRight: last ? 'none' : '1px solid var(--rule)', paddingRight: 16 }}>
      <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.02em', marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

type Stats = { bookingsThisMonth: number; occupancyNext30: number; bookedNightsNext30: number };

function computeStats(bookings: BookingEx[], todayIso: string): Stats {
  const today = new Date(`${todayIso}T00:00:00Z`);
  const monthStart = todayIso.slice(0, 7) + '-01';
  const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + 30 * 86400_000);
  let bookingsThisMonth = 0;
  let bookedNightsNext30 = 0;
  for (const b of bookings) {
    if (b.status !== 'confirmed' && b.status !== 'completed') continue;
    if (b.check_in >= monthStart && b.check_in < nextMonth) bookingsThisMonth++;
    const ci = new Date(`${b.check_in}T00:00:00Z`);
    const co = new Date(`${b.check_out}T00:00:00Z`);
    const start = ci > today ? ci : today;
    const end = co < horizon ? co : horizon;
    if (end > start) bookedNightsNext30 += Math.round((end.getTime() - start.getTime()) / 86400_000);
  }
  return { bookingsThisMonth, occupancyNext30: Math.round((bookedNightsNext30 / 30) * 100), bookedNightsNext30 };
}

function worst(a: Freshness, b: Freshness | null): Freshness {
  if (!b) return a;
  const rank: Record<Freshness, number> = { fresh: 0, aging: 1, stale: 2, never: 3 };
  return rank[b] > rank[a] ? b : a;
}

function sendTone(status: string): string {
  if (status === 'sent') return 'var(--positive)';
  if (status === 'failed' || status.startsWith('skipped')) return 'var(--negative)';
  if (status === 'awaiting_approval') return 'var(--signal)';
  return 'var(--ink-3)';
}

function fmtStamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function monthShort(ym: { year: number; month: number }): string {
  return new Date(Date.UTC(ym.year, ym.month - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

/** Property ids are [a-z0-9_]; escape anyway so the HTML pattern can never break. */
function escapeForPattern(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


const inputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: '10px 12px',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  width: '100%',
};

const primaryButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '9px 16px',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '8px 16px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
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

const linkButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  textDecoration: 'underline',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};
