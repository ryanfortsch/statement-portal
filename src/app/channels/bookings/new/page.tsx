import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { PROPERTIES } from '@/lib/properties';
import { CHANNEL_LABELS, type BookingChannel } from '@/lib/channels-types';
import { createManualBooking } from './actions';

export const dynamic = 'force-dynamic';

export default async function ChannelsBookingsNewPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; type?: 'block' | 'booking' }>;
}) {
  const sp = await searchParams;
  const presetProperty = sp.property || '';
  const isBlock = sp.type === 'block';
  const properties = Object.values(PROPERTIES);
  const channelChoices: BookingChannel[] = isBlock
    ? ['block']
    : ['direct', 'manual', 'airbnb', 'vrbo', 'booking_com', 'other'];
  const defaultChannel: BookingChannel = isBlock ? 'block' : 'direct';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />

      <HelmHero
        eyebrow={`Helm · Channels · New ${isBlock ? 'block' : 'booking'}`}
        title={isBlock ? 'Block dates' : 'Add a booking'}
        emphasis={isBlock ? 'on a property.' : 'by hand.'}
        description={isBlock
          ? 'Owner stays, maintenance windows, anything that should mark the property unavailable. Blocks publish back through Helm’s outbound iCal feed so subscribed channels see them within their next pull.'
          : 'For direct stays, off-platform reservations, or any booking that isn’t reaching us through an iCal feed yet.'}
      />

      <section className="max-w-[820px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <Link href="/channels/bookings" style={ghostButton}>← Back to bookings</Link>
      </section>

      <section className="max-w-[820px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
        <form action={createManualBooking} style={{ display: 'grid', gap: 18 }}>
          <Field label="Property" required>
            <select name="property_id" defaultValue={presetProperty} required style={selectStyle}>
              <option value="">— pick a property —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <Row>
            <Field label="Check-in" required>
              <input name="check_in" type="date" required style={inputStyle} />
            </Field>
            <Field label="Check-out" required>
              <input name="check_out" type="date" required style={inputStyle} />
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
                {(isBlock ? ['block'] : ['confirmed', 'pending', 'inquiry', 'cancelled']).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </Row>

          {!isBlock && (
            <>
              <div className="eyebrow" style={{ marginTop: 4 }}>Guest</div>
              <Row>
                <Field label="Name">
                  <input name="guest_name" type="text" placeholder="Jane Doe" style={inputStyle} />
                </Field>
                <Field label="Number of guests">
                  <input name="num_guests" type="number" min="1" placeholder="2" style={inputStyle} />
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

              <div className="eyebrow" style={{ marginTop: 4 }}>Money (optional)</div>
              <Row>
                <Field label="Gross">
                  <input name="gross_amount" type="text" inputMode="decimal" placeholder="$1,200.00" style={inputStyle} />
                </Field>
                <Field label="Cleaning">
                  <input name="cleaning_fee" type="text" inputMode="decimal" placeholder="$165.00" style={inputStyle} />
                </Field>
                <Field label="Payout">
                  <input name="payout" type="text" inputMode="decimal" placeholder="$1,000.00" style={inputStyle} />
                </Field>
              </Row>
            </>
          )}

          <Field label="Notes">
            <textarea name="notes" rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder={isBlock ? 'Owner July 4 stay; HVAC tune-up; etc.' : 'Repeat guest, special arrangements, etc.'} />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <SubmitButton label={isBlock ? 'Create block' : 'Create booking'} busyLabel="Creating…" style={primaryButton} />
            <Link href="/channels/bookings" style={secondaryButton}>Cancel</Link>
          </div>
        </form>
      </section>

      <HelmFooter module={`Channels · New ${isBlock ? 'block' : 'booking'}`} right="Source: Helm" />
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>{children}</div>;
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

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
