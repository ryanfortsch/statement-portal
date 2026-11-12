'use client';

import { useState, type CSSProperties } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import type { PersonCheck } from '@/lib/partner-listing';
import {
  addPartnerFeedAction,
  listPartnerHomeAction,
  readPartnerFeedsAction,
  recordPartnerCheckAction,
  removePartnerFeedAction,
  unlistPartnerHomeAction,
  type PartnerActionResult,
} from './partner-actions';

/**
 * The partner home panel's buttons and small forms. Every verb goes through
 * a server action that answers ok or a reason; a reason lands in a notice,
 * never an error page.
 */

function useRun() {
  const { notify } = useConfirm();
  const softRefresh = useSoftRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<PartnerActionResult>, okTitle?: string): Promise<boolean> {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) await notify({ title: 'That did not go through', body: r.error, tone: 'danger' });
      else if (r.note) await notify({ title: okTitle ?? 'Done', body: r.note });
      softRefresh();
      return r.ok;
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

const input: CSSProperties = {
  fontSize: 13,
  padding: '6px 9px',
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
};

const CHANNELS: Array<{ value: string; label: string }> = [
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'vrbo', label: 'Vrbo' },
  { value: 'booking_com', label: 'Booking.com' },
  { value: 'other', label: 'Their software' },
];

export function AddFeed({ propertyId }: { propertyId: string }) {
  const { busy, run } = useRun();
  const [url, setUrl] = useState('');
  const [channel, setChannel] = useState('airbnb');
  async function add() {
    const ok = await run('add', () => addPartnerFeedAction(propertyId, url, channel), 'Calendar added');
    if (ok) setUrl('');
  }
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <select aria-label="Where the calendar is from" value={channel} onChange={(e) => setChannel(e.target.value)} style={input}>
        {CHANNELS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <input
        aria-label="The host's calendar export link"
        placeholder="https://www.airbnb.com/calendar/ical/..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ ...input, flex: '1 1 320px', minWidth: 0 }}
      />
      <Button size="sm" variant="secondary" pending={busy === 'add'} pendingLabel="Reading" disabled={busy !== null || !url.trim()} onClick={add}>
        Add the calendar
      </Button>
    </div>
  );
}

export function FeedVerbs({ propertyId, feedId, label }: { propertyId: string; feedId: string; label: string }) {
  const { ask } = useConfirm();
  const { busy, run } = useRun();
  async function remove() {
    const yes = await ask({
      title: `Stop reading ${label}?`,
      body: 'The nights it holds come off this home’s calendar here, so staycapeann.com could offer them.',
      confirmLabel: 'Stop reading it',
      tone: 'danger',
    });
    if (!yes) return;
    await run('remove', () => removePartnerFeedAction(propertyId, feedId));
  }
  return (
    <Button size="sm" variant="quiet" pending={busy === 'remove'} pendingLabel="Removing" disabled={busy !== null} onClick={remove}>
      Remove
    </Button>
  );
}

export function ReadNow({ propertyId }: { propertyId: string }) {
  const { busy, run } = useRun();
  return (
    <Button size="sm" variant="quiet" pending={busy === 'read'} pendingLabel="Reading" disabled={busy !== null} onClick={() => run('read', () => readPartnerFeedsAction(propertyId))}>
      Read them now
    </Button>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One person-checked line: the date it happened (and, for insurance, the date it runs to). */
export function CheckForm({
  propertyId,
  check,
  on,
  expires,
  verb,
}: {
  propertyId: string;
  check: PersonCheck;
  on: string | null;
  expires?: string | null;
  verb: string;
}) {
  const { ask } = useConfirm();
  const { busy, run } = useRun();
  const [date, setDate] = useState(on ?? todayIso());
  const [until, setUntil] = useState(expires ?? '');
  const [open, setOpen] = useState(false);

  async function save() {
    const ok = await run('save', () => recordPartnerCheckAction(propertyId, check, date, until));
    if (ok) setOpen(false);
  }
  async function clear() {
    const yes = await ask({ title: 'Clear this check?', body: 'The home cannot be listed until it is recorded again.', confirmLabel: 'Clear it' });
    if (!yes) return;
    await run('clear', () => recordPartnerCheckAction(propertyId, check, ''));
  }

  if (!open) {
    return (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <Button size="sm" variant={on ? 'quiet' : 'secondary'} disabled={busy !== null} onClick={() => setOpen(true)}>
          {on ? 'Change' : verb}
        </Button>
        {on && (
          <Button size="sm" variant="quiet" pending={busy === 'clear'} pendingLabel="Clearing" disabled={busy !== null} onClick={clear}>
            Clear
          </Button>
        )}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <input type="date" aria-label="On" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
      {check === 'insurance' && (
        <>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>good until</span>
          <input type="date" aria-label="Good until" value={until} onChange={(e) => setUntil(e.target.value)} style={input} />
        </>
      )}
      <Button size="sm" variant="primary" pending={busy === 'save'} pendingLabel="Saving" disabled={busy !== null || !date} onClick={save}>
        Save
      </Button>
      <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </span>
  );
}

/** On or off staycapeann.com. Owners only; the server reads the bar again before it lists. */
export function ListingSwitch({ propertyId, home, listed, ready }: { propertyId: string; home: string; listed: boolean; ready: boolean }) {
  const { ask, askText } = useConfirm();
  const { busy, run } = useRun();

  async function list() {
    const yes = await ask({
      title: `List ${home} on staycapeann.com?`,
      body: 'Guests can find it and send booking requests within a few minutes. Each request comes to the Requests tab, and the host has 24 hours to answer.',
      confirmLabel: 'List it',
    });
    if (!yes) return;
    await run('list', () => listPartnerHomeAction(propertyId), 'On staycapeann.com');
  }
  async function unlist() {
    const reason = await askText({
      title: `Take ${home} off staycapeann.com?`,
      body: 'No new requests come in. Requests already sent stay open on the Requests tab, and accepted stays are kept.',
      inputLabel: 'Why, for the record',
      confirmLabel: 'Take it off',
      tone: 'danger',
    });
    if (reason === null) return;
    await run('unlist', () => unlistPartnerHomeAction(propertyId, reason), 'Taken off');
  }

  if (listed) {
    return (
      <Button size="sm" variant="danger" pending={busy === 'unlist'} pendingLabel="Taking it off" disabled={busy !== null} onClick={unlist}>
        Take it off the site
      </Button>
    );
  }
  return (
    <Button size="md" variant="primary" pending={busy === 'list'} pendingLabel="Listing" disabled={busy !== null || !ready} onClick={list}>
      List on staycapeann.com
    </Button>
  );
}
