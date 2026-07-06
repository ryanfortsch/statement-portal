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

  const attachedSlipIds = new Set(attached.map((a) => a.id));
  const pickable = attachable.filter((w) => !attachedSlipIds.has(w.id) && w.id !== stopWorkSlipId);

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
        <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 12, opacity: pending ? 0.6 : 1 }}>
          {/* Attached slips */}
          {attached.map((a) => (
            <div key={a.attachmentId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                  {a.title}
                  {a.completedAt ? <span style={{ color: 'var(--positive)', fontSize: 11 }}> · done</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => start(async () => { await detachSlipFromStop(packetId, a.attachmentId); })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, textDecoration: 'underline', flexShrink: 0 }}
                >
                  remove
                </button>
              </div>
              <textarea
                rows={1}
                defaultValue={a.officeNote ?? ''}
                placeholder="Note for the inspector on this one (optional)"
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (a.officeNote ?? '')) start(async () => { await updateStopSlipNote(packetId, a.attachmentId, v); });
                }}
                style={box}
              />
            </div>
          ))}

          {/* Attach a slip */}
          {pickable.length > 0 ? (
            <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Attach a work slip
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) start(async () => { await attachSlipToStop(packetId, stopId, id); });
                }}
                style={{ ...box, marginTop: 4 }}
              >
                <option value="">Choose an open slip…</option>
                {pickable.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}{w.location ? ` (${w.location})` : ''} · {w.priority}
                  </option>
                ))}
              </select>
            </label>
          ) : attached.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>No open work slips on this property to attach.</div>
          ) : null}

          {/* Per-stop instructions */}
          <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Other instructions for this stop
            <textarea
              rows={2}
              value={instr}
              onChange={(e) => setInstr(e.target.value)}
              onBlur={() => { if (instr !== (instructions ?? '')) start(async () => { await setStopInstructions(packetId, stopId, instr); }); }}
              placeholder="Anything else you want them to do here"
              style={{ ...box, marginTop: 4 }}
            />
          </label>
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
    <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginBottom: 16, opacity: pending ? 0.6 : 1 }}>
      Instructions for the whole packet (optional)
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== (instructions ?? '')) start(async () => { await setPacketInstructions(packetId, text); }); }}
        placeholder="A note the inspector sees across all stops on this trip"
        style={{ ...box, marginTop: 4, maxWidth: 520 }}
      />
    </label>
  );
}
