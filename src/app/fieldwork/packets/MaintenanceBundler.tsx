'use client';

import { useMemo, useState } from 'react';
import { centroid, maxPairwiseMiles } from '@/lib/proximity';
import { priceCents, isRushVisit, MAINTENANCE_BASE_CENTS } from '@/lib/field-pricing';
import type { MaintenanceSlip } from '@/lib/field-packets';
import { bundleMaintenance } from './actions';
import { ShowToChips } from './ShowToChips';

/** The Handymen board's planner, in the slot the inspection calendar holds on
 *  the Inspectors board: the open maintenance slips by home, tick the ones one
 *  trip can cover, then the same bundle bar the calendar has (Show to, pay,
 *  Save as draft, Bundle & send). It used to be its own page whose send
 *  redirected to the Inspectors board, where the new packet was filtered out
 *  under a banner saying it was below. */
export function MaintenanceBundler({ slips, assignable }: {
  slips: MaintenanceSlip[];
  /** Handymen who could claim it today, for the Show to chips. */
  assignable: { id: string; name: string }[];
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [sending, setSending] = useState(false);
  // Why the last bundle went nowhere, from the server, kept beside the pick
  // until it changes. Never rides the URL, so a refresh can't replay it.
  const [error, setError] = useState<string | null>(null);
  // Empty = every handyman sees it and gets the text.
  const [offerTo, setOfferTo] = useState<string[]>([]);
  const toggleOffer = (id: string) =>
    setOfferTo((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggle = (id: string) => {
    setError(null);
    setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  // Group the open slips by property for a scannable list.
  const groups = useMemo(() => {
    const m = new Map<string, MaintenanceSlip[]>();
    for (const s of slips) {
      const arr = m.get(s.property_id) ?? [];
      arr.push(s);
      m.set(s.property_id, arr);
    }
    return [...m.entries()].map(([pid, items]) => ({ pid, items }));
  }, [slips]);

  const selSlips = slips.filter((s) => sel.includes(s.id));
  const propPts = useMemo(() => {
    const seen = new Set<string>();
    const pts: { lat: number; lng: number }[] = [];
    for (const s of selSlips) {
      if (s.lat != null && s.lng != null && !seen.has(s.property_id)) {
        seen.add(s.property_id);
        pts.push({ lat: s.lat, lng: s.lng });
      }
    }
    return pts;
  }, [selSlips]);
  const spread = propPts.length > 1 ? maxPairwiseMiles(propPts) : 0;
  const homes = propPts.length;
  const suggested = Math.round(
    priceCents({
      basePrices: selSlips.map(() => MAINTENANCE_BASE_CENTS),
      spreadMiles: spread,
      center: propPts.length ? centroid(propPts) : null,
      isRush: isRushVisit(date || null),
    }) / 100,
  );

  return (
    <div id="maintenance-jobs" style={{ scrollMarginTop: 88 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>
        Open maintenance slips · {slips.length}
      </h2>
      {slips.length === 0 && (
        <p style={{ color: 'var(--ink-4)', fontSize: 13 }}>
          Nothing to bundle.
        </p>
      )}
      {groups.map(({ pid, items }) => (
        <div key={pid} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>
            {items[0].property_name}
          </div>
          <div style={{ border: '1px solid var(--rule)', borderRadius: 8, overflow: 'hidden' }}>
            {items.map((s) => {
              const on = sel.includes(s.id);
              return (
                <label
                  key={s.id}
                  style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderBottom: '1px solid var(--rule)', cursor: 'pointer', background: on ? 'rgba(58,107,138,0.06)' : 'transparent' }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(s.id)} style={{ marginTop: 3 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)' }}>{s.title}</span>
                    {(s.action_summary || s.description) && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                        {s.action_summary || s.description}
                      </span>
                    )}
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                      {s.location ? `${s.location} · ` : ''}priority: {s.priority}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {error && sel.length > 0 && (
        <div
          role="alert"
          style={{ marginTop: 16, border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}
        >
          {error}
        </div>
      )}

      {sel.length > 0 && (
        <form
          action={async (fd: FormData) => {
            setSending(true);
            setError(null);
            try {
              // Both modes redirect on success (the board with a one-shot
              // flash, or the new draft's page) and hand back a reason on
              // failure, with the pick left in place.
              const res = await bundleMaintenance(fd);
              if (res && !res.ok) {
                setError(res.message);
                return;
              }
              setSel([]);
              setDate('');
              setPriceStr('');
              setOfferTo([]);
            } finally {
              setSending(false);
            }
          }}
          style={{ position: 'sticky', bottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', border: '2px solid var(--signal)', borderRadius: 12, padding: '14px 18px', background: 'var(--paper-2, #fff)', marginTop: 24 }}
        >
          <input type="hidden" name="work_slip_ids" value={sel.join(',')} />
          <input type="hidden" name="price_dollars" value={priceStr || String(suggested)} />
          <input type="hidden" name="offer_to" value={offerTo.join(',')} />
          <div>
            <div style={{ fontSize: 15, color: 'var(--ink)' }}>
              {sel.length} {sel.length === 1 ? 'job' : 'jobs'}
              {homes > 1 ? ` · ${homes} homes` : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
              {spread > 0 ? `~${spread < 1 ? '<1' : Math.round(spread)} mi apart · ` : ''}one trip · suggested pay ${suggested} · leave blank to use it
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ShowToChips people={assignable} picked={offerTo} onToggle={toggleOffer} onClear={() => setOfferTo([])} noun="handymen" />
            <label style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              Day
              <input type="date" name="visit_date" required value={date} onChange={(e) => { setDate(e.target.value); setError(null); }} style={inDate} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              Pay $
              <input
                type="number"
                inputMode="numeric"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                placeholder={String(suggested)}
                style={{ ...inDate, width: 90 }}
              />
            </label>
            <button
              type="submit"
              name="mode"
              value="draft"
              disabled={sending || !date}
              style={{ background: 'var(--paper-2, #fff)', color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 8, cursor: sending || !date ? 'default' : 'pointer', opacity: sending || !date ? 0.6 : 1, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 16px', whiteSpace: 'nowrap' }}
            >
              Save as draft
            </button>
            <button
              type="submit"
              name="mode"
              value="send"
              disabled={sending || !date}
              style={{ background: sending || !date ? 'var(--ink-4)' : 'var(--signal)', color: 'var(--paper)', border: 'none', borderRadius: 8, cursor: sending || !date ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '12px 22px', whiteSpace: 'nowrap' }}
            >
              {sending
                ? 'Sending…'
                : offerTo.length
                  ? `Send to ${offerTo.length} ${offerTo.length === 1 ? 'handyman' : 'handymen'} →`
                  : 'Bundle & send →'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const inDate: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  font: 'inherit',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '6px 8px',
};
