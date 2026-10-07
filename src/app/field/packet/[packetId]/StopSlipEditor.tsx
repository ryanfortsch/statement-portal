'use client';

import { useEffect, useRef, useState } from 'react';
import { useFieldFormDraft, FieldDraftStatus } from '@/components/FieldFormDraft';
import { PhotoUploader, PhotoThumbs, useClearPhotoDraft } from '@/components/PhotoUploader';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { updateSlipFromStop } from '../../actions';

type Saved = { title: string; description: string | null; photoUrls: string[] };
export function StopSlipEditor({ packetId, stopId, workSlipId, title, description, photos, readOnly = false, onSaved, onCancel, onGuardChange }: {
  packetId: string; stopId: string; workSlipId: string; title: string; description: string | null; photos: string[]; readOnly?: boolean;
  onSaved: (saved: Saved) => void; onCancel: () => void; onGuardChange: (dirty: boolean, busy: boolean) => void;
}) {
  const draftKey = `slip-edit:${packetId}:${stopId}:${workSlipId}`;
  const clearDraft = useClearPhotoDraft(draftKey);
  const [tab, setTab] = useState<'details' | 'photos'>('details');
  const formDraft = useFieldFormDraft(readOnly ? undefined : draftKey, { title, description: description || '' });
  const { title: draftTitle, description: draftDescription } = formDraft.value;
  const setTitle = (v: string) => formDraft.set('title', v);
  const setDescription = (v: string) => formDraft.set('description', v);
  const [added, setAdded] = useState<string[]>([]), [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [failedUploads, setFailedUploads] = useState(0);
  const action = useRecoverableAction();
  const dirty = draftTitle !== title || draftDescription !== (description || '') || added.length > 0 || failedUploads > 0;
  const busy = !formDraft.ready || action.pending || uploading;
  useDraftNavigationGuard(dirty, busy);
  useEffect(() => { onGuardChange(dirty, busy); }, [dirty, busy, onGuardChange]);
  useEffect(() => () => onGuardChange(false, false), [onGuardChange]);
  function save() {
    if (!formDraft.ready || readOnly || action.busy.current || uploadingRef.current || failedUploads > 0) return;
    if (added.length > 12) { action.setError('Save up to 12 new photos at a time. Remove extra photos before saving.'); return; }
    const cleanTitle = draftTitle.trim();
    if (cleanTitle.length < 3) { action.setError('Give it a short title first.'); return; }
    action.run(async () => {
      const result = await updateSlipFromStop({ packetId, stopId, workSlipId, title: cleanTitle, description: draftDescription, photoUrls: added });
      if (!result.ok) { action.setError('Could not save this slip. Your text and photos are kept. Try again.'); return; }
      formDraft.clear();
      await clearDraft(added);
      onSaved({ title: cleanTitle, description: draftDescription.trim() || null, photoUrls: result.photoUrls });
    }, 'Could not confirm the save. Your text and photos are kept. Retry to save the same photos.');
  }
  return <div>
    <FieldDraftStatus status={formDraft.status} />
    <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>Edit this slip</div>
    <div role="tablist" aria-label="Slip editor" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      <button type="button" role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')} style={tab === 'details' ? dark : ghost}>Details</button>
      <button type="button" role="tab" aria-selected={tab === 'photos'} onClick={() => setTab('photos')} style={tab === 'photos' ? dark : ghost}>Photos ({photos.length + added.length})</button>
    </div>
    <div hidden={tab !== 'details'} role="tabpanel" aria-label="Details">
      <input aria-label="Slip title" disabled={action.pending || readOnly} value={draftTitle} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="What needs attention" style={field}/>
      <textarea aria-label="Slip details" disabled={action.pending || readOnly} value={draftDescription} onChange={e => setDescription(e.target.value)} rows={4} maxLength={4000} placeholder="Details (optional)" style={{ ...field, marginTop: 8, resize: 'vertical' }}/>
    </div>
    <div hidden={tab !== 'photos'} role="tabpanel" aria-label="Photos">
      {photos.length > 0 && <PhotoThumbs urls={photos} size={64}/>}
      <p style={{ fontSize: 13 }}>Add photos of the issue. Saving keeps this slip open.</p>
      <PhotoUploader draftKey={draftKey} onRecovered={() => setTab('photos')} value={added} onChange={setAdded} folder="field-maintenance" onFailedUploadsChange={setFailedUploads} endpoint="/api/field/upload" disabled={action.pending || readOnly} onUploadingChange={value => { uploadingRef.current = value; setUploading(value); onGuardChange(dirty, value || action.busy.current); }}/>
    </div>
    {failedUploads > 0 && <p role="alert">Retry or remove failed uploads before saving.</p>}
    {action.error && <p role="alert" style={{ color: 'var(--signal)' }}>{action.error}</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      <button type="button" onClick={save} disabled={busy || readOnly || failedUploads > 0} style={dark}>{uploading ? 'Uploading photos…' : action.pending ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={() => { if (!action.busy.current && !uploadingRef.current) onCancel(); }} disabled={busy} style={ghost}>Cancel</button>
    </div>
  </div>;
}
const field: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, padding: '9px 11px' };
const pill: React.CSSProperties = { font: 'inherit', fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '9px 14px', minHeight: 38, cursor: 'pointer' };
const dark = { ...pill, background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' };
const ghost = { ...pill, background: 'var(--paper-2, #fff)', color: 'var(--ink-3)', border: '1px solid var(--rule)' };
