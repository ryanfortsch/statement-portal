'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { saveRoomAction, deleteRoomAction } from './onboarding-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { ROOM_TYPES, type PropertyRoom, type RoomType } from '@/lib/property-rooms-shared';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

/**
 * Room-by-room records for the Onboarding tab. Cards summarize each space
 * (beds, tv, amenities, quirks); an inline editor covers hand entry. The
 * walkthrough dictation is the fast path that fills these; this editor is
 * the manual one.
 */
export function RoomsEditor({ propertyId, rooms }: { propertyId: string; rooms: PropertyRoom[] }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<{ id: string | null; dirty: boolean; busy: boolean }>({ id: null, dirty: false, busy: false });

  function edit(next: string) {
    if (current.current.busy || next === current.current.id) return;
    if (current.current.dirty && !window.confirm('Discard your unsaved room changes?')) return;
    current.current = { id: next, dirty: false, busy: false };
    setEditing(next);
  }

  function close(id: string, confirmedSave: boolean) {
    // A response from an old editor must never close a newer room's form.
    if (current.current.id !== id) return;
    if (!confirmedSave && (current.current.busy || (current.current.dirty && !window.confirm('Discard your unsaved room changes?')))) return;
    current.current = { id: null, dirty: false, busy: false };
    setBusy(false);
    setEditing(null);
  }

  const dirtyChanged = useCallback((id: string, dirty: boolean) => {
    if (current.current.id === id) current.current.dirty = dirty;
  }, []);
  const busyChanged = useCallback((id: string, value: boolean) => {
    if (current.current.id !== id) return;
    current.current.busy = value;
    setBusy(value);
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button type="button" onClick={() => edit('new')} disabled={busy} style={primaryBtn}>
          + Add room
        </button>
      </div>
      {rooms.length === 0 && editing !== 'new' && (
        <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0', fontSize: 12, color: 'var(--ink-4)' }}>
          No rooms on file yet. Walk the house above, or add rooms by hand.
        </div>
      )}
      {editing === 'new' && (
        <RoomForm propertyId={propertyId} onClose={(saved) => close('new', saved)} onDirtyChange={dirtyChanged} onBusyChange={busyChanged} />
      )}
      {rooms.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {rooms.map((r) =>
            editing === r.id ? (
              <RoomForm key={r.id} propertyId={propertyId} room={r} onClose={(saved) => close(r.id, saved)} onDirtyChange={dirtyChanged} onBusyChange={busyChanged} />
            ) : (
              <RoomCard key={r.id} room={r} onEdit={() => edit(r.id)} disabled={busy} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, onEdit, disabled }: { room: PropertyRoom; onEdit: () => void; disabled: boolean }) {
  const d = room.details ?? {};
  const beds = (d.beds ?? []).map((b) => (b.count > 1 ? `${b.count}x ${b.size}` : b.size)).join(', ');
  return (
    <div style={{ border: '1px solid var(--rule)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div className="eyebrow">{ROOM_TYPES.find((t) => t.id === room.room_type)?.label ?? room.room_type}</div>
        <button type="button" onClick={onEdit} disabled={disabled} style={quietLink}>Edit</button>
      </div>
      <h4 className="font-serif" style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.005em', margin: 0, color: 'var(--ink)' }}>
        {room.name}
      </h4>
      {beds && <Fact label="Beds" value={beds} />}
      {d.tv && <Fact label="TV" value={d.tv} />}
      {(d.amenities?.length ?? 0) > 0 && <Fact label="Amenities" value={d.amenities!.join(', ')} />}
      {(d.quirks?.length ?? 0) > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--signal)', marginRight: 6 }}>
            Quirks
          </span>
          {d.quirks!.join(' · ')}
        </div>
      )}
      {d.notes && <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{d.notes}</div>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 6 }}>
        {label}
      </span>
      {value}
    </div>
  );
}

function RoomForm({
  propertyId,
  room,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  propertyId: string;
  room?: PropertyRoom;
  onClose: (confirmedSave: boolean) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onBusyChange: (id: string, busy: boolean) => void;
}) {
  const softRefresh = useSoftRefresh();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(room?.name ?? '');
  const [roomType, setRoomType] = useState<RoomType>(room?.room_type ?? 'bedroom');
  const [beds, setBeds] = useState(
    (room?.details.beds ?? []).map((b) => (b.count > 1 ? `${b.count}x ${b.size}` : b.size)).join(', '),
  );
  const [tv, setTv] = useState(room?.details.tv ?? '');
  const [amenities, setAmenities] = useState((room?.details.amenities ?? []).join(', '));
  const [quirks, setQuirks] = useState((room?.details.quirks ?? []).join('\n'));
  const [notes, setNotes] = useState(room?.details.notes ?? '');
  const [guestSummary, setGuestSummary] = useState(room?.guest_summary ?? '');
  const id = room?.id ?? 'new';
  const snapshot = JSON.stringify([name, roomType, beds, tv, amenities, quirks, notes, guestSummary]);
  const original = useRef(snapshot);
  const dirty = snapshot !== original.current;
  const saving = useRef(false);
  const [operation, setOperation] = useState<'save' | 'delete' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useUnsavedWorkGuard(dirty || pending || uncertain);
  useEffect(() => {
    onDirtyChange(id, dirty || uncertain);
    return () => onDirtyChange(id, false);
  }, [id, dirty, uncertain, onDirtyChange]);

  function save() {
    if (saving.current || !name.trim()) return;
    saving.current = true;
    onBusyChange(id, true);
    setOperation('save');
    setError(null);
    setUncertain(false);
    start(async () => {
      try {
      const parsedBeds = beds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const m = s.match(/^(\d+)\s*x\s*(.+)$/i);
          return m
            ? { size: m[2].trim().toLowerCase(), count: Math.max(1, parseInt(m[1], 10) || 1) }
            : { size: s.toLowerCase(), count: 1 };
        });
      const res = await saveRoomAction({
        propertyId,
        id: room?.id,
        roomType,
        name,
        details: {
          beds: parsedBeds,
          tv: tv.trim() || null,
          amenities: amenities.split(',').map((s) => s.trim()).filter(Boolean),
          quirks: quirks.split('\n').map((s) => s.trim()).filter(Boolean),
          notes: notes.trim() || null,
        },
        guestSummary: guestSummary.trim() || null,
      });
      if (!res.ok) { setError(res.error); return; }
      onClose(true);
      softRefresh();
      } catch {
        setUncertain(true);
        setError('Could not confirm the room save. Your edits are kept. Check the saved rooms before retrying, especially when adding a room.');
      } finally {
        saving.current = false;
        onBusyChange(id, false);
        setOperation(null);
      }
    });
  }

  function remove() {
    if (!room || saving.current) return;
    if (!window.confirm(`Delete room "${room.name}"?`)) return;
    saving.current = true;
    onBusyChange(id, true);
    setOperation('delete');
    setError(null);
    setUncertain(false);
    start(async () => {
      try {
        const res = await deleteRoomAction({ propertyId, id: room.id });
        if (!res.ok) { setError(res.error ?? 'Delete failed'); return; }
        onClose(true);
        softRefresh();
      } catch {
        setUncertain(true);
        setError('Could not confirm deletion. Check the saved rooms before retrying.');
      } finally {
        saving.current = false;
        onBusyChange(id, false);
        setOperation(null);
      }
    });
  }

  return (
    <fieldset disabled={pending} style={{ border: '1px solid var(--tide-deep)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, gridColumn: '1 / -1', margin: '0 0 4px', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)} style={{ ...input, flex: '0 0 140px' }}>
          {ROOM_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Primary bedroom" style={{ ...input, flex: '1 1 200px' }} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input value={beds} onChange={(e) => setBeds(e.target.value)} placeholder="Beds, e.g. king or 2x twin" style={{ ...input, flex: '1 1 180px' }} />
        <input value={tv} onChange={(e) => setTv(e.target.value)} placeholder="TV, e.g. 55in Roku" style={{ ...input, flex: '1 1 180px' }} />
      </div>
      <input value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="Amenities, comma separated" style={input} />
      <textarea value={quirks} onChange={(e) => setQuirks(e.target.value)} rows={2} placeholder="Quirks, one per line" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Internal notes" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
      <input value={guestSummary} onChange={(e) => setGuestSummary(e.target.value)} placeholder="One line a guest could be told about this room" style={input} />
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--negative)' }}>{error}{uncertain && <> <a href={`/properties/${propertyId}`} target="_blank" rel="noopener noreferrer">View saved rooms</a></>}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
        {room && (
          <button type="button" onClick={remove} disabled={pending} style={{ ...quietLink, color: 'var(--negative)' }}>
            {operation === 'delete' ? 'Deleting…' : 'Delete'}
          </button>
        )}
        <button type="button" onClick={() => onClose(false)} disabled={pending} style={ghostBtn}>Cancel</button>
        <button type="button" onClick={save} disabled={pending || !name.trim()} style={{ ...primaryBtn, opacity: pending || !name.trim() ? 0.6 : 1 }}>
          {operation === 'save' ? 'Saving…' : 'Save room'}
        </button>
      </div>
    </fieldset>
  );
}

const input: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--ink)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
  padding: '9px 16px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  padding: '9px 14px',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const quietLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 11,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  cursor: 'pointer',
  fontWeight: 500,
};
