import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { listFleetProperties, type FleetProperty } from '@/lib/fleet';
import { regionLabel } from '@/lib/property-scope';
import { listBookingsForProperty, type BookingEx } from '@/lib/channels';
import { loadPricingBundle, type PricingBundle } from '@/lib/property-rates';
import { buildAvailability, checkRange, type RangeCheck } from '@/lib/availability';
import { quoteStay, TaxJurisdictionUnknownError, type StayQuote } from '@/lib/rate-plan';
import { shiftIsoDay, todayInEastern } from '@/lib/sca-quotes-types';
import { conflictFromSearchParams, describeConflict, isYmd } from '@/lib/bookings-write-core';
import { authorityBadge, sourceGlyph } from '@/lib/calendar-model';
import { CHANNEL_LABELS, type BookingChannel } from '@/lib/channels-types';
import { createManualBooking } from './actions';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

type Check = {
  property: FleetProperty;
  checkIn: string;
  checkOut: string;
  guests: number;
  range: RangeCheck | null;
  conflicting: BookingEx[];
  quote: StayQuote | null;
  quoteError: string | null;
  hasPlan: boolean;
};

async function runCheck(property: FleetProperty, checkIn: string, checkOut: string, guests: number): Promise<Check> {
  const helmRun = property.calendar_authority === 'helm';
  const out: Check = { property, checkIn, checkOut, guests, range: null, conflicting: [], quote: null, quoteError: null, hasPlan: false };
  try {
    const [bookings, bundle] = await Promise.all([
      listBookingsForProperty(property.id, checkIn, checkOut),
      helmRun ? loadPricingBundle(property.id, shiftIsoDay(checkIn, -1), checkOut) : Promise.resolve(null as PricingBundle | null),
    ]);
    const live = bookings.filter((b) => b.status !== 'cancelled');
    out.conflicting = live.filter((b) => (b.status === 'confirmed' || b.status === 'completed' || b.status === 'block') && b.check_in < checkOut && b.check_out > checkIn);
    out.hasPlan = !!bundle?.plan;
    const days = buildAvailability({
      bookings: live,
      plan: bundle?.plan ?? null,
      rateDays: bundle?.days ?? new Map(),
      rentalPeriods: bundle?.periods ?? [],
      start: checkIn,
      end: shiftIsoDay(checkOut, -1),
      timeZone: property.timezone,
    });
    out.range = checkRange(days, checkIn, checkOut);
    if (helmRun && bundle?.plan) {
      try {
        out.quote = quoteStay({
          plan: bundle.plan,
          days: bundle.days,
          tax: bundle.tax,
          checkIn,
          checkOut,
          guests,
          channel: 'direct',
          region: property.region,
          propertyId: property.id,
          timeZone: property.timezone,
        });
      } catch (err) {
        out.quoteError = err instanceof TaxJurisdictionUnknownError ? err.message : err instanceof Error ? err.message : String(err);
      }
    }
  } catch (err) {
    out.quoteError = err instanceof Error ? err.message : String(err);
  }
  return out;
}

export default async function ChannelsBookingsNewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const presetProperty = one(sp.property).trim();
  const isBlock = one(sp.type) === 'block';
  const checkIn = one(sp.check_in).trim();
  const checkOut = one(sp.check_out).trim();
  const guests = Math.max(1, Math.round(Number(one(sp.guests)) || 2));
  const conflict = conflictFromSearchParams(sp);
  const today = todayInEastern();

  let fleet: FleetProperty[] = [];
  try {
    fleet = await listFleetProperties();
  } catch {
    fleet = [];
  }
  const property = fleet.find((p) => p.id === presetProperty) ?? null;
  const datesOk = isYmd(checkIn) && isYmd(checkOut) && checkOut > checkIn;
  const check = property && datesOk ? await runCheck(property, checkIn, checkOut, guests) : null;

  const channelChoices: BookingChannel[] = isBlock ? ['block'] : ['direct', 'manual', 'airbnb', 'vrbo', 'booking_com', 'other'];
  const defaultChannel: BookingChannel = isBlock ? 'block' : 'direct';
  const money = (c: number) => (c / 100).toFixed(2);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow={`Helm · Channels · New ${isBlock ? 'block' : 'booking'}`}
        title={isBlock ? 'Hold dates' : 'Add a booking'}
        emphasis={isBlock ? 'on a home.' : 'by hand.'}
        description={
          isBlock
            ? 'Owner stays, maintenance windows, anything that should take the nights off sale. A hold rides Helm’s export so every subscribed OTA sees it within its next pull, and the database refuses it if a stay already has the nights.'
            : 'For direct stays, off-platform reservations, or a booking no feed carries yet. Check the dates first: Helm names the stay that holds them and, on a home it runs, prices the stay.'
        }
      />

      <section className="max-w-[860px] mx-auto px-10" style={{ width: '100%', paddingBottom: 20 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels/bookings" style={ghostButton}>← Bookings</Link>
          {property && <Link href={`/channels/${property.id}`} style={ghostButton}>{property.name} hub →</Link>}
          <span style={{ flex: 1 }} />
          <Link href={isBlock ? `/channels/bookings/new${presetProperty ? `?property=${presetProperty}` : ''}` : `/channels/bookings/new?type=block${presetProperty ? `&property=${presetProperty}` : ''}`} style={ghostButton}>
            {isBlock ? 'Booking instead' : 'Block instead'}
          </Link>
        </div>
      </section>

      {conflict && (
        <section className="max-w-[860px] mx-auto px-10" style={{ width: '100%', paddingBottom: 16 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, lineHeight: 1.5 }}>
            <strong>The database refused it.</strong> {describeConflict(conflict)}{' '}
            <Link href={`/channels/bookings/${conflict.booking_id}`} style={{ color: 'var(--ink)' }}>Open that stay</Link>, pick other dates, or cancel it first.
          </div>
        </section>
      )}

      {/* Step 1: check the dates */}
      <section className="max-w-[860px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>1 · Dates</div>
        <form action="/channels/bookings/new" method="get" style={{ borderTop: '1px solid var(--ink)', paddingTop: 16, display: 'grid', gap: 14 }}>
          {isBlock && <input type="hidden" name="type" value="block" />}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 80px auto', gap: 12, alignItems: 'end' }}>
            <Field label="Property" required>
              <select name="property" defaultValue={presetProperty} required style={selectStyle}>
                <option value="">pick a home</option>
                {fleet.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.calendar_authority === 'helm' ? ' · Helm' : ''}{p.region !== 'cape_ann' ? ` · ${regionLabel(p.region)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={isBlock ? 'First night' : 'Check-in'} required>
              <input name="check_in" type="date" required defaultValue={checkIn || today} style={inputStyle} />
            </Field>
            <Field label={isBlock ? 'Release morning' : 'Check-out'} required>
              <input name="check_out" type="date" required defaultValue={checkOut} style={inputStyle} />
            </Field>
            <Field label="Guests">
              <input name="guests" type="number" min={1} max={30} defaultValue={guests} style={inputStyle} disabled={isBlock} />
            </Field>
            <button type="submit" style={secondaryButton}>Check dates</button>
          </div>
        </form>

        {property && !datesOk && (checkIn || checkOut) && (
          <p style={{ fontSize: 12, color: 'var(--negative)', marginTop: 10 }}>Check-out must be after check-in.</p>
        )}

        {check && <AvailabilityBlock check={check} isBlock={isBlock} />}
      </section>

      {/* Step 2: the record */}
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>2 · {isBlock ? 'The hold' : 'The booking'}</div>
        <form action={createManualBooking} style={{ borderTop: '1px solid var(--ink)', paddingTop: 16, display: 'grid', gap: 18 }}>
          <input type="hidden" name="property_id" value={property?.id ?? presetProperty} />
          {isBlock && <input type="hidden" name="type" value="block" />}
          {!property && (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>Pick a home and check the dates above; the form fills from the check.</p>
          )}
          {property && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span className="font-serif" style={{ fontSize: 22 }}>{property.name}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{property.address}</span>
              <span style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: property.calendar_authority === 'helm' ? 'var(--positive)' : 'var(--ink-4)' }}>
                {authorityBadge(property, false).label}
              </span>
            </div>
          )}

          <Row>
            <Field label={isBlock ? 'First night' : 'Check-in'} required>
              <input name="check_in" type="date" required defaultValue={checkIn} style={inputStyle} />
            </Field>
            <Field label={isBlock ? 'Release morning' : 'Check-out'} required>
              <input name="check_out" type="date" required defaultValue={checkOut} style={inputStyle} />
            </Field>
          </Row>

          <Row>
            <Field label="Channel">
              <select name="channel" defaultValue={defaultChannel} style={selectStyle}>
                {channelChoices.map((c) => (
                  <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select name="status" defaultValue={isBlock ? 'block' : 'confirmed'} style={selectStyle}>
                {(isBlock ? ['block'] : ['confirmed', 'pending', 'inquiry']).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            {isBlock && (
              <Field label="Hold kind">
                <select name="hold_kind" defaultValue="owner" style={selectStyle}>
                  <option value="owner">Owner stay</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="other">Other</option>
                  <option value="ota">Channel block</option>
                </select>
              </Field>
            )}
          </Row>

          {!isBlock && (
            <>
              <div className="eyebrow" style={{ marginTop: 4 }}>Guest</div>
              <Row>
                <Field label="Name">
                  <input name="guest_name" type="text" placeholder="Jane Doe" style={inputStyle} />
                </Field>
                <Field label="Number of guests">
                  <input name="num_guests" type="number" min="1" defaultValue={guests} style={inputStyle} />
                </Field>
              </Row>
              <Row>
                <Field label="Email">
                  <input name="guest_email" type="email" placeholder="jane@example.com" style={inputStyle} />
                </Field>
                <Field label="Phone">
                  <input name="guest_phone" type="tel" placeholder="(555) 123-4567" style={inputStyle} />
                </Field>
              </Row>

              <div className="eyebrow" style={{ marginTop: 4 }}>
                Money {check?.quote ? <span style={{ color: 'var(--positive)' }}>· prefilled from Helm&apos;s quote</span> : <span style={{ color: 'var(--ink-4)' }}>· optional</span>}
              </div>
              <Row>
                <Field label="Gross (what the guest pays)">
                  <input name="gross_amount" type="text" inputMode="decimal" defaultValue={check?.quote ? money(check.quote.total_cents) : ''} placeholder="1,200.00" style={inputStyle} />
                </Field>
                <Field label="Cleaning">
                  <input name="cleaning_fee" type="text" inputMode="decimal" defaultValue={check?.quote ? money(check.quote.cleaning_cents) : ''} placeholder="165.00" style={inputStyle} />
                </Field>
                <Field label="Taxes">
                  <input name="taxes" type="text" inputMode="decimal" defaultValue={check?.quote ? money(check.quote.tax_cents) : ''} placeholder="0.00" style={inputStyle} />
                </Field>
                <Field label="Payout">
                  <input name="payout" type="text" inputMode="decimal" placeholder="1,000.00" style={inputStyle} />
                </Field>
              </Row>
            </>
          )}

          <Field label="Notes">
            <textarea name="notes" rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder={isBlock ? 'Owner July 4 week; HVAC tune-up' : 'Repeat guest, special arrangements'} />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
            <SubmitButton label={isBlock ? 'Create block' : 'Create booking'} busyLabel="Creating…" style={primaryButton} disabled={!property} />
            <Link href="/channels/bookings" style={secondaryButton}>Cancel</Link>
            {check && check.range && !check.range.available && !isBlock && (
              <span style={{ fontSize: 12, color: 'var(--negative)' }}>These nights are not open; the database will refuse a confirmed stay over them.</span>
            )}
          </div>
        </form>
      </section>

      <HelmFooter module={`Channels · New ${isBlock ? 'block' : 'booking'}`} right="Source: Helm" />
    </div>
  );
}

function AvailabilityBlock({ check, isBlock }: { check: Check; isBlock: boolean }) {
  const helmRun = check.property.calendar_authority === 'helm';
  const nights = Math.max(0, Math.round((Date.parse(`${check.checkOut}T00:00:00Z`) - Date.parse(`${check.checkIn}T00:00:00Z`)) / 86_400_000));
  const r = check.range;
  const open = r?.available ?? false;
  const holdsOnly = r ? r.unavailableDates.length > 0 && check.conflicting.length === 0 : false;
  const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: check.quote || check.quoteError ? '1fr 1fr' : '1fr', gap: 24 }}>
      <div style={{ borderLeft: `3px solid ${open ? 'var(--positive)' : 'var(--negative)'}`, padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, lineHeight: 1.55 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {check.checkIn} to {check.checkOut} · {nights} night{nights === 1 ? '' : 's'} at {check.property.name}
        </div>
        {r === null ? (
          <span style={{ color: 'var(--negative)' }}>Availability could not be read.</span>
        ) : open ? (
          <span>Open. Nothing in Helm holds these nights{helmRun ? ' and the rate plan allows the stay' : ''}.</span>
        ) : check.conflicting.length > 0 ? (
          <div>
            <span style={{ color: 'var(--negative)' }}>Taken.</span> {check.conflicting.length === 1 ? 'This row holds' : 'These rows hold'} the nights:
            <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
              {check.conflicting.map((b) => {
                const g = sourceGlyph(b);
                return (
                  <li key={b.id}>
                    <Link href={`/channels/bookings/${b.id}`} style={{ color: 'var(--ink)' }}>
                      {b.status === 'block' ? `Hold${b.hold_kind ? ` (${b.hold_kind})` : ''}` : b.guest_name ?? `${CHANNEL_LABELS[b.channel] ?? b.channel} stay`}
                    </Link>
                    <span className="font-mono" style={{ marginLeft: 8, color: 'var(--ink-3)', fontSize: 11 }}>{b.check_in} → {b.check_out}</span>
                    <span style={{ marginLeft: 8, color: 'var(--ink-4)', fontSize: 11 }}>{g.glyph} {g.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : holdsOnly ? (
          <span>
            <span style={{ color: 'var(--negative)' }}>Not for sale</span> on {r.unavailableDates.length} night{r.unavailableDates.length === 1 ? '' : 's'} by rule (closed, off season, advance notice or booking window), though nothing holds them.{isBlock ? ' A hold is still allowed.' : ' A manual booking is still allowed; the database only refuses overlaps.'}
          </span>
        ) : (
          <span style={{ color: 'var(--negative)' }}>Not available.</span>
        )}
        {!helmRun && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>
            Guesty runs this home. Helm checks only its own rows; confirm the dates in Guesty as well, and type the money as Guesty shows it.
          </div>
        )}
        {helmRun && !check.hasPlan && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)' }}>
            Helm runs this home but it has no rate plan yet, so there is no quote.{' '}
            <Link href={`/properties/${check.property.id}?tab=rates`} style={{ color: 'inherit' }}>Set one on the Rates tab.</Link>
          </div>
        )}
      </div>

      {check.quoteError && (
        <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 12, color: 'var(--negative)', lineHeight: 1.5 }}>{check.quoteError}</div>
      )}
      {check.quote && (
        <div style={{ border: '1px solid var(--rule)', padding: '14px 16px' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Helm quote · direct channel · {check.guests} guest{check.guests === 1 ? '' : 's'}</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              <QuoteRow k={`Accommodation · ${check.quote.nights} nights`} v={money(check.quote.accommodation_cents)} />
              {check.quote.extra_guest_cents > 0 && <QuoteRow k="Extra guests" v={money(check.quote.extra_guest_cents)} />}
              {check.quote.discount_cents > 0 && <QuoteRow k={check.quote.discount_label ?? 'Discount'} v={`-${money(check.quote.discount_cents)}`} />}
              {check.quote.markup_cents > 0 && <QuoteRow k="Direct rate adjustment" v={money(check.quote.markup_cents)} />}
              {check.quote.cleaning_cents > 0 && <QuoteRow k="Cleaning" v={money(check.quote.cleaning_cents)} />}
              <QuoteRow k={check.quote.tax_exempt ? 'Occupancy tax (exempt)' : `Occupancy tax · ${(check.quote.tax_rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`} v={money(check.quote.tax_cents)} />
              <tr>
                <td className="font-serif" style={{ padding: '8px 0 0', fontSize: 15 }}>Total</td>
                <td className="font-serif tabular-nums" style={{ padding: '8px 0 0', textAlign: 'right', fontSize: 15 }}>{money(check.quote.total_cents)}</td>
              </tr>
            </tbody>
          </table>
          {check.quote.violations.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--signal)', marginTop: 8 }}>Rule flags: {check.quote.violations.map((v) => v.replace(/_/g, ' ')).join(', ')}.</div>
          )}
          <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 8, lineHeight: 1.5 }}>Same formula as the SCA quote composer and staycapeann.com. The money fields below are prefilled from it; edit them if the guest paid something else.</div>
        </div>
      )}
    </div>
  );
}

function QuoteRow({ k, v }: { k: string; v: string }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
      <td style={{ padding: '5px 0', color: 'var(--ink-2)' }}>{k}</td>
      <td className="tabular-nums" style={{ padding: '5px 0', textAlign: 'right' }}>{v}</td>
    </tr>
  );
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
