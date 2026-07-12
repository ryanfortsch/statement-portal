'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { PhotoUploader } from '@/components/PhotoUploader';
import { completeMaintenanceStop, completeAttachedSlip } from '../../actions';

/**
 * Completion for a maintenance task. One tap marks it done — the note and photo
 * are opt-in, not a required paragraph (a restock or a quick fix shouldn't be
 * gated on writing prose). Serves a maintenance STOP (stopId) and an ATTACHED
 * slip riding on any stop (attachmentId).
 */
function DoneButton({ label }: { label: string }) {
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

export function MaintenanceComplete({
  packetId,
  stopId,
  attachmentId,
  label = 'Mark done',
  placeholder,
  photoNudge = false,
}: {
  packetId: string;
  stopId?: string;
  attachmentId?: string;
  label?: string;
  placeholder?: string;
  /** For real repair/task work slips: lead with a photo prompt of the FINISHED
   *  work (still optional — Mark done never blocks on it). */
  photoNudge?: boolean;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [showDetail, setShowDetail] = useState(false);
  const isAttachment = !!attachmentId;
  return (
    <form action={isAttachment ? completeAttachedSlip : completeMaintenanceStop} style={{ margin: '10px 0 0' }}>
      <input type="hidden" name="packet_id" value={packetId} />
      {isAttachment ? (
        <input type="hidden" name="attachment_id" value={attachmentId} />
      ) : (
        <input type="hidden" name="stop_id" value={stopId ?? ''} />
      )}
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />

      {showDetail && (
        <div style={{ marginBottom: 10 }}>
          {photoNudge && (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tide-deep)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              📷 Snap a photo of the finished work
            </div>
          )}
          {/* /api/upload accepts the contractor cookie too (dual-plane) and
              honors the folder hint — /api/field/upload is avatar-specific
              and filed these under field-avatars/. Photo first when nudging. */}
          <PhotoUploader value={photos} onChange={setPhotos} folder="field-maintenance" />
          <textarea
            name="resolution"
            rows={2}
            placeholder={placeholder ?? 'What you did (optional)'}
            style={{ width: '100%', font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px', resize: 'vertical', marginTop: 8 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <DoneButton label={label} />
        {!showDetail && (
          <button
            type="button"
            onClick={() => setShowDetail(true)}
            style={
              photoNudge
                ? { background: 'var(--paper)', border: '1px solid var(--tide)', borderRadius: 999, cursor: 'pointer', padding: '9px 15px', minHeight: 40, fontSize: 12.5, fontWeight: 600, color: 'var(--tide-deep)', display: 'inline-flex', alignItems: 'center', gap: 6 }
                : { background: 'none', border: 'none', cursor: 'pointer', padding: '10px 12px', margin: '-10px -12px', minHeight: 40, fontSize: 12, color: 'var(--ink-4)', textDecoration: 'underline' }
            }
          >
            {photoNudge ? '📷 Add a photo of your work' : '+ add note or photo'}
          </button>
        )}
      </div>
    </form>
  );
}
