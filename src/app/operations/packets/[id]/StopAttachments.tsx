'use client';

import { useState, useTransition } from 'react';
import type { AttachedSlip, WorkSlipLite } from '@/lib/field-types';
import { attachSlipToStop, detachSlipFromStop, updateStopSlipNote, setStopInstructions, setPacketInstructions } from '../actions';

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
}: {
  packetId: string;
  a: AttachedSlip;
  onSave: (fn: () => Promise<unknown>) => void;
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
        <button
          type="button"
          onClick={() => onSave(() => detachSlipFromStop(packetId, a.attachmentId))}
          style={quietBtn}
        >
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
}: {
  packetId: string;
  stopId: string;
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

  const attachedSlipIds = new Set(attached.map((a) => a.id));
  const pickable = attachable.filter((w) => !attachedSlipIds.has(w.id) && w.id !== stopWorkSlipId);
  const onSave = (fn: () => Promise<unknown>) => start(async () => { await fn(); });

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
        {attached.length > 0
          ? ` · ${attached.length} attached`
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

          {/* Attached slips */}
          {attached.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {attached.map((a) => (
                <AttachedRow key={a.attachmentId} packetId={packetId} a={a} onSave={onSave} />
              ))}
            </div>
          )}

          {/* Attach a slip */}
          {pickable.length > 0 ? (
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) onSave(() => attachSlipToStop(packetId, stopId, id));
              }}
              style={{ ...box, color: 'var(--ink-3)' }}
            >
              <option value="">+ Attach a work slip ({pickable.length} open)…</option>
              {pickable.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}{w.location ? ` (${w.location})` : ''} · {w.priority}
                </option>
              ))}
            </select>
          ) : attached.length === 0 ? (
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

  if (!editable) {
    if (!instructions) return null;
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 16 }}>
        <span style={{ color: 'var(--ink-4)' }}>Packet note: </span>{instructions}
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
