'use client';

import { useState } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { completeMaintenanceStop, completeAttachedSlip } from '../../actions';

/**
 * Completion form for a maintenance task: a resolution note + optional photos of
 * the finished work (uploaded via the contractor-auth endpoint). Serves two
 * paths: a maintenance STOP (pass stopId -> completeMaintenanceStop, closes the
 * stop) and an ATTACHED slip riding on any stop (pass attachmentId ->
 * completeAttachedSlip, stamps just that attachment, leaves the stop alone).
 */
export function MaintenanceComplete({
  packetId,
  stopId,
  attachmentId,
  label = 'Mark job done',
  placeholder,
}: {
  packetId: string;
  stopId?: string;
  attachmentId?: string;
  label?: string;
  placeholder?: string;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const isAttachment = !!attachmentId;
  return (
    <form action={isAttachment ? completeAttachedSlip : completeMaintenanceStop} style={{ margin: '12px 0 0' }}>
      <input type="hidden" name="packet_id" value={packetId} />
      {isAttachment ? (
        <input type="hidden" name="attachment_id" value={attachmentId} />
      ) : (
        <input type="hidden" name="stop_id" value={stopId ?? ''} />
      )}
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />
      <textarea
        name="resolution"
        required
        rows={2}
        placeholder={placeholder ?? 'What did you do? (e.g. replaced the disposal, tested, cleaned up)'}
        style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px', resize: 'vertical' }}
      />
      <div style={{ marginTop: 8 }}>
        <PhotoUploader value={photos} onChange={setPhotos} folder="field-maintenance" endpoint="/api/field/upload" />
      </div>
      <button
        type="submit"
        style={{ marginTop: 8, background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '9px 16px' }}
      >
        {label}
      </button>
    </form>
  );
}
