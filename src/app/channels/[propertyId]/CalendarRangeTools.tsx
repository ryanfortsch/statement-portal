import Link from 'next/link';
import { SubmitButton } from '@/components/SubmitButton';
import { UNSELLABLE_LABEL, type CalendarCellVM, type UnsellableReason } from '@/lib/calendar-model';
import { bulkSetRateDaysForm } from '../calendar/calendar-actions';

/**
 * What the per-home month grid (/channels/[propertyId]/calendar, retired
 * 2026-11-08) added to the hub calendar: why each vacant night is not for
 * sale, and Set a range. It sits under the hub's own calendar so a home has
 * one calendar, not two.
 */
export function CalendarRangeTools({
  propertyId,
  month,
  monthStart,
  monthEnd,
  monthCells,
  today,
  helmRun,
  owner,
  planNightlyCents,
  planMinNights,
  saved,
  error,
}: {
  propertyId: string;
  /** YYYY-MM of the month on screen, so a save lands back on it. */
  month: string;
  monthStart: string;
  monthEnd: string;
  monthCells: CalendarCellVM[];
  today: string;
  helmRun: boolean;
  owner: boolean;
  planNightlyCents: number | null;
  planMinNights: number | null;
  saved: string;
  error: string;
}) {
  const reasons = unsellableReasons(monthCells, today);
  return (
    <>
      {reasons.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Why a vacant night is not for sale</div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {reasons.map((r) => (
              <div key={r.reason} style={{ display: 'grid', gridTemplateColumns: '190px 60px 1fr', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 12, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>{UNSELLABLE_LABEL[r.reason]}</span>
                <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>{r.dates.length} night{r.dates.length === 1 ? '' : 's'}</span>
                <span className="font-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{compressDates(r.dates)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div id="bulk" style={{ marginTop: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Set a range</div>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
          {(saved || error) && (
            <div style={{ borderLeft: `3px solid ${error ? 'var(--negative)' : 'var(--positive)'}`, padding: '10px 14px', background: 'var(--paper-2)', fontSize: 13, lineHeight: 1.5, marginBottom: 16, color: error ? 'var(--negative)' : 'var(--ink)' }}>
              {error || saved}
            </div>
          )}
          {!helmRun ? (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 640, margin: 0 }}>
              Guesty runs this calendar, so prices, minimums and closures are set in Guesty or PriceLabs and mirrored here. Setting a range unlocks once the home is flipped to Helm.
            </p>
          ) : (
            <form action={bulkSetRateDaysForm} style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="month" value={month} />
              <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>
                Tick the fields to change; unticked fields keep each night&apos;s current value. A blank price returns the nights to the plan&apos;s own rate; a blank minimum returns them to the plan default.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="From (first night)">
                  <input name="start" type="date" required defaultValue={monthStart >= today ? monthStart : today} style={inputStyle} />
                </Field>
                <Field label="To (last night, inclusive)">
                  <input name="end" type="date" required defaultValue={monthEnd} style={inputStyle} />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'end' }}>
                {owner && (
                  <Field label={<Tick name="touch_price" label="Nightly rate" />}>
                    <input name="nightly" type="text" inputMode="decimal" placeholder={planNightlyCents != null ? `plan: $${Math.round(planNightlyCents / 100)}` : 'no plan'} style={inputStyle} />
                  </Field>
                )}
                <Field label={<Tick name="touch_min" label="Minimum nights" />}>
                  <input name="min_nights" type="number" min={1} max={365} placeholder={planMinNights != null ? `plan: ${planMinNights}` : ''} style={inputStyle} />
                </Field>
                <Field label={<Tick name="touch_closed" label="Closed" />}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, height: 40 }}>
                    <input name="closed" type="checkbox" /> Helm sales only
                  </label>
                </Field>
                <Field label={<Tick name="touch_note" label="Note" />}>
                  <input name="note" type="text" placeholder="why" style={inputStyle} />
                </Field>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>
                Closed stops Helm&apos;s own sales only (staycapeann.com and quotes). Airbnb, VRBO and Booking.com keep selling a closed night. To close nights on every channel,{' '}
                <Link href={`/channels/bookings/new?type=block&property=${propertyId}`} style={{ color: 'var(--ink)' }}>hold them</Link>.
              </p>
              <div>
                <SubmitButton label="Apply to range" busyLabel="Applying…" style={primaryButton} />
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

/** Future vacant nights that are not for sale, grouped by why. */
export function unsellableReasons(cells: CalendarCellVM[], today: string): Array<{ reason: UnsellableReason; dates: string[] }> {
  const byReason = new Map<UnsellableReason, string[]>();
  for (const c of cells) {
    if (c.reason && c.reason !== 'stay' && c.reason !== 'block' && c.reason !== 'past' && c.date >= today) {
      const list = byReason.get(c.reason) ?? [];
      list.push(c.date);
      byReason.set(c.reason, list);
    }
  }
  return [...byReason.entries()].map(([reason, dates]) => ({ reason, dates })).sort((a, b) => b.dates.length - a.dates.length);
}

/** "10-03 to 10-05, 10-09" from ISO dates. */
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
