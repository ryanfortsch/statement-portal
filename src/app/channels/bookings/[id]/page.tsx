import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import {
  BOOKING_CHANNELS,
  BOOKING_STATUSES,
  CHANNEL_LABELS,
  type Booking,
} from '@/lib/channels-types';
import { PROPERTIES } from '@/lib/properties';
import { updateBooking } from './actions';
import { DeleteBookingButton } from './DeleteBookingButton';

export const dynamic = 'force-dynamic';

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const booking = await fetchBooking(id);
  if (!booking) notFound();

  const property = PROPERTIES[booking.property_id];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />

      <HelmHero
        eyebrow="Helm · Channels · Booking"
        title={booking.guest_name ?? 'Stay'}
        emphasis={`at ${property?.name ?? booking.property_id}.`}
        description={`${booking.check_in} → ${booking.check_out} · ${CHANNEL_LABELS[booking.channel]} · ${booking.nights ?? '—'} nights`}
      />

      <section className="max-w-[820px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels/bookings" style={ghostButton}>← Back to bookings</Link>
          <Link href={`/channels/${booking.property_id}`} style={ghostButton}>Property →</Link>
        </div>
      </section>

      <section className="max-w-[820px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
        <form action={updateBooking} style={{ display: 'grid', gap: 18 }}>
          <input type="hidden" name="id" value={booking.id} />

          <Row>
            <Field label="Check-in" required>
              <input name="check_in" type="date" required defaultValue={booking.check_in} style={inputStyle} />
            </Field>
            <Field label="Check-out" required>
              <input name="check_out" type="date" required defaultValue={booking.check_out} style={inputStyle} />
            </Field>
          </Row>

          <Row>
            <Field label="Channel">
              <select name="channel" defaultValue={booking.channel} style={selectStyle}>
                {BOOKING_CHANNELS.map((c) => (
                  <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select name="status" defaultValue={booking.status} style={selectStyle}>
                {BOOKING_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </Row>

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

          <div className="eyebrow" style={{ marginTop: 4 }}>Money</div>
          <Row>
            <Field label="Gross">
              <input name="gross_amount" type="text" inputMode="decimal" defaultValue={booking.gross_amount ?? ''} style={inputStyle} />
            </Field>
            <Field label="Cleaning">
              <input name="cleaning_fee" type="text" inputMode="decimal" defaultValue={booking.cleaning_fee ?? ''} style={inputStyle} />
            </Field>
            <Field label="Payout">
              <input name="payout" type="text" inputMode="decimal" defaultValue={booking.payout ?? ''} style={inputStyle} />
            </Field>
          </Row>

          <Field label="Notes">
            <textarea name="notes" rows={3} defaultValue={booking.notes ?? ''} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <SubmitButton label="Save" busyLabel="Saving…" formAction={updateBooking} style={primaryButton} />
            <Link href="/channels/bookings" style={secondaryButton}>Cancel</Link>
            <span style={{ flex: 1 }} />
            <DeleteBookingButton />
          </div>
        </form>

        <Provenance booking={booking} />
      </section>

      <HelmFooter module="Channels · Booking" right={`source: ${booking.source}`} />
    </div>
  );
}

function Provenance({ booking }: { booking: Booking }) {
  return (
    <div style={{ marginTop: 56, padding: '20px 0', borderTop: '1px solid var(--rule)', fontSize: 12, color: 'var(--ink-3)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Provenance</div>
      <div className="font-mono" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '6px 16px', lineHeight: 1.6 }}>
        <span>source</span><span>{booking.source}</span>
        <span>external_booking_id</span><span>{booking.external_booking_id ?? '—'}</span>
        <span>external_confirmation_code</span><span>{booking.external_confirmation_code ?? '—'}</span>
        <span>ical_uid</span><span style={{ wordBreak: 'break-all' }}>{booking.ical_uid ?? '—'}</span>
        <span>first_seen_at</span><span>{booking.first_seen_at}</span>
        <span>last_seen_at</span><span>{booking.last_seen_at}</span>
        <span>created_at</span><span>{booking.created_at}</span>
        <span>updated_at</span><span>{booking.updated_at}</span>
        {booking.cancelled_at && <><span>cancelled_at</span><span>{booking.cancelled_at}</span></>}
      </div>
    </div>
  );
}

async function fetchBooking(id: string): Promise<Booking | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from('bookings').select('*').eq('id', id).maybeSingle();
  if (error) return null;
  return (data ?? null) as Booking | null;
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
