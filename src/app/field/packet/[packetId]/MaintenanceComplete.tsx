'use client';

import { useRouter } from 'next/navigation';
import { confirmedSave } from '@/lib/confirmed-save';
import { useRef, useState } from 'react';
import { useFieldFormDraft, FieldDraftStatus } from '@/components/FieldFormDraft';
import { useFormStatus } from 'react-dom';
import { PhotoUploader, useClearPhotoDraft } from '@/components/PhotoUploader';
import { completeMaintenanceTask, checkFieldTaskCompletion } from '../../actions';

/**
 * Completion for a maintenance task. One tap marks it done — the note and photo
 * are opt-in, not a required paragraph (a restock or a quick fix shouldn't be
 * gated on writing prose). Serves a maintenance STOP (stopId) and an ATTACHED
 * slip riding on any stop (attachmentId).
 */
function MaintenanceDraftStatus({ status }: Parameters<typeof FieldDraftStatus>[0]) {
  const { pending } = useFormStatus();
  return pending ? null : <FieldDraftStatus status={status} />;
}

function CompletionFields({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <fieldset disabled={!ready || pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>;
}

function DoneButton({ label, compact = false }: { label: string; compact?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 999, cursor: pending ? 'wait' : 'pointer', fontSize: compact ? 10.5 : 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: compact ? '8px 14px' : '9px 18px', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: pending ? 0.8 : 1 }}
    >
      {pending && <span aria-hidden className="animate-spin" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(245,239,226,0.4)', borderTopColor: 'var(--paper)', borderRadius: '50%' }} />}
      {pending ? 'Saving…' : label}
    </button>
  );
}

export function MaintenanceComplete({
  packetId,
  stopId,
  attachmentId,
  label = 'Mark done',
  placeholder,
  photoNudge = false,
  compact = false,
}: {
  packetId: string;
  stopId?: string;
  attachmentId?: string;
  label?: string;
  placeholder?: string;
  /** Row-sized: smaller button + tighter top margin, for task list rows. */
  compact?: boolean;
  /** For real repair/task work slips: lead with a photo prompt of the FINISHED
   *  work (still optional — Mark done never blocks on it). */
  photoNudge?: boolean;
}) {
  const router = useRouter();
  const submittedData = useRef<FormData | null>(null);
  const busy = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [failedPhotos, setFailedPhotos] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [showDetail, setShowDetail] = useState(false);
  const draftKey = `maintenance:${packetId}:${attachmentId ?? stopId}`;
  const formDraft = useFieldFormDraft(draftKey, { note: '', expense: '' });
  const clearPhotos = useClearPhotoDraft(draftKey);
  const { note, expense } = formDraft.value;
  const setNote = (v: string) => formDraft.set('note', v);
  const setExpense = (v: string) => formDraft.set('expense', v);
  const [error, setError] = useState<string | null>(null);
  const isAttachment = !!attachmentId;
  async function save(data: FormData) {
    if (!formDraft.ready) { busy.current = false; return; }
    setError(null);
    setRetrying(true);
    formDraft.markSubmitted();
    const original = submittedData.current ?? data;
    const wasRetry = !!submittedData.current;
    submittedData.current = original;
    try {
      const confirm = () => checkFieldTaskCompletion({ packetId, stopId, attachmentId });
      const result = await confirmedSave(async () => {
        if (wasRetry && (await confirm()).ok) return { ok: true };
        return completeMaintenanceTask(original);
      }, confirm, { checkReturnedFailure: true });
      if (result.ok) {
        formDraft.clear();
        await clearPhotos(photos);
        setConfirmed(true);
        router.refresh();
      } else {
        setRetrying(true);
        setError(result.error || 'Could not confirm completion. Retry to check the same task.');
      }
    } finally { busy.current = false; }
  }
  if (confirmed) return <p role="status" style={{ fontSize: 13, color: 'var(--positive)' }}>✓ Saved</p>;
  return (
    <form action={save} onSubmit={event => { if (busy.current || photoBusy || failedPhotos || !formDraft.ready) event.preventDefault(); else busy.current = true; }} style={{ margin: compact ? '8px 0 0' : '10px 0 0' }}>
      {!retrying && <MaintenanceDraftStatus status={formDraft.status} />}
      <CompletionFields ready={formDraft.ready && !retrying}>
      <input type="hidden" name="packet_id" value={packetId} />
      {isAttachment ? (
        <input type="hidden" name="attachment_id" value={attachmentId} />
      ) : (
        <input type="hidden" name="stop_id" value={stopId ?? ''} />
      )}
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />

      {(
        <div hidden={!showDetail && !note && !expense} style={{ marginBottom: 10 }}>
          {photoNudge && (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tide-deep)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              📷 Snap a photo of the finished work
            </div>
          )}
          {/* /api/upload accepts the contractor cookie too (dual-plane) and
              honors the folder hint — /api/field/upload is avatar-specific
              and filed these under field-avatars/. Photo first when nudging. */}
          <PhotoUploader disabled={retrying} onUploadingChange={setPhotoBusy} onFailedUploadsChange={setFailedPhotos} draftKey={`maintenance:${packetId}:${attachmentId ?? stopId}`} onRecovered={() => setShowDetail(true)} value={photos} onChange={setPhotos} folder="field-maintenance" />
          <textarea
            name="resolution"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder={placeholder ?? 'What you did (optional)'}
            style={{ width: '100%', font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px', resize: 'vertical', marginTop: 8 }}
          />
          {/* Receipt reimbursement: what they spent out of pocket (drain-o,
              batteries). Rides the payout automatically once entered. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--ink-3)' }}>
            <span style={{ color: 'var(--ink-4)' }}>$</span>
            <input
              type="number"
              name="expense_dollars"
              value={expense}
              onChange={e => setExpense(e.target.value)}
              min={0}
              step={0.01}
              inputMode="decimal"
              placeholder="0.00"
              style={{ width: 110, font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px' }}
            />
            receipt total, if you bought something (add the receipt photo above)
          </label>
        </div>
      )}

      </CompletionFields>
      {error && <p role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <DoneButton label={retrying ? 'Check / retry save' : photoBusy ? 'Uploading photos…' : failedPhotos ? 'Retry or remove failed photos' : label} compact={compact} />
        {!retrying && !showDetail && !note && !expense && (
          <button
            type="button"
            onClick={() => setShowDetail(true)}
            // One loud button per task: Mark done. The photo prompt is a quiet
            // link either way — photoNudge only changes the wording and the
            // photo-first ordering inside the expanded detail.
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 12px', margin: '-10px -12px', minHeight: 44, fontSize: 12.5, color: photoNudge ? 'var(--tide-deep)' : 'var(--ink-4)', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {photoNudge ? '📷 add a photo' : '+ add note or photo'}
          </button>
        )}
      </div>
    </form>
  );
}
