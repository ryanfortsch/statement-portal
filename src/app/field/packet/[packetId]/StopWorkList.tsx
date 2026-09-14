'use client';

import { useState, useTransition } from 'react';
import { PhotoUploader, PhotoThumbs } from '@/components/PhotoUploader';
import { resolveSlipFromStop, updateSlipFromStop } from '../../actions';

export type StopWorkItem = {
  slipId: string;
  /** 'stop' = pinned to this stop by the office (or Helm's restock
   *  auto-attach); 'home' = every other open slip at this home, shown by
   *  default so a known issue never hides behind a forgotten attach. */
  group: 'stop' | 'home';
  title: string;
  /** Inline qualifier after the title (location). */
  sub: string | null;
  description: string | null;
  bring: string | null;
  /** The office's per-trip note on a pinned slip. */
  note: string | null;
  thumbs: string[];
  done: boolean;
  kind: 'task' | 'restock';
  priority: string;
  categoryLabel: string;
  /** "Opened 3 days ago by the office" */
  opened: string;
  /** Short triage facts worth a chip: needs a pro, waiting on the owner, a
   *  scheduled day, the last time someone confirmed it was still open. */
  flags: string[];
};

type PanelMode = 'info' | 'photo' | 'handled' | 'edit';

const pill: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  borderRadius: 999,
  padding: '9px 14px',
  minHeight: 38,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const pillDark: React.CSSProperties = { ...pill, background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' };
const pillGhost: React.CSSProperties = { ...pill, background: 'var(--paper-2, #fff)', color: 'var(--ink-3)', border: '1px solid var(--rule)' };
const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  fontSize: 16,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  padding: '9px 11px',
};

/**
 * EVERYTHING to do at a stop as one list, one visual language: tap the circle
 * and it's done (optimistic, quiet revert on failure); tap the (i) and the
 * row opens into what the slip actually is: details, where, who opened it and
 * when, the office's note, photos, and the verbs that need a second thought
 * (done with a photo or note; already handled when you got there; fix the
 * wording). The office's pinned tasks lead; every other open slip at the
 * home follows, so the inspector standing in the room sees the whole list,
 * not just what someone remembered to attach.
 */
export function StopWorkList({
  packetId,
  stopId,
  items,
  onOtherTrip = 0,
  readOnly = false,
}: {
  packetId: string;
  stopId: string;
  items: StopWorkItem[];
  /** Open slips at this home that another live trip already carries. */
  onOtherTrip?: number;
  readOnly?: boolean;
}) {
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set(items.filter((i) => i.done).map((i) => i.slipId)));
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<PanelMode>('info');
  // Wording the inspector fixed from the door, kept locally so the row reads
  // right before the page refreshes.
  const [edits, setEdits] = useState<Map<string, { title: string; description: string | null }>>(new Map());
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [expense, setExpense] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();

  const markDone = (id: string) => setDoneIds((prev) => new Set([...prev, id]));
  const unmark = (id: string) =>
    setDoneIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  function resetForms() {
    setPhotos([]);
    setNote('');
    setExpense('');
    setErr(null);
  }
  function openPanel(i: StopWorkItem, m: PanelMode) {
    resetForms();
    const cur = edits.get(i.slipId);
    setEditTitle(cur?.title ?? i.title);
    setEditDesc(cur?.description ?? i.description ?? '');
    setOpenId(i.slipId);
    setMode(m);
  }
  function closePanel() {
    setOpenId(null);
    setMode('info');
    resetForms();
  }

  function tap(i: StopWorkItem) {
    if (readOnly || doneIds.has(i.slipId)) return;
    markDone(i.slipId);
    if (openId === i.slipId) closePanel();
    start(async () => {
      const res = await resolveSlipFromStop({ packetId, stopId, workSlipId: i.slipId, outcome: 'done', note: '', photoUrls: [] });
      if (!res.ok) unmark(i.slipId);
    });
  }

  function submitDone(i: StopWorkItem) {
    if (doneIds.has(i.slipId) || saving) return;
    setSaving(true);
    setErr(null);
    const expNum = Number(expense);
    start(async () => {
      const res = await resolveSlipFromStop({
        packetId,
        stopId,
        workSlipId: i.slipId,
        outcome: 'done',
        note: note.trim(),
        photoUrls: photos,
        expenseCents: Number.isFinite(expNum) && expNum > 0 ? Math.round(expNum * 100) : null,
      });
      setSaving(false);
      if (!res.ok) {
        setErr("Couldn't save that. Check your signal and try again.");
        return;
      }
      markDone(i.slipId);
      closePanel();
    });
  }

  function submitHandled(i: StopWorkItem) {
    if (doneIds.has(i.slipId) || saving) return;
    setSaving(true);
    setErr(null);
    start(async () => {
      const res = await resolveSlipFromStop({ packetId, stopId, workSlipId: i.slipId, outcome: 'already_handled', note: note.trim(), photoUrls: [] });
      setSaving(false);
      if (!res.ok) {
        setErr("Couldn't save that. Check your signal and try again.");
        return;
      }
      markDone(i.slipId);
      closePanel();
    });
  }

  function submitEdit(i: StopWorkItem) {
    if (saving) return;
    const title = editTitle.trim();
    if (title.length < 3) {
      setErr('Give it a short title first.');
      return;
    }
    setSaving(true);
    setErr(null);
    start(async () => {
      const res = await updateSlipFromStop({ packetId, stopId, workSlipId: i.slipId, title, description: editDesc });
      setSaving(false);
      if (!res.ok) {
        setErr("Couldn't save that. Check your signal and try again.");
        return;
      }
      setEdits((prev) => new Map(prev).set(i.slipId, { title, description: editDesc.trim() || null }));
      setMode('info');
    });
  }

  const tasks = items.filter((i) => i.kind === 'task');
  const pinned = tasks.filter((i) => i.group === 'stop');
  const atHome = tasks.filter((i) => i.group === 'home');
  const restocks = items.filter((i) => i.kind === 'restock');
  const left = (list: StopWorkItem[]) => list.filter((i) => !doneIds.has(i.slipId)).length;

  const label = (text: string, hint?: string) => (
    <div style={{ margin: '16px 0 2px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600 }}>{text}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );

  const row = (i: StopWorkItem) => {
    const done = doneIds.has(i.slipId);
    const open = openId === i.slipId;
    const shown = edits.get(i.slipId);
    const title = shown?.title ?? i.title;
    const description = shown ? shown.description : i.description;
    const meta = [i.sub, i.priority === 'high' ? 'high priority' : null, i.thumbs.length ? `${i.thumbs.length} ${i.thumbs.length === 1 ? 'photo' : 'photos'}` : null].filter(Boolean);
    return (
      <div key={i.slipId} style={{ borderBottom: '1px solid var(--rule-soft, var(--rule))' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0' }}>
          <button
            type="button"
            onClick={() => tap(i)}
            disabled={done || readOnly}
            aria-label={done ? 'Done' : `Mark ${title} done`}
            style={{ background: 'none', border: 'none', padding: 0, cursor: done || readOnly ? 'default' : 'pointer', flexShrink: 0, width: 36, minHeight: 36, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', marginLeft: -6 }}
          >
            <span
              aria-hidden
              style={{ width: 24, height: 24, marginTop: 1, borderRadius: '50%', border: `2px solid ${done ? 'var(--positive)' : 'var(--rule)'}`, background: done ? 'var(--positive)' : 'transparent', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1 }}
            >
              {done ? '✓' : ''}
            </span>
          </button>
          <button
            type="button"
            onClick={() => (open ? closePanel() : openPanel(i, 'info'))}
            aria-expanded={open}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '3px 0 0', font: 'inherit', cursor: 'pointer', color: 'inherit' }}
          >
            <div style={{ fontSize: 15, lineHeight: 1.35, fontWeight: 500, color: done ? 'var(--ink-4)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
              {title}
            </div>
            {!done && meta.length > 0 && (
              <div style={{ fontSize: 12.5, color: i.priority === 'high' ? 'var(--signal)' : 'var(--ink-4)', marginTop: 2 }}>{meta.join(' · ')}</div>
            )}
          </button>
          <button
            type="button"
            onClick={() => (open ? closePanel() : openPanel(i, 'info'))}
            aria-label={open ? 'Hide details' : `Details for ${title}`}
            aria-expanded={open}
            style={{ flexShrink: 0, width: 36, height: 36, borderRadius: '50%', border: `1px solid ${open ? 'var(--tide-deep)' : 'var(--rule)'}`, background: open ? 'var(--tide-deep)' : 'var(--paper-2, #fff)', color: open ? 'var(--paper)' : 'var(--tide-deep)', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginRight: -4 }}
          >
            i
          </button>
        </div>

        {open && (
          <div style={{ margin: '0 0 12px', background: 'var(--paper-2, #fff)', border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)' }}>
            {mode === 'edit' ? (
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>Edit this slip</div>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={200}
                  placeholder="What needs attention"
                  style={field}
                />
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="Details (optional)"
                  style={{ ...field, marginTop: 8, resize: 'vertical' }}
                />
                {err && <div style={{ color: 'var(--signal)', fontSize: 13, marginTop: 8 }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <button type="button" onClick={() => submitEdit(i)} disabled={saving} style={{ ...pillDark, opacity: saving ? 0.7 : 1 }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => { setMode('info'); setErr(null); }} disabled={saving} style={pillGhost}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ whiteSpace: 'pre-wrap', color: description ? 'var(--ink)' : 'var(--ink-4)' }}>
                  {description || 'No details on this one. If you are unsure what it means, call the office.'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 8 }}>
                  {[i.categoryLabel, i.sub ? `at ${i.sub}` : null, i.opened].filter(Boolean).join(' · ')}
                </div>
                {i.flags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {i.flags.map((f) => (
                      <span key={f} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '3px 9px', background: 'var(--paper)' }}>
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                {i.note && (
                  <div style={{ marginTop: 10, borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', padding: '7px 10px' }}>
                    <span style={{ color: 'var(--tide-deep)', fontWeight: 600 }}>From the office: </span>{i.note}
                  </div>
                )}
                {i.bring && (
                  <div style={{ marginTop: 8 }}>
                    <span style={{ color: 'var(--ink-4)' }}>Bring: </span>{i.bring}
                  </div>
                )}
                {i.thumbs.length > 0 && <PhotoThumbs urls={i.thumbs} size={64} />}

                {mode === 'photo' && !done && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--rule-soft, var(--rule))' }}>
                    <PhotoUploader value={photos} onChange={setPhotos} folder="field-maintenance" />
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="What you did (optional)"
                      style={{ ...field, marginTop: 8, resize: 'vertical' }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--ink-4)' }}>$</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={expense}
                        onChange={(e) => setExpense(e.target.value)}
                        style={{ ...field, width: 110, display: 'inline-block' }}
                      />
                      receipt total, if you bought something
                    </label>
                    {err && <div style={{ color: 'var(--signal)', fontSize: 13, marginTop: 8 }}>{err}</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      <button type="button" onClick={() => submitDone(i)} disabled={saving} style={{ ...pillDark, opacity: saving ? 0.7 : 1 }}>
                        {saving ? 'Saving…' : 'Mark done'}
                      </button>
                      <button type="button" onClick={() => { setMode('info'); resetForms(); }} disabled={saving} style={pillGhost}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'handled' && !done && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--rule-soft, var(--rule))' }}>
                    <div style={{ color: 'var(--ink-3)' }}>
                      Already taken care of when you got here, or it no longer applies? It comes off the list and the office sees it was found done, not done by you.
                    </div>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Anything the office should know (optional)"
                      style={{ ...field, marginTop: 8, resize: 'vertical' }}
                    />
                    {err && <div style={{ color: 'var(--signal)', fontSize: 13, marginTop: 8 }}>{err}</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      <button type="button" onClick={() => submitHandled(i)} disabled={saving} style={{ ...pillDark, opacity: saving ? 0.7 : 1 }}>
                        {saving ? 'Saving…' : 'Yes, take it off the list'}
                      </button>
                      <button type="button" onClick={() => { setMode('info'); resetForms(); }} disabled={saving} style={pillGhost}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'info' && !done && !readOnly && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button type="button" onClick={() => { resetForms(); setMode('photo'); }} style={pillDark}>
                      Done, with photo or note
                    </button>
                    <button type="button" onClick={() => { resetForms(); setMode('handled'); }} style={pillGhost}>
                      Already handled
                    </button>
                    <button type="button" onClick={() => { resetForms(); setMode('edit'); }} style={pillGhost}>
                      Edit
                    </button>
                  </div>
                )}
                {done && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--positive)', fontWeight: 600 }}>Done on this trip.</div>}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (items.length === 0 && onOtherTrip === 0) return null;

  return (
    <div className="rt-stop-work" style={{ marginTop: 2 }}>
      {pinned.length > 0 && (
        <>
          {label(left(pinned) > 0 ? `At this stop · ${left(pinned)} to do` : 'At this stop · all done')}
          {pinned.map(row)}
        </>
      )}
      {(atHome.length > 0 || onOtherTrip > 0) && (
        <>
          {label(
            atHome.length > 0
              ? left(atHome) > 0
                ? `Also open at this home · ${left(atHome)}`
                : 'Also open at this home · all done'
              : 'Also open at this home',
            pinned.length === 0 && atHome.length > 0
              ? 'Every open work slip here. Tap the circle when one is done, or the i for details.'
              : undefined,
          )}
          {atHome.map(row)}
          {onOtherTrip > 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-4)', padding: '8px 0' }}>
              {onOtherTrip} more {onOtherTrip === 1 ? 'is' : 'are'} on another scheduled trip, so {onOtherTrip === 1 ? 'it closes' : 'they close'} there.
            </div>
          )}
        </>
      )}
      {restocks.length > 0 && (
        <>
          {label(left(restocks) > 0 ? `Restock · ${left(restocks)} to go` : 'Restock · all done')}
          {restocks.map(row)}
        </>
      )}
    </div>
  );
}
