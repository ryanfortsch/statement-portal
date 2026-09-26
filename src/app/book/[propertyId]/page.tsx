import { notFound } from 'next/navigation';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { getFleetProperty } from '@/lib/fleet';
import { conflictFromSearchParams, isYmd } from '@/lib/bookings-write-core';
import { submitBookingInquiry } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The public direct-inquiry page. The property comes from the registry
 * (active homes only), so a home that exists only in the DB has a page. The
 * "already booked" list is canonical holds only: confirmed, completed and
 * block rows with duplicate_of null. Inquiries never show and never hold.
 *
 * When the form was refused because the nights were taken, the action sends
 * the guest back here with the conflict in the query string; only the dates
 * are shown, never the other guest's record.
 */
export default async function BookPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { propertyId } = await params;
  const sp = await searchParams;
  const property = await getFleetProperty(propertyId);
  if (!property || !property.is_active) notFound();

  const blockedRanges = await fetchBlockedRanges(propertyId);
  const conflict = conflictFromSearchParams(sp);

  const today = new Date();
  const minDate = today.toISOString().slice(0, 10);
  const requestedIn = firstParam(sp.check_in);
  const requestedOut = firstParam(sp.check_out);
  const defaultIn = isYmd(requestedIn) ? requestedIn : addDays(today, 14).toISOString().slice(0, 10);
  const defaultOut = isYmd(requestedOut) ? requestedOut : addDays(today, 18).toISOString().slice(0, 10);
  const requestedGuests = Number(firstParam(sp.guests) || 0);
  const defaultGuests = requestedGuests > 0 && requestedGuests <= 20 ? String(requestedGuests) : '2';

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
          Stay at <em style={{ color: 'var(--tide-deep, #1f5fa6)', fontWeight: 400 }}>{property.title ?? property.name}.</em>
        </h1>
        <p style={{ marginTop: 18, fontSize: 16, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 580 }}>
          {property.address}, {property.city}. Tell us when you&apos;d like to come and a little about your party. Allie or Ryan
          will reply within a few hours to confirm availability and send a quote. No platform fees on direct bookings.
        </p>

        {conflict && (
          <div
            role="alert"
            style={{
              marginTop: 28,
              padding: '14px 18px',
              border: '1px solid var(--signal)',
              background: 'var(--paper-2)',
              color: 'var(--ink)',
              fontSize: 14,
              lineHeight: 1.55,
            }}
          >
            <div className="eyebrow" style={{ color: 'var(--signal)', marginBottom: 6 }}>Those dates are taken</div>
            <span className="font-mono" style={{ fontSize: 13 }}>{conflict.check_in} to {conflict.check_out}</span> is already booked.
            Pick a window that does not overlap it and send the inquiry again.
          </div>
        )}

        <form
          action={submitBookingInquiry}
          style={{ marginTop: 36, display: 'grid', gap: 18 }}
        >
          <input type="hidden" name="property_id" value={property.id} />
          {/* Honeypot: hidden from real users, bots fill it */}
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
              <input type="number" name="num_guests" min="1" max="20" defaultValue={defaultGuests} style={inputStyle} />
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
              placeholder="Whose birthday, who's coming, what brings you to Cape Ann. Any color helps us plan."
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          <button type="submit" style={primaryButton}>
            Send inquiry
          </button>
        </form>

        {blockedRanges.length > 0 && (
          <div style={{ marginTop: 56 }}>
            <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 12 }}>Already booked</div>
            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
              {blockedRanges.slice(0, 12).map((r, i) => (
                <div
                  key={`${r.check_in}-${r.check_out}-${i}`}
                  className="font-mono"
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    padding: '6px 0',
                    borderBottom: i === Math.min(blockedRanges.length, 12) - 1 ? 'none' : '1px solid var(--rule)',
                  }}
                >
                  {r.check_in} to {r.check_out}
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
        Rising Tide STR, Gloucester, MA. helm.risingtidestr.com
      </footer>
    </div>
  );
}

type Range = { check_in: string; check_out: string };

/**
 * Canonical holds over the next year, in check-in order. A stay in progress
 * (checked in before today, out after) is included, so the list never
 * hides the week a guest is currently in the house.
 */
async function fetchBlockedRanges(propertyId: string): Promise<Range[]> {
  if (!isServiceConfigured) return [];
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
  try {
    const rows = await selectAllPaged<Range>(
      (from, to) =>
        supabaseAdmin
          .from('bookings')
          .select('check_in, check_out')
          .eq('property_id', propertyId)
          .is('duplicate_of', null)
          .in('status', ['confirmed', 'completed', 'block'])
          .gt('check_out', today)
          .lte('check_in', horizon)
          .order('check_in', { ascending: true })
          .order('check_out', { ascending: true })
          .range(from, to),
      { label: 'book blocked ranges' },
    );
    return rows.map((r) => ({ check_in: r.check_in.slice(0, 10), check_out: r.check_out.slice(0, 10) }));
  } catch {
    return [];
  }
}

function firstParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
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
