'use client';

import { useActionState, useEffect, useRef } from 'react';
import { SubmitButton } from '@/components/SubmitButton';
import { TRADE_CATEGORIES, STANDING_ORDER, STANDING_META, type TradeVendorRow } from '@/lib/trades';
import { saveTradeVendor, type TradeFormState } from './actions';

/**
 * The one add/edit form for a trade vendor. Same component both ways,
 * discriminated by whether a `vendor` came in: a hidden id turns the
 * insert into an update.
 *
 * useActionState (the AdhocForm pattern) so a rejected save renders an
 * inline reason and the form stays mounted with everything typed,
 * instead of silently re-landing on the list.
 *
 * Only name and trade are required. A number scrawled off a truck door
 * is worth capturing before we know the license number or whether the
 * COI is current, so every other field is optional.
 */

function InlineError({ error }: { error: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);
  if (!error) return null;
  return (
    <div
      ref={ref}
      role="alert"
      style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 14, marginBottom: 16, borderRadius: 6 }}
    >
      {error}
    </div>
  );
}

export function VendorForm({
  vendor,
  properties,
  trade,
  defaultCategory,
}: {
  vendor?: TradeVendorRow;
  properties: { id: string; name: string }[];
  /** The job type the operator is browsing, carried through the save so the
   *  landing keeps their row-1 tab. */
  trade: string;
  defaultCategory?: string;
}) {
  const [state, formAction] = useActionState<TradeFormState, FormData>(saveTradeVendor, { error: '' });
  const insuredDefault = vendor?.insured == null ? '' : vendor.insured ? 'yes' : 'no';

  return (
    <form action={formAction} style={{ maxWidth: 620 }}>
      {vendor && <input type="hidden" name="id" value={vendor.id} />}
      <input type="hidden" name="trade" value={trade} />

      <div style={row2}>
        <label style={lbl}>
          Company *
          <input type="text" name="name" required maxLength={200} defaultValue={vendor?.name ?? ''} placeholder="e.g. Cape Ann Plumbing & Heating" style={inp} />
        </label>
        <label style={lbl}>
          Trade *
          <select name="category" required defaultValue={vendor?.category ?? defaultCategory ?? ''} style={inp}>
            <option value="" disabled>Choose the trade…</option>
            {TRADE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={row2}>
        <label style={lbl}>
          Who we ask for
          <input type="text" name="contact_name" maxLength={120} defaultValue={vendor?.contact_name ?? ''} placeholder="e.g. Dave, the owner" style={inp} />
        </label>
        <label style={lbl}>
          Standing
          <select name="standing" defaultValue={vendor?.standing ?? 'backup'} style={inp}>
            {STANDING_ORDER.map((s) => (
              <option key={s} value={s}>{STANDING_META[s].label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={row2}>
        <label style={lbl}>
          Phone
          <input type="tel" name="phone" maxLength={40} defaultValue={vendor?.phone ?? ''} placeholder="978-555-0100" style={inp} />
        </label>
        <label style={lbl}>
          After-hours number <span style={hint}>(if different)</span>
          <input type="tel" name="after_hours_phone" maxLength={40} defaultValue={vendor?.after_hours_phone ?? ''} placeholder="cell / emergency line" style={inp} />
        </label>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)', margin: '0 0 18px' }}>
        <input type="checkbox" name="emergency" defaultChecked={vendor?.emergency ?? false} />
        Takes after-hours and same-day emergency calls
      </label>

      <div style={row2}>
        <label style={lbl}>
          Email
          <input type="email" name="email" maxLength={200} defaultValue={vendor?.email ?? ''} style={inp} />
        </label>
        <label style={lbl}>
          Website
          <input type="url" name="website" maxLength={300} defaultValue={vendor?.website ?? ''} placeholder="https://" style={inp} />
        </label>
      </div>

      <div style={row2}>
        <label style={lbl}>
          Service area
          <input type="text" name="service_area" maxLength={200} defaultValue={vendor?.service_area ?? ''} placeholder="e.g. Cape Ann + North Shore" style={inp} />
        </label>
        <label style={lbl}>
          Rates <span style={hint}>(how they bill)</span>
          <input type="text" name="rate_note" maxLength={300} defaultValue={vendor?.rate_note ?? ''} placeholder="e.g. $135/hr, 2hr minimum" style={inp} />
        </label>
      </div>

      <label style={lbl}>
        Homes they cover <span style={hint}>(leave everything unpicked when they serve the whole fleet)</span>
        <select name="property_ids" multiple defaultValue={vendor?.property_ids ?? []} size={Math.min(8, Math.max(4, properties.length))} style={{ ...inp, height: 'auto' }}>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <div style={row3}>
        <label style={lbl}>
          Our account #
          <input type="text" name="account_number" maxLength={80} defaultValue={vendor?.account_number ?? ''} style={inp} />
        </label>
        <label style={lbl}>
          License #
          <input type="text" name="license_number" maxLength={80} defaultValue={vendor?.license_number ?? ''} style={inp} />
        </label>
        <label style={lbl}>
          Last used
          <input type="date" name="last_used_on" defaultValue={vendor?.last_used_on ?? ''} style={inp} />
        </label>
      </div>

      <div style={row3}>
        <label style={lbl}>
          Insured
          <select name="insured" defaultValue={insuredDefault} style={inp}>
            <option value="">Don&apos;t know</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label style={lbl}>
          COI expires
          <input type="date" name="coi_expires_on" defaultValue={vendor?.coi_expires_on ?? ''} style={inp} />
        </label>
        <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', paddingBottom: 10 }}>
          <input type="checkbox" name="w9_on_file" defaultChecked={vendor?.w9_on_file ?? false} />
          W-9 on file
        </label>
      </div>

      <label style={lbl}>
        Notes <span style={hint}>(what they&apos;re good at, what to watch for, who referred them)</span>
        <textarea name="notes" rows={3} defaultValue={vendor?.notes ?? ''} style={{ ...inp, resize: 'vertical' }} />
      </label>

      <InlineError error={state.error} />
      <SubmitButton
        label={vendor ? 'Save changes' : 'Add to the directory'}
        busyLabel="Saving…"
        style={btnDark}
      />
    </form>
  );
}

const row2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' };
const row3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 18px' };
const hint: React.CSSProperties = { color: 'var(--ink-4)', fontWeight: 400 };
const lbl: React.CSSProperties = { fontSize: 13, color: 'var(--ink-3)', display: 'block', marginBottom: 18, fontWeight: 500 };
const inp: React.CSSProperties = {
  display: 'block',
  width: '100%',
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '10px 12px',
  marginTop: 6,
  boxSizing: 'border-box',
};
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '9px 18px',
};
