'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { PhotoUploader } from '@/components/PhotoUploader';
import { completeBoardSlip } from '../actions';

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  // Pill, not slab: this button repeats on every slip, so its visual weight
  // sets the whole board's noise floor. Still a 36px+ touch target.
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 999, cursor: pending ? 'wait' : 'pointer', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '9px 16px', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: pending ? 0.8 : 1 }}
    >
      {pending && <span aria-hidden className="animate-spin" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(245,239,226,0.4)', borderTopColor: 'var(--paper)', borderRadius: '50%' }} />}
      {pending ? 'Saving…' : label}
    </button>
  );
}

const quietBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--tide-deep)',
  fontSize: 12.5,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  padding: '8px 4px',
};

/** "$ receipt total": what they spent out of pocket for the house. Rides the
 *  trip they are on (or just finished) at that home; otherwise the office
 *  folds it into their next payout. Same rail as a packet task completion, so
 *  a receipt filed from the board is never just a number in a description. */
function ReceiptField({ hint }: { hint: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--ink-4)' }}>$</span>
      <input
        type="number"
        name="expense_dollars"
        min={0}
        step={0.01}
        inputMode="decimal"
        placeholder="0.00"
        style={{ width: 110, font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px' }}
      />
      {hint}
    </label>
  );
}

/** Mark-done for one board slip: one tap; note + photo opt-in (same manners as
 *  the packet task completion — never gate a quick fix on prose). */
export function BoardSlipDone({ slipId }: { slipId: string }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [showDetail, setShowDetail] = useState(false);
  return (
    <form action={completeBoardSlip} style={{ margin: '8px 0 0' }}>
      <input type="hidden" name="slip_id" value={slipId} />
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />
      {showDetail && (
        <div style={{ marginBottom: 10 }}>
          <PhotoUploader value={photos} onChange={setPhotos} folder="field-board" />
          <textarea
            name="resolution"
            rows={2}
            placeholder="What you did (optional)"
            style={{ width: '100%', font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px', resize: 'vertical', marginTop: 8 }}
          />
          <ReceiptField hint="receipt total, if you bought something (add the receipt photo above)" />
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <SubmitBtn label="Mark done" />
        {!showDetail && (
          <button type="button" onClick={() => setShowDetail(true)} style={quietBtn}>
            + add note or photo
          </button>
        )}
      </div>
    </form>
  );
}
