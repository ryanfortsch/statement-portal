'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { PhotoUploader } from '@/components/PhotoUploader';
import { completeBoardSlip, createBoardSlip } from '../actions';

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: pending ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '10px 18px', minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: pending ? 0.8 : 1 }}
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

/** File a new slip for any home — collapsed to one quiet button until wanted. */
export function BoardNewSlip({ properties }: { properties: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ background: 'var(--paper-2, #fff)', border: '1px solid var(--rule)', borderRadius: 10, cursor: 'pointer', color: 'var(--ink)', fontSize: 14, fontWeight: 600, padding: '14px 18px', width: '100%', textAlign: 'left' }}
      >
        + File a work slip
      </button>
    );
  }
  const inp: React.CSSProperties = { width: '100%', font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '10px 12px' };
  return (
    <form action={createBoardSlip} style={{ border: '1px solid var(--rule)', borderRadius: 10, background: 'var(--paper-2, #fff)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>New work slip</div>
      <select name="property_id" required defaultValue="" style={inp}>
        <option value="" disabled>Which home…</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <input name="title" required minLength={3} maxLength={200} placeholder="What needs attention" style={inp} />
      <textarea name="description" rows={2} placeholder="Details (optional)" style={{ ...inp, resize: 'vertical' }} />
      <select name="priority" defaultValue="normal" style={inp}>
        <option value="low">Low priority</option>
        <option value="normal">Normal priority</option>
        <option value="high">High priority</option>
      </select>
      <PhotoUploader value={photos} onChange={setPhotos} folder="field-board" />
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <SubmitBtn label="File it" />
        <button type="button" onClick={() => setOpen(false)} style={quietBtn}>cancel</button>
      </div>
    </form>
  );
}
