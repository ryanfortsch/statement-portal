'use client';

import { useState } from 'react';

export type OfferableContractor = { id: string; name: string };

/** Aim a packet at specific specialists instead of the whole roster. Mirrors
 *  the board's bundle offer (InspectionCalendar): it changes who SEES the
 *  packet and gets the text, never how it is claimed - first tap still wins.
 *  Picks ride out as repeated `offer_to` fields, so the form works unchanged
 *  if the toggles never hydrate. */
export function OfferToPicker({ contractors }: { contractors: OfferableContractor[] }) {
  const [offerTo, setOfferTo] = useState<string[]>([]);
  if (contractors.length === 0) return null;

  const toggle = (id: string) => setOfferTo((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const names = contractors.filter((c) => offerTo.includes(c.id)).map((c) => c.name.split(' ')[0]);

  return (
    <div style={{ marginBottom: 18 }}>
      {offerTo.map((id) => (
        <input key={id} type="hidden" name="offer_to" value={id} />
      ))}
      <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}>
        Offer to{' '}
        <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>
          (optional; nobody picked means every specialist sees it)
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }} role="group" aria-label="Who this packet is offered to">
        {contractors.map((c) => {
          const on = offerTo.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              title={on ? 'Only the picked specialists will see it' : `Offer this only to ${c.name}`}
              style={{
                font: 'inherit',
                fontSize: 12.5,
                cursor: 'pointer',
                borderRadius: 999,
                padding: '6px 11px',
                border: `1px solid ${on ? 'var(--tide-deep)' : 'var(--rule)'}`,
                background: on ? 'rgba(58,107,138,0.12)' : 'var(--paper-2, #fff)',
                color: on ? 'var(--tide-deep)' : 'var(--ink-3)',
                fontWeight: on ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {on ? '✓ ' : ''}
              {c.name.split(' ')[0]}
            </button>
          );
        })}
        {offerTo.length > 0 && (
          <button
            type="button"
            onClick={() => setOfferTo([])}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11.5, textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}
          >
            everyone
          </button>
        )}
      </div>
      {names.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--tide-deep)', marginTop: 8 }}>
          Only {names.join(' & ')} {names.length === 1 ? 'sees' : 'see'} this on their board and {names.length === 1 ? 'gets' : 'get'} the
          text. They still claim it themselves.
        </div>
      )}
    </div>
  );
}
