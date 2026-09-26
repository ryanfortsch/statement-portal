import Link from 'next/link';
import type { ReactNode } from 'react';
import { CopyValue } from './CopyValue';
import { formatUsPhone } from '@/lib/phone';
import type { GuestCodeBookingRow, LockCode } from '@/lib/guest-locks';
import type { PropertyCleaner } from '@/lib/property-crew';

/**
 * The band above the tab strip.
 *
 * Every link into this record from outside the /properties route group is
 * bare, so all of that traffic lands on the default tab, and the two things
 * it most often arrives to find were not on that tab at all: what is
 * happening at the house right now, and one operational fact to read out
 * loud. The next 25 confirmed bookings were already being loaded on every
 * render and shown only inside a closed accordion on a different tab; the
 * door code and the Wi-Fi password sat three interactions deep.
 *
 * So this sits above the tabs, identical on all of them, and answers both at
 * zero clicks. It replaces the four stat tiles, which were config rather than
 * state: two of the four rendered as a hand-written dash on a live property,
 * and nothing in Helm could even write one of them.
 *
 * Every value here comes from a loader the page already awaited. This costs
 * one new query (the cleaner roster), which is the fact the record could not
 * answer at all before.
 *
 * A missing fact NEVER renders a dash. It renders the name of the thing that
 * is missing, as a link to the one control that fills it, so an empty cell is
 * an errand rather than a shrug.
 */

type Alert = {
  key: string;
  tone: 'negative' | 'signal';
  text: string;
  href: string;
};

type Props = {
  propertyId: string;
  isActive: boolean;
  /** ET calendar date, 'YYYY-MM-DD'. Passed in so the page has one clock. */
  todayIso: string;
  bookings: GuestCodeBookingRow[];
  lockCodes: LockCode[];
  cleaners: PropertyCleaner[];
  wifiName: string | null;
  wifiPassword: string | null;
  keyCodeLocation: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  ownerPreferredContact: string | null;
  openSlipCount: number;
  lastInspectionAt: string | null;
  seasonNote: string | null;
  alerts: Alert[];
};

function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T12:00:00Z`);
  const b = Date.parse(`${toIso}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400_000);
}

/** One cell of the live-state row. */
function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

/**
 * One fact on the rail. `value` present means we know it; otherwise `fixLabel`
 * and `fixHref` name the errand. Never a dash either way.
 */
function Fact({
  label,
  value,
  copy,
  scope,
  fixLabel,
  fixHref,
}: {
  label: string;
  value?: string | null;
  copy?: boolean;
  /** Where the fact is true, when that is not obvious. "This stay", "Fleet". */
  scope?: string;
  fixLabel: string;
  fixHref: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="eyebrow" style={{ marginBottom: 6, display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span>{label}</span>
        {scope && value && (
          <span style={{ color: 'var(--ink-4)', letterSpacing: 0, textTransform: 'none', fontSize: 10 }}>
            {scope}
          </span>
        )}
      </div>
      {value ? (
        <div
          style={{
            fontSize: 14,
            color: 'var(--ink)',
            display: 'flex',
            alignItems: 'baseline',
            wordBreak: 'break-word',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono-dash), ui-monospace, monospace', fontSize: 13 }}>
            {value}
          </span>
          {copy && <CopyValue value={value} label={label} />}
        </div>
      ) : (
        <Link
          href={fixHref}
          className="rt-action-link"
          style={{ fontSize: 12, color: 'var(--signal)', textDecoration: 'none' }}
        >
          {fixLabel} →
        </Link>
      )}
    </div>
  );
}

export function PropertyMasthead({
  propertyId,
  isActive,
  todayIso,
  bookings,
  lockCodes,
  cleaners,
  wifiName,
  wifiPassword,
  keyCodeLocation,
  ownerName,
  ownerPhone,
  ownerEmail,
  ownerPreferredContact,
  openSlipCount,
  lastInspectionAt,
  seasonNote,
  alerts,
}: Props) {
  // The stay in residence, then the next one to arrive. bookings arrive
  // already filtered to confirmed canonical rows with check_out >= today and
  // sorted by check_in, so a linear scan is enough.
  const inHouse = bookings.find((b) => b.check_in <= todayIso && b.check_out > todayIso) ?? null;
  const nextArrival = bookings.find((b) => b.check_in > todayIso) ?? null;
  const nextCheckout = inHouse ?? bookings[0] ?? null;

  // Credentials are suppressed on a property we no longer run. The record
  // stays readable; the codes stop being handed out.
  const showCreds = isActive;

  // The PIN issued for the stay that is actually here, never a stale one from
  // a finished stay. Falls back to a named active code on the lock.
  const stayPin = inHouse?.code?.code ?? null;
  const namedCode = lockCodes.find((c) => c.code && c.source === 'helm') ?? null;
  const guestPin = stayPin ?? namedCode?.code ?? null;
  const guestPinScope = stayPin ? 'this stay' : namedCode?.name ? namedCode.name : undefined;

  const cleaner = cleaners[0] ?? null;
  const ownerChannel =
    (ownerPreferredContact ?? '').toLowerCase().includes('email')
      ? ownerEmail
      : ownerPhone
        ? formatUsPhone(ownerPhone)
        : ownerEmail;

  const wifi = wifiName && wifiPassword ? `${wifiName} / ${wifiPassword}` : null;

  return (
    <section
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingBottom: 18, width: '100%' }}
    >
      {/* LIVE STATE — what is happening at this house, which is the question
          the record could not answer at all before. */}
      <div
        className="rt-masthead-band"
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--rule)',
          padding: '16px 0',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 20,
        }}
      >
        <State label="In the house">
          {inHouse ? (
            <>
              <strong style={{ fontWeight: 500 }}>{inHouse.guest_name ?? 'Guest'}</strong>
              <span style={{ color: 'var(--ink-3)' }}> until {fmtDay(inHouse.check_out)}</span>
            </>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>Empty</span>
          )}
        </State>

        <State label="Next arrival">
          {nextArrival ? (
            <>
              <span>{fmtDay(nextArrival.check_in)}</span>
              <span style={{ color: 'var(--ink-3)' }}>
                {' '}
                ({daysBetween(todayIso, nextArrival.check_in)}d) · {nextArrival.guest_name ?? 'Guest'}
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>Nothing booked</span>
          )}
        </State>

        <State label="Next checkout">
          {nextCheckout ? (
            <>
              <span>{fmtDay(nextCheckout.check_out)}</span>
              <span style={{ color: 'var(--ink-3)' }}>
                {' '}
                ({daysBetween(todayIso, nextCheckout.check_out)}d)
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>None scheduled</span>
          )}
        </State>

        <State label="Last walked">
          {lastInspectionAt ? (
            <Link
              href={`/properties/${propertyId}?tab=owner`}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {fmtDay(lastInspectionAt.slice(0, 10))}
              <span style={{ color: 'var(--ink-3)' }}>
                {' '}
                ({daysBetween(lastInspectionAt.slice(0, 10), todayIso)}d ago)
              </span>
            </Link>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>Never</span>
          )}
        </State>

        <State label="Open work">
          {openSlipCount > 0 ? (
            <Link
              href={`/properties/${propertyId}/work-slips`}
              style={{ color: 'var(--signal)', textDecoration: 'none' }}
            >
              {openSlipCount} {openSlipCount === 1 ? 'slip' : 'slips'} →
            </Link>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>Clear</span>
          )}
        </State>

        {seasonNote && <State label="Season">{seasonNote}</State>}
      </div>

      {/* HOT FACTS — the answers that have to leave the screen in one gesture. */}
      <div
        className="rt-masthead-band"
        style={{
          borderBottom: alerts.length > 0 ? '1px solid var(--rule)' : '1px solid var(--ink)',
          padding: '14px 0',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 20,
        }}
      >
        <Fact
          label="Guest code"
          value={showCreds ? guestPin : null}
          scope={guestPinScope}
          copy
          fixLabel={showCreds ? 'No code issued' : 'Inactive'}
          fixHref={`/properties/${propertyId}?tab=facts#guest-codes`}
        />
        <Fact
          label="Wi-Fi"
          value={showCreds ? wifi : null}
          copy
          fixLabel="Add Wi-Fi"
          fixHref={`/properties/${propertyId}/edit#wifi`}
        />
        <Fact
          label="Key / lockbox"
          value={showCreds ? keyCodeLocation : null}
          fixLabel="Add key location"
          fixHref={`/properties/${propertyId}/edit#arrival`}
        />
        <Fact
          label="Cleaner"
          value={cleaner ? `${cleaner.display_name} · ${formatUsPhone(cleaner.phone)}` : null}
          scope={cleaner?.fleetWide ? 'fleet' : undefined}
          copy
          fixLabel="No cleaner mapped"
          fixHref="/turnovers/schedule"
        />
        <Fact
          label="Owner"
          value={ownerName && ownerChannel ? `${ownerName} · ${ownerChannel}` : null}
          copy
          fixLabel="Add owner contact"
          fixHref={`/properties/${propertyId}?tab=owner`}
        />
      </div>

      {/* ALERTS — only rendered when something has actually fired. These are
          the expensive, quiet failures the page used to bury inside a fold:
          a live listing in demo mode, a contract that disagrees with the fee
          we bill, a permit about to lapse. */}
      {alerts.length > 0 && (
        <div
          style={{
            borderBottom: '1px solid var(--ink)',
            padding: '12px 0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {alerts.slice(0, 5).map((a) => (
            <Link
              key={a.key}
              href={a.href}
              style={{
                fontSize: 11,
                textDecoration: 'none',
                padding: '5px 10px',
                borderRadius: 2,
                border: `1px solid var(--${a.tone})`,
                color: `var(--${a.tone})`,
                lineHeight: 1.3,
              }}
            >
              {a.text}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export type { Alert as PropertyAlert };
