'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import type { AttachedSlip, WorkSlipLite } from '@/lib/field-types';
import { updateStopSlipContent, attachSlipToStop, detachSlipFromStop, updateStopSlipNote, setStopInstructions, setPacketInstructions } from '../actions';

const box: React.CSSProperties = {
  // display:block matters: textareas/selects are inline-level, so without it
  // they render BESIDE their label text (a floating box) instead of below it.
  display: 'block',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '7px 9px',
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
};

const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  fontWeight: 600,
};

const quietBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-4)',
  fontSize: 11,
  textDecoration: 'underline',
  padding: 0,
  flexShrink: 0,
};

/** "Thu, Jul 30" for schedule labels in the attach picker. */
function fmtSlipDay(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

/** "3 days old" for the attach picker; empty when the loader has no date. */
function slipAge(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return d === 0 ? 'new today' : d === 1 ? '1 day old' : `${d} days old`;
}

/** Everything in here autosaves (selects on change, text on click-away). The
 *  header pins that promise so the operator never hunts for a Save button. */
function SaveState({ pending }: { pending: boolean }) {
  return (
    <span style={{ fontSize: 11, color: pending ? 'var(--signal)' : 'var(--ink-4)', flexShrink: 0 }}>
      {pending ? 'Saving…' : 'Saves automatically'}
    </span>
  );
}

/** One attached slip: a tight row. The per-slip note stays tucked behind
 *  "+ add note" unless one exists, so empty note boxes never stack up. */
function AttachedRow({
  packetId,
  a,
  onSave,
  onDetach,
}: {
  packetId: string;
  a: AttachedSlip;
  onSave: (fn: () => Promise<unknown>) => void;
  onDetach: () => void;
}) {
  const [showNote, setShowNote] = useState(!!a.officeNote);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1, minWidth: 0 }}>
          {a.title}
          {a.completedAt ? <span style={{ color: 'var(--positive)', fontSize: 11, fontWeight: 400 }}> · done</span> : null}
        </span>
        {!showNote && (
          <button type="button" onClick={() => setShowNote(true)} style={quietBtn}>
            add note
          </button>
        )}
        <button type="button" onClick={onDetach} style={quietBtn}>
          remove
        </button>
      </div>
      {showNote && (
        <textarea
          rows={1}
          defaultValue={a.officeNote ?? ''}
          placeholder="Note for the inspector on this one"
          autoFocus={!a.officeNote}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (a.officeNote ?? '')) onSave(() => updateStopSlipNote(packetId, a.attachmentId, v));
            if (!v.trim() && !a.officeNote) setShowNote(false);
          }}
          style={box}
        />
      )}
    </div>
  );
}

/**
 * Office control to hand an inspector extra work at one packet stop: attach the
 * property's open work slips (each with an optional note), and write free-form
 * "while you're there" instructions for the stop. Edits are allowed while the
 * packet is still live (incl. after a claim); when locked it renders read-only.
 */
export function StopAttachments({
  packetId,
  stopId,
  stopWorkSlipId,
  attached,
  attachable,
  instructions,
  editable,
  visitDate,
  stopSlip,
}: {
  packetId: string;
  stopId: string;
  /** The packet's visit day — lets the picker warn when a slip is scheduled
   *  for AFTER this visit (guest gear for a later stay must not ride early). */
  visitDate: string;
  /** When the stop IS a task (one-off / setup / maintenance): its editable
   *  text, so the office can fix or expand the job after creation. */
  stopSlip?: { id: string; text: string } | null;
  /** The work slip this stop IS, when it's a maintenance stop — excluded from
   *  the attach picker so the same job can't be duplicated onto itself. */
  stopWorkSlipId: string | null;
  attached: AttachedSlip[];
  attachable: WorkSlipLite[];
  instructions: string | null;
  editable: boolean;
}) {
  const [open, setOpen] = useState(attached.length > 0 || !!instructions);
  const [pending, start] = useTransition();
  const [instr, setInstr] = useState(instructions ?? '');
  const [showInstr, setShowInstr] = useState(!!instructions);
  const softRefresh = useSoftRefresh();

  // Attach/detach render optimistically and the server actions skip
  // revalidation, so stacking five slips onto a stop is five instant row
  // moves + five cheap writes — not five queued full-page renders keeping
  // "Saving…" up for ten seconds. One soft refresh per burst (debounced
  // below) brings back canonical rows; these purge as the props catch up.
  const [optAttached, setOptAttached] = useState<WorkSlipLite[]>([]);
  // Stale detach markers are inert (an attachment id is never reused), but a
  // confirmed attach MUST leave optAttached or the slip stays hidden from the
  // picker after a later detach. Purge via the adjust-state-during-render
  // pattern the moment the canonical rows include it.
  const [optDetached, setOptDetached] = useState<Set<string>>(new Set());
  const [prevAttached, setPrevAttached] = useState(attached);
  if (prevAttached !== attached) {
    setPrevAttached(attached);
    const ids = new Set(attached.map((a) => a.id));
    if (optAttached.some((w) => ids.has(w.id))) setOptAttached(optAttached.filter((w) => !ids.has(w.id)));
  }
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  const queueRefresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => softRefresh(), 700);
  };

  const attachedSlipIds = new Set(attached.map((a) => a.id));
  const optRows: AttachedSlip[] = optAttached
    .filter((w) => !attachedSlipIds.has(w.id))
    .map((w) => ({ ...w, attachmentId: `opt-${w.id}`, officeNote: null, completedAt: null }));
  const shownAttached = [...attached.filter((a) => !optDetached.has(a.attachmentId)), ...optRows];
  const pickable = attachable.filter(
    (w) => !attachedSlipIds.has(w.id) && w.id !== stopWorkSlipId && !optAttached.some((o) => o.id === w.id),
  );
  const onSave = (fn: () => Promise<unknown>) => start(async () => { await fn(); });
  const onAttach = (w: WorkSlipLite) => {
    setOptAttached((p) => [...p, w]);
    start(async () => {
      const r = await attachSlipToStop(packetId, stopId, w.id).catch(() => ({ ok: false }));
      if (!r.ok) setOptAttached((p) => p.filter((o) => o.id !== w.id));
      queueRefresh();
    });
  };
  const onDetach = (a: AttachedSlip) => {
    setOptDetached((p) => new Set([...p, a.attachmentId]));
    start(async () => {
      const r = await detachSlipFromStop(packetId, a.attachmentId).catch(() => ({ ok: false }));
      if (!r.ok) setOptDetached((p) => new Set([...p].filter((id) => id !== a.attachmentId)));
      queueRefresh();
    });
  };

  if (!editable) {
    if (attached.length === 0 && !instructions) return null;
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        {attached.map((a) => (
          <div key={a.attachmentId}>
            + {a.title}
            {a.completedAt ? <span style={{ color: 'var(--positive)' }}> · done</span> : null}
            {a.officeNote ? <span style={{ color: 'var(--ink-4)' }}> — {a.officeNote}</span> : null}
          </div>
        ))}
        {instructions && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--ink-4)' }}>Note: </span>{instructions}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ background: open ? 'rgba(58,107,138,0.08)' : 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 999, cursor: 'pointer', padding: '4px 12px', fontSize: 12, fontWeight: 600, color: 'var(--tide-deep)' }}
      >
        {open ? '− ' : '+ '}Work slips &amp; instructions
        {shownAttached.length > 0
          ? ` · ${shownAttached.length} attached`
          : pickable.length > 0
            ? ` · ${pickable.length} open ${pickable.length === 1 ? 'slip' : 'slips'}`
            : ''}
      </button>

      {open && (
        <div style={{ marginTop: 10, maxWidth: 540, background: 'var(--paper-2, #fff)', border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, opacity: pending ? 0.7 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={eyebrow}>At this stop</span>
            <SaveState pending={pending} />
          </div>

          {/* The stop's OWN task (one-off / setup / maintenance): editable, so
              the office can fix or expand the job after creation. Saves on
              click-away like everything else here; the contractor's view
              refreshes mid-trip. */}
          {stopSlip && (
            <div>
              <div style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>
                The job
              </div>
              <textarea
                rows={3}
                defaultValue={stopSlip.text}
                disabled={!editable}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== stopSlip.text) onSave(() => updateStopSlipContent(packetId, stopSlip.id, v));
                }}
                style={box}
              />
            </div>
          )}

          {/* Attached slips. Optimistic rows (attach just clicked, server not
              confirmed) render title-only; note/remove appear once the
              reconcile brings the real attachment row back. */}
          {shownAttached.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {shownAttached.map((a) =>
                a.attachmentId.startsWith('opt-') ? (
                  <div key={a.attachmentId} style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{a.title}</div>
                ) : (
                  <AttachedRow key={a.attachmentId} packetId={packetId} a={a} onSave={onSave} onDetach={() => onDetach(a)} />
                ),
              )}
            </div>
          )}

          {/* Attach a slip. A native <select> could only show one line per slip,
              which made "is this applicable to this visit?" unanswerable — this
              panel shows each candidate whole: what, where, how old, the photos. */}
          {pickable.length > 0 ? (
            <details>
              <summary style={{ ...box, color: 'var(--ink-3)', cursor: 'pointer', listStyle: 'none' }}>
                + Attach a work slip ({pickable.length} open)…
              </summary>
              <div style={{ border: '1px solid var(--rule)', borderRadius: 8, marginTop: 6, background: 'var(--paper)' }}>
                {pickable.map((w) => (
                  <div key={w.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', borderBottom: '1px solid var(--rule-soft, var(--rule))' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>
                        {w.title}
                        {w.location && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> · {w.location}</span>}
                        {w.priority === 'high' && <span style={{ color: 'var(--signal)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginLeft: 6 }}>high</span>}
                      </div>
                      {(w.description || w.action_summary) && (
                        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {w.action_summary || w.description}
                        </div>
                      )}
                      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3 }}>
                        {[
                          w.category === 'inventory' ? 'restock' : null,
                          slipAge(w.created_at),
                          w.scheduled_date ? `for ${fmtSlipDay(w.scheduled_date)}` : null,
                          w.photo_urls?.length ? `${w.photo_urls.length} ${w.photo_urls.length === 1 ? 'photo' : 'photos'}` : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      {/* The wrong-visit guard: gear scheduled for a LATER stay
                          (e.g. a July 31 guest's pack 'n play) must not quietly
                          ride a July 25 visit. Attaching stays possible, but
                          it's a deliberate act now, not an accident. */}
                      {w.scheduled_date && w.scheduled_date > visitDate && (
                        <div style={{ fontSize: 11.5, color: 'var(--signal)', fontWeight: 600, marginTop: 3 }}>
                          Scheduled for {fmtSlipDay(w.scheduled_date)}, after this visit. It likely belongs on a later trip.
                        </div>
                      )}
                      {w.photo_urls && w.photo_urls.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                          {w.photo_urls.slice(0, 4).map((u) => (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img key={u} src={u} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--rule)' }} />
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onAttach(w)}
                      style={{ background: 'var(--paper-2, #fff)', border: '1px solid var(--tide-deep)', borderRadius: 999, cursor: 'pointer', color: 'var(--tide-deep)', fontSize: 11.5, fontWeight: 600, padding: '6px 14px', flexShrink: 0, marginTop: 1 }}
                    >
                      attach
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : shownAttached.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              No open work slips on this property. Create one in Work and it will show up here.
            </div>
          ) : null}

          {/* Per-stop instructions, tucked away until wanted */}
          {showInstr ? (
            <textarea
              rows={2}
              value={instr}
              autoFocus={!instructions}
              onChange={(e) => setInstr(e.target.value)}
              onBlur={() => {
                if (instr !== (instructions ?? '')) onSave(() => setStopInstructions(packetId, stopId, instr));
                if (!instr.trim() && !instructions) setShowInstr(false);
              }}
              placeholder="Anything else you want them to do at this stop"
              style={box}
            />
          ) : (
            <button type="button" onClick={() => setShowInstr(true)} style={{ ...quietBtn, alignSelf: 'flex-start' }}>
              + add instructions for this stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Packet-wide instructions, shown once at the top of the stops list. */
export function PacketInstructions({ packetId, instructions, editable }: { packetId: string; instructions: string | null; editable: boolean }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState(instructions ?? '');
  // Same tuck-away as the per-slip notes: no empty textarea squatting on the
  // page — a quiet link until there's actually a note to write.
  const [show, setShow] = useState(!!instructions);

  if (!editable) {
    if (!instructions) return null;
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 16 }}>
        <span style={{ color: 'var(--ink-4)' }}>Packet note: </span>{instructions}
      </div>
    );
  }
  if (!show) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={() => setShow(true)} style={quietBtn}>
          + add a note for the whole trip
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 16, maxWidth: 540, opacity: pending ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Instructions for the whole packet (optional)</span>
        <SaveState pending={pending} />
      </div>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== (instructions ?? '')) start(async () => { await setPacketInstructions(packetId, text); }); }}
        placeholder="A note the inspector sees across all stops on this trip"
        style={box}
      />
    </div>
  );
}
