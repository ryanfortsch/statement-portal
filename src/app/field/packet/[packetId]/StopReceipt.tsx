'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmedSave } from '@/lib/confirmed-save';
import { PhotoUploader, useClearPhotoDraft } from '@/components/PhotoUploader';
import { ReceiptAmountField } from '@/components/ReceiptAmountField';
import { addStopReceipt, checkStopReceipt } from '../../actions';

/**
 * "Add a receipt": the one receipt rail on a packet stop, a chip in the
 * stop's chip row whether or not the stop has a task. The receipt homes onto
 * this trip's payout. One attempt id per receipt, kept through a lost
 * response, so a retry confirms the first write instead of paying twice.
 */

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

export function StopReceipt({
  packetId,
  stopId,
  existing,
  chipStyle,
}: {
  packetId: string;
  stopId: string;
  /** Receipts already on this trip at this home, so a second tap is a choice. */
  existing: { title: string; cents: number }[];
  chipStyle: React.CSSProperties;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const attempt = useRef<string | null>(null);
  // The exact first submission, replayed by a retry: the fields are frozen
  // (and so absent from a new FormData) while a save is unconfirmed.
  const submitted = useRef<FormData | null>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [added, setAdded] = useState<number | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const draftKey = `receipt:${packetId}:${stopId}`;
  const clearPhotos = useClearPhotoDraft(draftKey);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current || uploading) return;
    busy.current = true;
    // A retry after an uncertain save reuses the first attempt's id and fields.
    if (!submitted.current) {
      attempt.current = crypto.randomUUID();
      const fresh = new FormData(e.currentTarget);
      fresh.set('submission_id', attempt.current);
      submitted.current = fresh;
    }
    const data = submitted.current;
    setPending(true); setError(null);
    try {
      const result = await confirmedSave(
        () => addStopReceipt({ ok: false }, data),
        () => checkStopReceipt(attempt.current!, packetId),
      );
      if (result.ok) {
        const cents = 'cents' in result && typeof result.cents === 'number' ? result.cents : 0;
        void clearPhotos(photos);
        attempt.current = null; submitted.current = null;
        formRef.current?.reset();
        setPhotos([]); setUncertain(false); setOpen(false); setAdded(cents);
        router.refresh();
        return;
      }
      setUncertain(!!result.uncertain);
      if (!result.uncertain) { attempt.current = null; submitted.current = null; }
      setError(result.error ?? 'Could not add the receipt. Try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (!open) {
    return (
      <>
        <button type="button" onClick={() => { setOpen(true); setAdded(null); }} style={chipStyle}>
          Add a receipt
        </button>
        {added != null && (
          <span role="status" style={{ fontSize: 12.5, color: 'var(--positive, #2e7d4f)', alignSelf: 'center' }}>
            ✓ {added > 0 ? money(added) : 'Receipt'} added to this trip&apos;s payout
          </span>
        )}
      </>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      style={{ flexBasis: '100%', border: '1px solid var(--rule)', background: 'var(--paper-2, #fff)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}
    >
      <input type="hidden" name="packet_id" value={packetId} />
      <input type="hidden" name="stop_id" value={stopId} />
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />
      <fieldset disabled={pending || uncertain} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {existing.length > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
            Already on this trip here: {existing.map((r) => `${r.title.replace(/^Receipt: /, '')} ${money(r.cents)}`).join(' · ')}
          </div>
        )}
        <ReceiptAmountField required where="added to this trip's payout" />
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          What was it for?
          <input
            name="what"
            required
            minLength={2}
            maxLength={180}
            autoComplete="off"
            placeholder="e.g. batteries for the smoke alarm"
            style={{ display: 'block', width: '100%', font: 'inherit', fontSize: 16, fontWeight: 400, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 12px', marginTop: 6 }}
          />
        </label>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            Photo of the receipt <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
          </div>
          <PhotoUploader draftKey={draftKey} value={photos} onChange={setPhotos} folder="field-receipts" disabled={pending || uncertain} onUploadingChange={setUploading} />
        </div>
      </fieldset>
      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--signal)', lineHeight: 1.5 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={pending || uploading}
          style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 999, cursor: pending ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '9px 18px', minHeight: 44, opacity: pending ? 0.8 : 1 }}
        >
          {pending ? 'Saving and confirming…' : uploading ? 'Wait for photos…' : uncertain ? 'Check / retry receipt' : 'Add to my payout'}
        </button>
        {!pending && !uncertain && (
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null); attempt.current = null; submitted.current = null; }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 12.5, textDecoration: 'underline', textUnderlineOffset: 3, padding: '8px 4px' }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
