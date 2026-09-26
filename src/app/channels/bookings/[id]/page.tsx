import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { getFleetProperty } from '@/lib/fleet';
import {
  getBookingEx,
  getBookingFinance,
  getGuestLite,
  listAutomationSendsForBooking,
  listEchoesOf,
  listThreadsForBooking,
  type BookingEx,
} from '@/lib/channels';
import { countDownstreamArtifacts, listBookingEvents, type BookingEventRow, type DownstreamArtifacts } from '@/lib/bookings-write';
import { conflictFromSearchParams, describeConflict } from '@/lib/bookings-write-core';
import { BOOKING_STATUSES, CHANNEL_LABELS, STATUS_LABELS, type BookingFinance, type BookingStatus } from '@/lib/channels-types';
import { authorityBadge, channelColor, relativeAge, sourceGlyph } from '@/lib/calendar-model';
import { cancelBookingWithReason, updateBooking } from './actions';
import { DeleteBookingButton } from './DeleteBookingButton';

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

export default async function BookingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const booking = await getBookingEx(id);
  if (!booking) notFound();

  const now = new Date();
  const conflict = conflictFromSearchParams(sp);
  const kept = one(sp.kept) === 'cancelled';

  const [property, events, finance, sends, threads, guest, echoes, artifacts, parent] = await Promise.all([
    getFleetProperty(booking.property_id),
    safe(() => listBookingEvents(id), [] as BookingEventRow[]),
    safe(() => getBookingFinance(id), null as BookingFinance | null),
    safe(() => listAutomationSendsForBooking(id), []),
    safe(() => listThreadsForBooking(id), []),
    booking.guest_id ? safe(() => getGuestLite(booking.guest_id!), null) : Promise.resolve(null),
    safe(() => listEchoesOf(id), [] as BookingEx[]),
    safe(() => countDownstreamArtifacts(id), null as DownstreamArtifacts | null),
    booking.duplicate_of ? safe(() => getBookingEx(booking.duplicate_of!), null) : Promise.resolve(null),
  ]);

  const isBlock = booking.status === 'block';
  const isCancelled = booking.status === 'cancelled';
  const glyph = sourceGlyph(booking);
  const deletable = isBlock || (booking.status === 'inquiry' && !!artifacts && artifacts.total === 0 && artifacts.unknown.length === 0);
  const deleteReason = isBlock
    ? undefined
    : booking.status === 'inquiry'
    ? artifacts
      ? artifacts.total > 0
        ? `${artifacts.total} downstream artifact${artifacts.total === 1 ? '' : 's'} reference it`
        : `${artifacts.unknown.join(', ')} could not be checked`
      : 'the artifact tables could not be checked'
    : `a ${booking.status} booking is history, not a typo`;
  const statusChoices: BookingStatus[] = isBlock ? ['block'] : BOOKING_STATUSES.filter((s) => s !== 'block' && s !== 'cancelled');
  const feedMoves = events.filter((e) => e.kind === 'feed_moved' || e.kind === 'dates_changed');
  const title = isBlock ? `${booking.hold_kind ? cap(booking.hold_kind) : 'Hold'}${booking.notes ? `: ${booking.notes}` : ''}` : booking.guest_name ?? `${CHANNEL_LABELS[booking.channel] ?? booking.channel} stay`;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow={`Helm · Channels · ${isBlock ? 'Hold' : 'Booking'}`}
        title={title}
        emphasis={`at ${property?.name ?? booking.property_id}.`}
        description={`${booking.check_in} to ${booking.check_out} · ${booking.nights ?? '?'} night${booking.nights === 1 ? '' : 's'} · ${CHANNEL_LABELS[booking.channel] ?? booking.channel} · ${glyph.label}${booking.external_confirmation_code ? ` · ${booking.external_confirmation_code}` : ''}`}
        belowDescription={
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: channelColor(booking.channel, isBlock) }} />
            <span style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, color: isCancelled ? 'var(--negative)' : 'var(--ink-3)' }}>{STATUS_LABELS[booking.status] ?? booking.status}</span>
            {property && (
              <span style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, color: property.calendar_authority === 'helm' ? 'var(--positive)' : 'var(--ink-4)' }}>
                {authorityBadge(property, false).label}
              </span>
            )}
            {isCancelled && booking.cancel_reason && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>reason: {booking.cancel_reason}{booking.cancelled_by ? ` (${booking.cancelled_by})` : ''}</span>}
          </div>
        }
      />

      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingBottom: 20 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels/bookings" style={ghostButton}>← Bookings</Link>
          <Link href={`/channels/${booking.property_id}`} style={ghostButton}>{property?.name ?? 'Property'} hub →</Link>
          <Link href={`/channels/${booking.property_id}/calendar?month=${booking.check_in.slice(0, 7)}`} style={ghostButton}>Month grid →</Link>
          {guest && <Link href={`/channels/bookings?guest=${guest.id}`} style={ghostButton}>Guest&apos;s stays →</Link>}
        </div>
      </section>

      {booking.duplicate_of && (
        <Banner tone="signal">
          <strong>Echo.</strong> This row is the same physical stay as{' '}
          <Link href={`/channels/bookings/${booking.duplicate_of}`} style={{ color: 'var(--ink)' }}>
            {parent ? `${parent.guest_name ?? CHANNEL_LABELS[parent.channel] ?? parent.channel} · ${parent.check_in} to ${parent.check_out}` : booking.duplicate_of}
          </Link>
          , seen through another source. It is hidden from the calendar, the counts and the export; the canonical row carries the stay.
        </Banner>
      )}
      {conflict && (
        <Banner tone="negative">
          <strong>The move was refused.</strong> {describeConflict(conflict)}{' '}
          <Link href={`/channels/bookings/${conflict.booking_id}`} style={{ color: 'var(--ink)' }}>Open that stay.</Link> The other fields were saved.
        </Banner>
      )}
      {kept && (
        <Banner tone="signal">
          Kept as cancelled rather than deleted: {booking.cancel_reason ?? 'the row has history behind it'}.
        </Banner>
      )}

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>{isBlock ? 'The hold' : 'The stay'}</div>
        <form action={updateBooking} style={{ borderTop: '1px solid var(--ink)', paddingTop: 18, display: 'grid', gap: 18 }}>
          <input type="hidden" name="id" value={booking.id} />

          <Row>
            <Field label="Check-in" required>
              <input name="check_in" type="date" required defaultValue={booking.check_in} style={inputStyle} disabled={isCancelled} />
            </Field>
            <Field label="Check-out" required>
              <input name="check_out" type="date" required defaultValue={booking.check_out} style={inputStyle} disabled={isCancelled} />
            </Field>
            <Field label="Status">
              {isCancelled ? (
                <input value="cancelled" readOnly style={{ ...inputStyle, color: 'var(--negative)' }} />
              ) : (
                <select name="status" defaultValue={booking.status} style={selectStyle}>
                  {statusChoices.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Channel (provenance)">
              <input value={CHANNEL_LABELS[booking.channel] ?? booking.channel} readOnly style={{ ...inputStyle, color: 'var(--ink-3)' }} />
            </Field>
          </Row>
          <p style={{ fontSize: 11, color: 'var(--ink-4)', margin: '-8px 0 0', lineHeight: 1.5 }}>
            Moving the dates or the status runs through the locked writer; the database refuses a move onto nights another stay holds and names it. Cancelling is its own step below, with a reason.
          </p>

          {!isBlock && (
            <>
              <div className="eyebrow" style={{ marginTop: 4 }}>Guest</div>
              <Field label="Name">
                <input name="guest_name" type="text" defaultValue={booking.guest_name ?? ''} style={inputStyle} />
              </Field>
              <Row>
                <Field label="Email">
                  <input name="guest_email" type="email" defaultValue={booking.guest_email ?? ''} style={inputStyle} />
                </Field>
                <Field label="Phone">
                  <input name="guest_phone" type="tel" defaultValue={booking.guest_phone ?? ''} style={inputStyle} />
                </Field>
                <Field label="Guests">
                  <input name="num_guests" type="number" min="1" defaultValue={booking.num_guests ?? ''} style={inputStyle} />
                </Field>
              </Row>
              {guest && (
                <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '-6px 0 0' }}>
                  Guest record: {[guest.first_name, guest.last_name].filter(Boolean).join(' ') || 'unnamed'}{guest.email ? ` · ${guest.email}` : ''}{guest.phone ? ` · ${guest.phone}` : ''}.{' '}
                  <Link href={`/channels/bookings?guest=${guest.id}`} style={{ color: 'var(--ink)' }}>Every stay by this guest →</Link>
                </p>
              )}

              <div className="eyebrow" style={{ marginTop: 4 }}>Money on the booking row</div>
              <Row>
                <Field label="Gross">
                  <input name="gross_amount" type="text" inputMode="decimal" defaultValue={booking.gross_amount ?? ''} style={inputStyle} />
                </Field>
                <Field label="Cleaning">
                  <input name="cleaning_fee" type="text" inputMode="decimal" defaultValue={booking.cleaning_fee ?? ''} style={inputStyle} />
                </Field>
                <Field label="Taxes">
                  <input name="taxes" type="text" inputMode="decimal" defaultValue={booking.taxes ?? ''} style={inputStyle} />
                </Field>
                <Field label="Payout">
                  <input name="payout" type="text" inputMode="decimal" defaultValue={booking.payout ?? ''} style={inputStyle} />
                </Field>
              </Row>
            </>
          )}

          <Field label="Notes">
            <textarea name="notes" rows={3} defaultValue={booking.notes ?? ''} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SubmitButton label="Save" busyLabel="Saving…" formAction={updateBooking} style={primaryButton} />
            <Link href="/channels/bookings" style={secondaryButton}>Back</Link>
            <span style={{ flex: 1 }} />
            <DeleteBookingButton deletable={deletable} reason={deleteReason} />
          </div>
        </form>

        {!isCancelled && (
          <form action={cancelBookingWithReason} style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end', borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
            <input type="hidden" name="id" value={booking.id} />
            <Field label={isBlock ? 'Release this hold, with a reason' : 'Cancel this stay, with a reason'}>
              <input name="reason" type="text" placeholder={isBlock ? 'owner changed plans' : 'guest cancelled by phone; refund issued in Stripe'} style={inputStyle} />
            </Field>
            <SubmitButton label={isBlock ? 'Release hold' : 'Cancel stay'} busyLabel="Cancelling…" spinnerTone="ink" style={{ ...secondaryButton, color: 'var(--negative)', borderColor: 'var(--negative)' }} />
          </form>
        )}
      </section>

      {/* Sub-records */}
      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Money sub-record · booking_finance</div>
            {finance ? (
              <dl className="font-mono" style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '6px 14px', fontSize: 12, margin: 0, borderTop: '1px solid var(--ink)', paddingTop: 12 }}>
                <Term k="source" v={`${finance.money_source} · ${finance.confidence} confidence`} />
                <Term k="gross" v={money(finance.gross_amount)} />
                <Term k="cleaning" v={money(finance.cleaning_fee)} />
                <Term k="taxes" v={money(finance.taxes)} />
                <Term k="channel commission" v={money(finance.channel_commission)} />
                <Term k="stripe fee" v={money(finance.stripe_fee)} />
                <Term k="payout" v={money(finance.payout)} />
                <Term k="reconciled" v={finance.reconciled_at ? relativeAge(finance.reconciled_at, now) : 'not yet'} />
                {finance.notes && <Term k="notes" v={finance.notes} />}
              </dl>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--ink-3)', borderTop: '1px solid var(--ink)', paddingTop: 12, margin: 0, lineHeight: 1.5 }}>
                No booking_finance row. {booking.channel === 'direct' || booking.channel === 'manual' ? 'Typing money above writes one (manual, low confidence) until Stripe settles.' : 'OTA money arrives through its own readers.'} Nothing in the statements pipeline reads this record.
              </p>
            )}
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Threads</div>
            {threads.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-3)', borderTop: '1px solid var(--ink)', paddingTop: 12, margin: 0, lineHeight: 1.5 }}>
                No Helm inbox thread is keyed to this stay yet. Guest messages are in <Link href="/messaging" style={{ color: 'var(--ink)' }}>Messaging</Link>.
              </p>
            ) : (
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {threads.map((t) => (
                  <div key={t.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 10 }}>{t.channel}</span>
                      <span style={{ color: 'var(--ink-4)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>{t.status}</span>
                      <span style={{ flex: 1 }} />
                      {t.external_thread_url ? (
                        <a href={t.external_thread_url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>open in the OTA ↗</a>
                      ) : (
                        <Link href="/messaging" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>open in Messaging →</Link>
                      )}
                    </div>
                    {t.last_preview && <div style={{ color: 'var(--ink-3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last_preview}</div>}
                    <div style={{ color: 'var(--ink-4)', fontSize: 11, marginTop: 2 }}>
                      guest {relativeAge(t.last_guest_at, now)} · host {relativeAge(t.last_host_at, now)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Automation sends */}
      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Automation sends for this stay</div>
        {sends.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-3)', borderTop: '1px solid var(--ink)', paddingTop: 12, margin: 0 }}>None planned. The planner writes a row per enabled rule once the home&apos;s automations are on and Helm runs its calendar.</p>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {sends.map((s) => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '150px 170px 1fr 140px', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 12, alignItems: 'baseline' }}>
                <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtStamp(s.fire_at)}</span>
                <span style={{ fontWeight: 600 }}>{(s.automation_key ?? s.trigger ?? 'rule').replace(/_/g, ' ')}</span>
                <span style={{ color: 'var(--ink-3)' }}>
                  {s.delivery_used ? `${s.delivery_used} ` : ''}{s.to_address ?? ''}
                  {s.missing_fields.length > 0 ? ` · missing ${s.missing_fields.join(', ')}` : ''}
                  {s.error ? ` · ${s.error}` : ''}
                  {s.approved_by ? ` · approved by ${s.approved_by}` : ''}
                </span>
                <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', textAlign: 'right', color: sendTone(s.status) }}>{s.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Downstream artifacts */}
      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>What this stay generated</div>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 12, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          {artifacts ? (
            <>
              {artifacts.total === 0 && artifacts.unknown.length === 0 && <span>Nothing yet in the artifact tables.</span>}
              {Object.entries(artifacts.byTable)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => (
                  <span key={t} className="font-mono" style={{ marginRight: 14 }}>
                    {t} <strong style={{ color: 'var(--ink)' }}>{n}</strong>
                  </span>
                ))}
              {artifacts.unknown.length > 0 && <div style={{ color: 'var(--negative)' }}>Could not read: {artifacts.unknown.join(', ')}.</div>}
              {echoes.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {echoes.length} echo{echoes.length === 1 ? '' : 'es'} folded into this row:{' '}
                  {echoes.map((e, i) => (
                    <span key={e.id}>
                      {i > 0 && ', '}
                      <Link href={`/channels/bookings/${e.id}`} style={{ color: 'var(--ink)' }}>
                        {CHANNEL_LABELS[e.channel] ?? e.channel} · {sourceGlyph(e).label}
                      </Link>
                    </span>
                  ))}
                  .
                </div>
              )}
            </>
          ) : (
            <span>The artifact tables could not be read.</span>
          )}
        </div>
      </section>

      {/* Change log */}
      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Change log · booking_events</div>
        {feedMoves.length > 0 && (
          <div style={{ borderLeft: '3px solid var(--signal)', padding: '10px 14px', background: 'var(--paper-2)', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
            The dates moved {feedMoves.length} time{feedMoves.length === 1 ? '' : 's'}. Latest: {describeMove(feedMoves[0])}. Stored now: {booking.check_in} to {booking.check_out}.
          </div>
        )}
        {events.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-3)', borderTop: '1px solid var(--ink)', paddingTop: 12, margin: 0 }}>No events recorded. Rows written before the change log existed start their history here.</p>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {events.map((e) => (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '150px 130px 1fr', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 12, alignItems: 'baseline' }}>
                <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtStamp(e.at)}</span>
                <span>
                  <span style={{ fontWeight: 600 }}>{e.kind.replace(/_/g, ' ')}</span>
                  <div style={{ color: 'var(--ink-4)', fontSize: 11, wordBreak: 'break-all' }}>{e.actor}</div>
                </span>
                <span className="font-mono" style={{ color: 'var(--ink-3)', fontSize: 11, lineHeight: 1.6 }}>
                  {e.note && <div style={{ fontFamily: 'inherit', color: 'var(--ink)' }}>{e.note}</div>}
                  {diffLines(e).map((l) => (
                    <div key={l}>{l}</div>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <Provenance booking={booking} />

      <HelmFooter module="Channels · Booking" right={`source: ${booking.source}`} />
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Provenance({ booking }: { booking: BookingEx }) {
  return (
    <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Provenance</div>
      <div className="font-mono" style={{ borderTop: '1px solid var(--ink)', paddingTop: 12, display: 'grid', gridTemplateColumns: '220px 1fr', gap: '6px 16px', lineHeight: 1.6, fontSize: 12, color: 'var(--ink-3)' }}>
        <span>source</span><span>{booking.source}</span>
        <span>created_by</span><span>{booking.created_by ?? '-'}</span>
        <span>booked_at</span><span>{booking.booked_at ?? '-'}</span>
        <span>source_ref</span><span style={{ wordBreak: 'break-all' }}>{booking.source_ref ?? '-'}</span>
        <span>external_booking_id</span><span>{booking.external_booking_id ?? '-'}</span>
        <span>external_confirmation_code</span><span>{booking.external_confirmation_code ?? '-'}</span>
        <span>ical_uid</span><span style={{ wordBreak: 'break-all' }}>{booking.ical_uid ?? '-'}</span>
        <span>channel_listing_id</span><span>{booking.channel_listing_id ?? '-'}</span>
        <span>guest_id</span><span>{booking.guest_id ?? '-'}</span>
        <span>duplicate_of</span><span>{booking.duplicate_of ?? '-'}</span>
        <span>first_seen_at</span><span>{booking.first_seen_at}</span>
        <span>last_seen_at</span><span>{booking.last_seen_at}</span>
        <span>created_at</span><span>{booking.created_at}</span>
        <span>updated_at</span><span>{booking.updated_at}</span>
        {booking.cancelled_at && (
          <>
            <span>cancelled_at</span><span>{booking.cancelled_at}</span>
          </>
        )}
        {booking.raw_summary && (
          <>
            <span>raw_summary</span><span>{booking.raw_summary}</span>
          </>
        )}
        {booking.raw_description && (
          <>
            <span>raw_description</span><span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{booking.raw_description.slice(0, 600)}</span>
          </>
        )}
      </div>
    </section>
  );
}

function Banner({ tone, children }: { tone: 'signal' | 'negative'; children: React.ReactNode }) {
  return (
    <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingBottom: 16 }}>
      <div style={{ borderLeft: `3px solid var(--${tone})`, padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, lineHeight: 1.55, color: tone === 'negative' ? 'var(--negative)' : 'var(--ink)' }}>
        {children}
      </div>
    </section>
  );
}

function Term({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: 'var(--ink-4)' }}>{k}</dt>
      <dd style={{ margin: 0, color: 'var(--ink-2)' }}>{v}</dd>
    </>
  );
}

function money(v: number | null | undefined): string {
  if (v == null) return '-';
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function diffLines(e: BookingEventRow): string[] {
  const keys = new Set<string>([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})]);
  const out: string[] = [];
  for (const k of keys) {
    const b = e.before?.[k];
    const a = e.after?.[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    if (e.kind === 'created' || e.kind === 'cancelled') {
      if (!['status', 'check_in', 'check_out', 'cancel_reason', 'guest_name'].includes(k)) continue;
    }
    out.push(`${k}: ${fmtVal(b)} → ${fmtVal(a)}`);
  }
  return out.slice(0, 12);
}

function fmtVal(v: unknown): string {
  if (v == null) return 'null';
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}...` : v;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v);
}

function describeMove(e: BookingEventRow): string {
  const b = e.before ?? {};
  const a = e.after ?? {};
  const bi = typeof b.check_in === 'string' ? b.check_in : '?';
  const bo = typeof b.check_out === 'string' ? b.check_out : '?';
  const ai = typeof a.check_in === 'string' ? a.check_in : '?';
  const ao = typeof a.check_out === 'string' ? a.check_out : '?';
  return `${bi} to ${bo} became ${ai} to ${ao} (${e.kind === 'feed_moved' ? 'the feed moved it' : e.actor}, ${fmtStamp(e.at)})`;
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
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>{children}</div>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>
        {label}
        {required && <span style={{ color: 'var(--signal)' }}> *</span>}
      </span>
      {children}
    </label>
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

const selectStyle: React.CSSProperties = { ...inputStyle };

const primaryButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 12,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '11px 22px',
  border: 'none',
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 12,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '10px 22px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
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
