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
}: {
  packetId: string;
  stopId?: string;
  attachmentId?: string;
  label?: string;
  placeholder?: string;
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
          <textarea
            name="resolution"
            rows={2}
            placeholder={placeholder ?? 'What you did (optional)'}
            style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px', resize: 'vertical' }}
          />
          <div style={{ marginTop: 8 }}>
            <PhotoUploader value={photos} onChange={setPhotos} folder="field-maintenance" endpoint="/api/field/upload" />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <DoneButton label={label} />
        {!showDetail && (
          <button
            type="button"
            onClick={() => setShowDetail(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: 'var(--ink-4)', textDecoration: 'underline' }}
          >
            + add note or photo
          </button>
        )}
      </div>
    </form>
  );
}
