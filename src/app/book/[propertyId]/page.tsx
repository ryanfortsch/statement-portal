import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { getProperty } from '@/lib/properties';
import { submitBookingInquiry } from './actions';

export const dynamic = 'force-dynamic';

export default async function BookPropertyPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const property = getProperty(propertyId);
  if (!property) notFound();

  const blockedRanges = await fetchBlockedRanges(propertyId);

  // Suggest a default window: today + 7 → today + 11 (4-night Friday-ish stay)
  const today = new Date();
  const defaultIn = addDays(today, 14).toISOString().slice(0, 10);
  const defaultOut = addDays(today, 18).toISOString().slice(0, 10);
  const minDate = today.toISOString().slice(0, 10);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--paper)',
      color: 'var(--ink)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-sans, -apple-system, sans-serif)',
    }}>
      <header
        style={{
          padding: '24px 0',
          borderBottom: '1px solid var(--rule)',
          textAlign: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rising-tide-logo.png" alt="Rising Tide" style={{ width: 44, height: 44 }} />
        <div className="font-serif" style={{ fontSize: 22, marginTop: 6, letterSpacing: '-0.01em' }}>Rising Tide STR</div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '56px 24px 96px', width: '100%', flex: 1 }}>
        <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 14 }}>Direct booking</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 48,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          Stay at <em style={{ color: 'var(--tide-deep, #1f5fa6)', fontWeight: 400 }}>{property.name}.</em>
        </h1>
        <p style={{ marginTop: 18, fontSize: 16, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 580 }}>
          {property.address}, {property.city}. Tell us when you&apos;d like to come and a little about your party — Allie or Ryan
          will reply within a few hours to confirm availability and send a quote. No platform fees on direct bookings.
        </p>

        <form
          action={submitBookingInquiry}
          style={{ marginTop: 36, display: 'grid', gap: 18 }}
        >
          <input type="hidden" name="property_id" value={property.id} />
          {/* Honeypot — hidden from real users, bots fill it */}
          <input
            type="text"
            name="hp_extra"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
          />

          <Row>
            <Field label="Arrival" required>
              <input type="date" name="check_in" required min={minDate} defaultValue={defaultIn} style={inputStyle} />
            </Field>
            <Field label="Departure" required>
              <input type="date" name="check_out" required min={minDate} defaultValue={defaultOut} style={inputStyle} />
            </Field>
            <Field label="Guests">
              <input type="number" name="num_guests" min="1" max="20" defaultValue="2" style={inputStyle} />
            </Field>
          </Row>

          <Field label="Your name" required>
            <input type="text" name="guest_name" required placeholder="Jane Doe" style={inputStyle} />
          </Field>

          <Row>
            <Field label="Email" required>
              <input type="email" name="guest_email" required placeholder="jane@example.com" style={inputStyle} />
            </Field>
            <Field label="Phone">
              <input type="tel" name="guest_phone" placeholder="(555) 123-4567" style={inputStyle} />
            </Field>
          </Row>

          <Field label="A little about your trip">
            <textarea
              name="message"
              rows={4}
              placeholder="Whose birthday, who's coming, what brings you to Cape Ann — any color helps us plan."
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          <button type="submit" style={primaryButton}>
            Send inquiry →
          </button>
        </form>

        {blockedRanges.length > 0 && (
          <div style={{ marginTop: 56 }}>
            <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 12 }}>Already booked</div>
            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
              {blockedRanges.slice(0, 12).map((r, i) => (
                <div
                  key={i}
                  className="font-mono"
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    padding: '6px 0',
                    borderBottom: i === blockedRanges.length - 1 ? 'none' : '1px solid var(--rule)',
                  }}
                >
                  {r.check_in} → {r.check_out}
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10 }}>
              Pick a window that doesn&apos;t overlap any of these.
            </p>
          </div>
        )}
      </main>

      <footer style={{ padding: '20px 24px', borderTop: '1px solid var(--rule)', textAlign: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
        Rising Tide STR · Gloucester, MA · helm.risingtidestr.com
      </footer>
    </div>
  );
}

async function fetchBlockedRanges(propertyId: string): Promise<Array<{ check_in: string; check_out: string }>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
  const { data } = await sb
    .from('bookings')
    .select('check_in, check_out, status')
    .eq('property_id', propertyId)
    .gte('check_in', today)
    .lte('check_in', horizon)
    .neq('status', 'cancelled')
    .order('check_in');
  return ((data ?? []) as Array<{ check_in: string; check_out: string }>);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>{children}</div>;
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
  fontSize: 15,
  padding: '12px 14px',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  width: '100%',
  fontFamily: 'inherit',
};

const primaryButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 13,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '14px 24px',
  border: 'none',
  cursor: 'pointer',
  width: 'fit-content',
};
