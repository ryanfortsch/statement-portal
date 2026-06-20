'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import type { ReservationPick, RecurringMessage } from '@/lib/stay-concierge';
import {
  fetchReminderData,
  createReminderAction,
  endReminderAction,
  polishProactiveAction,
} from './reminders-actions';

const WEEKDAYS = [
  { v: '0', label: 'Mon' },
  { v: '1', label: 'Tue' },
  { v: '2', label: 'Wed' },
  { v: '3', label: 'Thu' },
  { v: '4', label: 'Fri' },
  { v: '5', label: 'Sat' },
  { v: '6', label: 'Sun' },
];

type Mode = 'recurring' | 'once';

function cadenceLabel(r: RecurringMessage): string {
  if ((r.kind || 'recurring') === 'once') {
    return r.fire_date ? `Once · ${r.fire_date}` : 'One-time';
  }
  const set = new Set((r.weekdays || '').split(',').filter(Boolean));
  const picked = WEEKDAYS.filter((d) => set.has(d.v)).map((d) => d.label);
  if (picked.length === 0) return '—';
  if (picked.length === 7) return 'Every day';
  return picked.join(', ');
}

export function RemindersSection() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reservations, setReservations] = useState<ReservationPick[]>([]);
  const [recurring, setRecurring] = useState<RecurringMessage[]>([]);
  const [, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const res = await fetchReminderData();
      if (res.ok) {
        setReservations(res.reservations);
        setRecurring(res.recurring);
      }
      setLoaded(true);
    });
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) load();
  };

  return (
    <Section
      title="Proactive messages"
      eyebrow={recurring.length > 0 ? `${recurring.length} scheduled` : 'recurring + one-time'}
      paddingTop={36}
      right={
        <button
          type="button"
          onClick={handleToggle}
          style={{
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '6px 12px',
            cursor: 'pointer',
          }}
          aria-expanded={open}
        >
          {open ? 'Hide ▴' : 'Show ▾'}
        </button>
      }
    >
      {!open ? (
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: '16px 0',
            fontSize: 13,
            color: 'var(--ink-3)',
          }}
        >
          Send a guest a message you initiate, on a repeating cadence (trash day
          every Monday) or as a one-time scheduled note. Type it quick and the AI
          polishes it into our voice. Click <b>Show</b> to set one up.
        </div>
      ) : !loaded ? (
        <div
          style={{ borderTop: '1px solid var(--rule)', padding: '20px 0', fontSize: 13, color: 'var(--ink-3)' }}
        >
          Loading…
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
          <ActiveList recurring={recurring} onChanged={load} />
          <CreateForm reservations={reservations} onCreated={load} />
        </div>
      )}
    </Section>
  );
}

function ActiveList({
  recurring,
  onChanged,
}: {
  recurring: RecurringMessage[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (recurring.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-4)', marginBottom: 24 }}>
        Nothing scheduled.
      </div>
    );
  }

  const handleEnd = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await endReminderAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChanged();
      router.refresh();
    });
  };

  return (
    <ul style={{ listStyle: 'none', margin: '0 0 28px', padding: 0 }}>
      {recurring.map((r) => (
        <li
          key={r.id}
          style={{
            borderBottom: '1px solid var(--rule)',
            padding: '14px 0',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'baseline',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 }}>
              <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
                {r.label}
              </span>
              <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
                {cadenceLabel(r)} · {r.at_local}
                {r.channel ? ` · ${r.channel}` : ''}
                {r.send_mode === 'auto' ? ' · auto-send' : ' · needs approval'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{r.body}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
              {(r.kind || 'recurring') === 'once'
                ? `fires ${r.fire_date}`
                : `${r.start_date} ${r.end_date ? `→ ${r.end_date}` : '(no end)'}`}
              {r.last_sent_date ? ` · last sent ${r.last_sent_date}` : ' · not yet sent'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleEnd(r.id)}
            disabled={isPending}
            style={{
              flexShrink: 0,
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: 'var(--signal)',
              background: 'transparent',
              border: '1px solid var(--signal-soft)',
              padding: '6px 12px',
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            End
          </button>
        </li>
      ))}
      {error && (
        <li style={{ fontSize: 12, color: 'var(--signal)', paddingTop: 8 }} role="alert">
          {error}
        </li>
      )}
    </ul>
  );
}

function CreateForm({
  reservations,
  onCreated,
}: {
  reservations: ReservationPick[];
  onCreated: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [polishing, startPolish] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [mode, setMode] = useState<Mode>('recurring');
  const [resId, setResId] = useState('');
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [polished, setPolished] = useState(false);
  const [days, setDays] = useState<Set<string>>(new Set());
  const [fireDate, setFireDate] = useState('');
  const [atLocal, setAtLocal] = useState('09:00');
  const [sendMode, setSendMode] = useState('approve');

  const picked = reservations.find((r) => r.reservation_id === resId);

  const toggleDay = (v: string) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const handlePolish = () => {
    setError(null);
    if (!body.trim()) {
      setError('Write a rough note first');
      return;
    }
    startPolish(async () => {
      const res = await polishProactiveAction(picked?.reservation_id || '', body);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody(res.polished);
      setPolished(true);
    });
  };

  const handleCreate = () => {
    setError(null);
    setDone(false);
    if (!picked) {
      setError('Pick a guest/reservation');
      return;
    }
    startTransition(async () => {
      const res = await createReminderAction({
        label: label.trim() || `${mode === 'once' ? 'Message' : 'Reminder'} · ${picked.guest_first || picked.property_name}`,
        conversation_id: picked.conversation_id,
        listing_id: picked.listing_id,
        module: picked.module || 'sms',
        guest_first: picked.guest_first,
        body: body.trim(),
        kind: mode,
        weekdays: mode === 'recurring' ? Array.from(days).sort().join(',') : '',
        fire_date: mode === 'once' ? fireDate : '',
        at_local: atLocal,
        start_date: picked.check_in,
        end_date: picked.check_out,
        send_mode: sendMode,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      setResId('');
      setLabel('');
      setBody('');
      setPolished(false);
      setDays(new Set());
      setFireDate('');
      onCreated();
      router.refresh();
    });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--rule)',
    background: 'var(--paper)',
    fontFamily: 'inherit',
    fontSize: 13,
    color: 'var(--ink)',
  };

  const canCreate =
    !!resId &&
    !!body.trim() &&
    (mode === 'recurring' ? days.size > 0 : !!fireDate);

  return (
    <div style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', padding: 18 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          New proactive message
        </div>
        {/* Mode toggle — the "slightly different UI" per mode */}
        <div style={{ display: 'inline-flex', border: '1px solid var(--ink)' }} role="tablist">
          {(['recurring', 'once'] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m)}
                style={{
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  padding: '6px 12px',
                  border: 'none',
                  borderRight: m === 'recurring' ? '1px solid var(--ink)' : 'none',
                  background: active ? 'var(--ink)' : 'var(--paper)',
                  color: active ? 'var(--paper)' : 'var(--ink-3)',
                  cursor: 'pointer',
                }}
              >
                {m === 'recurring' ? 'Recurring' : 'One-time'}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <label style={{ display: 'block' }}>
          <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 4 }}>
            Guest / reservation
          </span>
          <select value={resId} onChange={(e) => setResId(e.target.value)} style={inputStyle}>
            <option value="">Select…</option>
            {reservations.map((r) => (
              <option key={r.reservation_id} value={r.reservation_id} disabled={!r.conversation_id}>
                {r.guest_first || r.guest_full || 'Guest'} · {r.property_name} · {r.check_in}→{r.check_out}
                {r.conversation_id ? '' : ' (no thread)'}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block' }}>
          <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 4 }}>
            Label (optional)
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={mode === 'once' ? 'Gate code heads-up' : 'Trash day'}
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10 }}>
            Message {polished && <span style={{ color: '#5b7b4e' }}>· polished</span>}
          </span>
          <button
            type="button"
            onClick={handlePolish}
            disabled={polishing || !body.trim()}
            title="Rewrite your note in our voice using the property's knowledge base — the same engine that drafts guest replies."
            style={{
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: polishing || !body.trim() ? 'var(--ink-4)' : 'var(--ink)',
              background: 'transparent',
              border: '1px solid var(--ink-3)',
              padding: '4px 10px',
              cursor: polishing || !body.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {polishing ? 'Polishing…' : '✨ Polish into our voice'}
          </button>
        </div>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setPolished(false);
          }}
          rows={3}
          placeholder="Type quick and dirty — e.g. 'trash day is tuesday, bins on the side of the house, put them out night before'. Then hit Polish."
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        {mode === 'recurring' ? (
          <div>
            <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 6 }}>
              Days
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {WEEKDAYS.map((d) => {
                const active = days.has(d.v);
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '6px 9px',
                      border: '1px solid var(--ink)',
                      background: active ? 'var(--ink)' : 'var(--paper)',
                      color: active ? 'var(--paper)' : 'var(--ink-3)',
                      cursor: 'pointer',
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <label>
            <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 6 }}>
              Date
            </span>
            <input
              type="date"
              value={fireDate}
              min={picked?.check_in || undefined}
              max={picked?.check_out || undefined}
              onChange={(e) => setFireDate(e.target.value)}
              style={{ ...inputStyle, width: 160 }}
            />
          </label>
        )}
        <label>
          <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 6 }}>
            Time
          </span>
          <input type="time" value={atLocal} onChange={(e) => setAtLocal(e.target.value)} style={{ ...inputStyle, width: 120 }} />
        </label>
        <label>
          <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 6 }}>
            Send
          </span>
          <select value={sendMode} onChange={(e) => setSendMode(e.target.value)} style={{ ...inputStyle, width: 150 }}>
            <option value="approve">Approve first</option>
            <option value="auto">Auto-send</option>
          </select>
        </label>
      </div>

      {picked && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 12 }}>
          {mode === 'recurring'
            ? `Runs ${picked.check_in} → ${picked.check_out} (the stay window)`
            : 'Fires once on the chosen date'}
          {picked.channel ? ` · sends via ${picked.channel}` : ''}.
        </div>
      )}

      {error && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--signal)', fontWeight: 500 }} role="alert">
          {error}
        </p>
      )}
      {done && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#5b7b4e', fontWeight: 500 }}>
          Scheduled.
        </p>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={isPending || !canCreate}
        style={{
          background: isPending || !canCreate ? 'var(--ink-4)' : 'var(--ink)',
          color: 'var(--paper)',
          border: 'none',
          padding: '10px 18px',
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
          cursor: isPending || !canCreate ? 'not-allowed' : 'pointer',
        }}
      >
        {mode === 'once' ? 'Schedule message' : 'Create reminder'}
      </button>
    </div>
  );
}
