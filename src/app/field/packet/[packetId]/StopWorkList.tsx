'use client';

import { useState, useTransition } from 'react';
import { PhotoUploader, PhotoThumbs } from '@/components/PhotoUploader';
import { completeAttachedSlipInFlow } from '../../actions';

export type StopWorkItem = {
  attachmentId: string;
  title: string;
  /** Inline qualifier after the title (location). */
  sub: string | null;
  bring: string | null;
  note: string | null;
  thumbs: string[];
  done: boolean;
  kind: 'task' | 'restock';
};

/**
 * EVERYTHING extra at a stop as one list, one visual language: tap the circle,
 * it's done (optimistic, quiet revert on failure). Tasks differ from restocks
 * only in what the row shows (note, reference photos) and a small "photo" link
 * that opens the note+photo form for when proof is worth attaching. The old
 * layout repeated a full MARK DONE + add-a-photo block per task; that's gone.
 */
export function StopWorkList({ packetId, items, readOnly = false }: { packetId: string; items: StopWorkItem[]; readOnly?: boolean }) {
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set(items.filter((i) => i.done).map((i) => i.attachmentId)));
  const [openId, setOpenId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [, start] = useTransition();

  const markDone = (id: string) => setDoneIds((prev) => new Set([...prev, id]));
  const unmark = (id: string) =>
    setDoneIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  function tap(id: string) {
    if (readOnly || doneIds.has(id)) return;
    markDone(id);
    if (openId === id) setOpenId(null);
    start(async () => {
      const res = await completeAttachedSlipInFlow({ packetId, attachmentId: id, note: '', photoUrls: [] });
      if (!res.ok) unmark(id);
    });
  }

  function submitWithDetail(id: string) {
    if (doneIds.has(id) || saving) return;
    setSaving(true);
    markDone(id);
    const payload = { packetId, attachmentId: id, note: note.trim(), photoUrls: photos };
    start(async () => {
      const res = await completeAttachedSlipInFlow(payload);
      setSaving(false);
      if (!res.ok) {
        unmark(id);
      } else {
        setOpenId(null);
        setPhotos([]);
        setNote('');
      }
    });
  }

  const tasks = items.filter((i) => i.kind === 'task');
  const restocks = items.filter((i) => i.kind === 'restock');
  const restockLeft = restocks.filter((i) => !doneIds.has(i.attachmentId)).length;

  const label = (text: string) => (
    <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, margin: '14px 0 2px' }}>
      {text}
    </div>
  );

  const row = (i: StopWorkItem) => {
    const done = doneIds.has(i.attachmentId);
    const open = openId === i.attachmentId;
    return (
      <div key={i.attachmentId} style={{ borderBottom: '1px solid var(--rule-soft, var(--rule))' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 2px' }}>
          <button
            type="button"
            onClick={() => tap(i.attachmentId)}
            disabled={done || readOnly}
            aria-label={done ? 'Done' : `Mark ${i.title} done`}
            style={{ background: 'none', border: 'none', padding: 0, marginTop: 1, cursor: done || readOnly ? 'default' : 'pointer', flexShrink: 0, minWidth: 30, minHeight: 30, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}
          >
            <span
              aria-hidden
              style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${done ? 'var(--positive)' : 'var(--rule)'}`, background: done ? 'var(--positive)' : 'transparent', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1 }}
            >
              {done ? '✓' : ''}
            </span>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: i.kind === 'task' ? 500 : 400, color: done ? 'var(--ink-4)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none' }}>
              {i.title}
              {i.sub && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> · {i.sub}</span>}
            </span>
            {!done && i.bring && (
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 3 }}>
                <span style={{ color: 'var(--ink-4)' }}>Bring: </span>{i.bring}
              </div>
            )}
            {!done && i.note && (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.5 }}>
                <span style={{ color: 'var(--tide-deep)', fontWeight: 600 }}>Note: </span>{i.note}
              </div>
            )}
            {!done && i.thumbs.length > 0 && <PhotoThumbs urls={i.thumbs} size={40} />}
            {open && !done && (
              <div style={{ margin: '10px 0 4px' }}>
                <PhotoUploader value={photos} onChange={setPhotos} folder="field-maintenance" />
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="What you did (optional)"
                  style={{ width: '100%', font: 'inherit', fontSize: 16, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '8px 10px', resize: 'vertical', marginTop: 8 }}
                />
                <button
                  type="button"
                  onClick={() => submitWithDetail(i.attachmentId)}
                  disabled={saving}
                  style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 6, cursor: saving ? 'wait' : 'pointer', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '8px 16px', minHeight: 34, marginTop: 8, opacity: saving ? 0.8 : 1 }}
                >
                  {saving ? 'Saving…' : 'Done, with photo'}
                </button>
              </div>
            )}
          </div>
          {i.kind === 'task' && !done && !readOnly && (
            <button
              type="button"
              onClick={() => {
                setOpenId(open ? null : i.attachmentId);
                setPhotos([]);
                setNote('');
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tide-deep)', fontSize: 12.5, textDecoration: 'underline', textUnderlineOffset: 3, padding: '10px 12px', margin: '-6px -8px', minHeight: 40, flexShrink: 0 }}
            >
              {open ? 'close' : '📷 photo'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 4 }}>
      {tasks.length > 0 && (
        <>
          {label('Also at this stop')}
          {tasks.map(row)}
        </>
      )}
      {restocks.length > 0 && (
        <>
          {label(restockLeft > 0 ? `Restock · ${restockLeft} to go` : 'Restock · all done')}
          {restocks.map(row)}
        </>
      )}
    </div>
  );
}
