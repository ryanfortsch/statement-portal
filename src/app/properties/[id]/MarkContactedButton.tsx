'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { markOwnerContacted, type OwnerContactChannel } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type Props = { propertyId: string };

const CHANNELS: { id: OwnerContactChannel; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'sms', label: 'Text' },
  { id: 'in_person', label: 'In person' },
  { id: 'other', label: 'Other' },
];

/**
 * "I just reached out" — pops a channel picker, stamps
 * properties.owner_last_contacted_* on click. The channel is recorded so
 * the Last contacted line can show "today (text)" instead of generic
 * "today."
 *
 * Optimistic save with router.refresh on success so the Last contacted
 * line updates without a manual reload.
 */
export function MarkContactedButton({ propertyId }: Props) {
  const softRefresh = useSoftRefresh();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const lock = useRef(false);
  const [failedChannel, setFailedChannel] = useState<OwnerContactChannel | null>(null);
  useUnsavedWorkGuard(pending);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function pick(channel: OwnerContactChannel) {
    if (lock.current) return;
    lock.current = true;
    setErr(null);
    setSavedAt(null); setFailedChannel(null);
    setOpen(false);
    startTransition(async () => {
      try {
        const res = await markOwnerContacted({ property_id: propertyId, channel });
        if (!res.ok) { setErr(res.error); setFailedChannel(channel); return; }
        setSavedAt(res.at);
        softRefresh();
      } catch {
        setFailedChannel(channel);
        setErr('Could not confirm the contact update. Check Last contacted before retrying.');
      } finally {
        lock.current = false;
      }
    });
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => { if (!lock.current) setOpen((o) => !o); }}
        disabled={pending}
        title="Record an off-thread touch (call, text, in person)"
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          color: 'var(--ink-3)',
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Saving…' : savedAt ? 'Saved ✓' : 'I reached out'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 8px 28px rgba(30, 46, 52, 0.12)',
            minWidth: 160,
          }}
        >
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--ink)',
                letterSpacing: '.04em',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {err && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            background: 'var(--paper)',
            border: '1px solid var(--negative)',
            color: 'var(--negative)',
            padding: '6px 10px',
            fontSize: 11,
            maxWidth: 240,
          }}
        >
          {err}
          {failedChannel && <button type="button" disabled={pending} onClick={() => pick(failedChannel)} style={{ display: 'block', marginTop: 6 }}>Retry {CHANNELS.find((c) => c.id === failedChannel)?.label}</button>}
          <button type="button" disabled={pending} onClick={() => { setErr(null); setFailedChannel(null); }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
