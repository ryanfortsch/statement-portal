'use client';

import { useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import type {
  ProactiveTarget,
  RecurringMessage,
  CreateRecurringInput,
} from '@/lib/stay-concierge';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * Audience-parameterized generalization of the guest RemindersSection
 * (src/app/messaging/RemindersSection.tsx) for the cleaner and owner
 * messaging pages. Same collapsible Section + lazy first-expand load, but the
 * recipient is a fixed proactive target (a cleaner manager or an owner)
 * instead of a reservation, so there is no stay window: recurring messages
 * run until ended (or an optional end date), one-time messages fire on a
 * chosen date.
 *
 * The server actions are page-owned (each page's reminders-actions.ts
 * hardcodes its audience + revalidate path) and arrive via the `actions`
 * prop, so this component imports nothing server-side.
 */

export type ProactiveReminderActions = {
  fetchReminders: () => Promise<
    { ok: true; recurring: RecurringMessage[] } | { ok: false; error: string }
  >;
  fetchTargets: () => Promise<
    { ok: true; targets: ProactiveTarget[] } | { ok: false; error: string }
  >;
  create: (
    input: CreateRecurringInput,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  end: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  polish: (
    targetName: string,
    roughText: string,
  ) => Promise<
    { ok: true; polished: string; english: string } | { ok: false; error: string }
  >;
};

type Audience = 'cleaner' | 'owner';

type Props = {
  audience: Audience;
  actions: ProactiveReminderActions;
};

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

/** Today's local date as YYYY-MM-DD, for the one-time date floor. */
function todayLocalISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function firstNameOf(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || '';
}

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

export function ProactiveRemindersPanel({ audience, actions }: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [targets, setTargets] = useState<ProactiveTarget[]>([]);
  const [recurring, setRecurring] = useState<RecurringMessage[]>([]);
  const [, startTransition] = useTransition();

  // Fast: the scheduled list (local DB). Gates the section's content so it
  // renders right away instead of waiting on the slower target lookup.
  const loadRecurring = () => {
    startTransition(async () => {
      const res = await actions.fetchReminders();
      if (res.ok) setRecurring(res.recurring);
      setLoaded(true);
    });
  };

  // Slower: who can be messaged. Loads in parallel and only feeds the
  // create-form dropdown, so it never blocks the panel from showing.
  const loadTargets = () => {
    startTransition(async () => {
      const res = await actions.fetchTargets();
      if (res.ok) setTargets(res.targets);
      setTargetsLoaded(true);
    });
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      loadRecurring();
      loadTargets();
    }
  };

  const whoBlurb =
    audience === 'cleaner'
      ? 'Send the cleaning managers a message you initiate, on a repeating cadence (a Monday supply check) or as a one-time scheduled note. Type it quick in English and the AI polishes it into Portuguese.'
      : 'Send an owner a message you initiate, on a repeating cadence (a monthly touch-base) or as a one-time scheduled note. Type it quick and the AI polishes it into our voice.';

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
          {whoBlurb} Click <b>Show</b> to set one up.
        </div>
      ) : !loaded ? (
        <div
          style={{ borderTop: '1px solid var(--rule)', padding: '20px 0', fontSize: 13, color: 'var(--ink-3)' }}
        >
          Loading…
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
          <ActiveList recurring={recurring} actions={actions} onChanged={loadRecurring} />
          <CreateForm
            audience={audience}
            actions={actions}
            targets={targets}
            targetsLoaded={targetsLoaded}
            onCreated={loadRecurring}
          />
        </div>
      )}
    </Section>
  );
}

function ActiveList({
  recurring,
  actions,
  onChanged,
}: {
  recurring: RecurringMessage[];
  actions: ProactiveReminderActions;
  onChanged: () => void;
}) {
  const softRefresh = useSoftRefresh();
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
      const res = await actions.end(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChanged();
      softRefresh();
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
                {r.target_name ? `to ${r.target_name} · ` : ''}
                {cadenceLabel(r)} · {r.at_local}
                {r.channel ? ` · ${r.channel}` : ''}
                {r.send_mode === 'auto' ? ' · auto-send' : ' · needs approval'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{r.body}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
              {(r.kind || 'recurring') === 'once'
                ? `fires ${r.fire_date}`
                : r.end_date
                  ? `runs until ${r.end_date}`
                  : 'runs until ended'}
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
  audience,
  actions,
  targets,
  targetsLoaded,
  onCreated,
}: {
  audience: Audience;
  actions: ProactiveReminderActions;
  targets: ProactiveTarget[];
  targetsLoaded: boolean;
  onCreated: () => void;
}) {
  const softRefresh = useSoftRefresh();
  const [isPending, startTransition] = useTransition();
  const [polishing, startPolish] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [mode, setMode] = useState<Mode>('recurring');
  const [contact, setContact] = useState('');
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [polished, setPolished] = useState(false);
  // For the cleaner audience the polished body is Portuguese; this holds the
  // EN translation shown as a helper line so the operator can audit what
  // sends. Cleared (with `polished`) the moment the body is hand-edited.
  const [english, setEnglish] = useState('');
  const [days, setDays] = useState<Set<string>>(new Set());
  const [endDate, setEndDate] = useState('');
  const [fireDate, setFireDate] = useState('');
  const [atLocal, setAtLocal] = useState('09:00');
  const [sendMode, setSendMode] = useState('approve');

  const picked = targets.find((t) => t.contact === contact);

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
      const res = await actions.polish(picked?.name || '', body);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody(res.polished);
      setEnglish(audience === 'cleaner' ? res.english : '');
      setPolished(true);
    });
  };

  const handleCreate = () => {
    setError(null);
    setDone(false);
    if (!picked) {
      setError(audience === 'cleaner' ? 'Pick a cleaner' : 'Pick an owner');
      return;
    }
    startTransition(async () => {
      const res = await actions.create({
        label:
          label.trim() ||
          `${mode === 'once' ? 'Message' : 'Reminder'} · ${firstNameOf(picked.name) || picked.name}`,
        conversation_id: '',
        listing_id: picked.property_id || '',
        module: 'sms_quo',
        guest_first: firstNameOf(picked.name),
        body: body.trim(),
        kind: mode,
        weekdays: mode === 'recurring' ? Array.from(days).sort().join(',') : '',
        fire_date: mode === 'once' ? fireDate : '',
        at_local: atLocal,
        start_date: '',
        end_date: mode === 'recurring' ? endDate : '',
        send_mode: sendMode,
        audience,
        target_contact: picked.contact,
        target_name: picked.name,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      setContact('');
      setLabel('');
      setBody('');
      setPolished(false);
      setEnglish('');
      setDays(new Set());
      setEndDate('');
      setFireDate('');
      onCreated();
      softRefresh();
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
    !!contact &&
    !!body.trim() &&
    (mode === 'recurring' ? days.size > 0 : !!fireDate);

  const targetLabel = audience === 'cleaner' ? 'Cleaner' : 'Owner';
  const bodyPlaceholder =
    audience === 'cleaner'
      ? "Type quick in English - e.g. 'ask if we're low on towels and paper goods anywhere'. Polish turns it into Portuguese."
      : "Type quick and dirty - e.g. 'june statement is out, strong month, call me if questions'. Then hit Polish.";

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
                onClick={() => {
                  setMode(m);
                  // Drop any leftover validation error/notice from the other
                  // mode so it doesn't read as an error on this tab.
                  setError(null);
                  setDone(false);
                }}
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
            {targetLabel}
          </span>
          <select
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            disabled={!targetsLoaded}
            style={inputStyle}
          >
            <option value="">{targetsLoaded ? 'Select…' : 'Loading…'}</option>
            {targets.map((t) => (
              <option key={t.contact} value={t.contact}>
                {audience === 'owner' && t.property_name ? `${t.name} · ${t.property_name}` : t.name}
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
            placeholder={audience === 'cleaner' ? 'Supply check' : 'Monthly touch-base'}
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
            title={
              audience === 'cleaner'
                ? 'Rewrite your note in our voice, in Portuguese, using the same engine that drafts cleaner replies.'
                : 'Rewrite your note in our voice using the same engine that drafts owner replies.'
            }
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
            setEnglish('');
          }}
          rows={3}
          placeholder={bodyPlaceholder}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
        {audience === 'cleaner' && polished && english && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            English: {english}
            <span
              style={{
                display: 'block',
                marginTop: 2,
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
              }}
            >
              Sends in Portuguese
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        {mode === 'recurring' ? (
          <>
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
            <label>
              <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 6 }}>
                End date (optional)
              </span>
              {/* Empty = keeps going until ended from the list above. */}
              <input
                type="date"
                value={endDate}
                min={todayLocalISO()}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ ...inputStyle, width: 160 }}
              />
            </label>
          </>
        ) : (
          <label>
            <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 10, display: 'block', marginBottom: 6 }}>
              Date
            </span>
            <input
              type="date"
              value={fireDate}
              min={todayLocalISO()}
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
          Sends by SMS via Quo to {picked.name}.
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
