'use client';

import { useState } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { completeMaintenanceStop } from '../../actions';

/** Maintenance stop completion: a resolution note + optional photos of the
 *  finished work (uploaded via the contractor-auth endpoint). */
export function MaintenanceComplete({ packetId, stopId }: { packetId: string; stopId: string }) {
  const [photos, setPhotos] = useState<string[]>([]);
  return (
    <form action={completeMaintenanceStop} style={{ margin: '12px 0 0' }}>
      <input type="hidden" name="packet_id" value={packetId} />
      <input type="hidden" name="stop_id" value={stopId} />
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />
      <textarea
        name="resolution"
        required
        rows={2}
        placeholder="What did you do? (e.g. replaced the disposal, tested, cleaned up)"
        style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px', resize: 'vertical' }}
      />
      <div style={{ marginTop: 8 }}>
        <PhotoUploader value={photos} onChange={setPhotos} folder="field-maintenance" endpoint="/api/field/upload" />
      </div>
      <button
        type="submit"
        style={{ marginTop: 8, background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '9px 16px' }}
      >
        Mark job done
      </button>
    </form>
  );
}
