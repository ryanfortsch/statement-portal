'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { CopyValue } from './CopyValue';
import { stayLinkAction, type StayLinkActionResult } from './guest-code-actions';

/**
 * One stay's guest app link, on its row in Guest door codes. The link is
 * made on the first tap and is the same link after; it shows this stay's
 * door code from 10 AM the day before check-in to checkout, behind a tap
 * (src/lib/guest-app-stays.ts). Nothing here messages the guest: paste it
 * into the check-in message yourself.
 */
export function StayLinkControl({ propertyId, bookingId }: { propertyId: string; bookingId: string }) {
  const [link, setLink] = useState<{ url: string; closes: string } | null>(null);
  const { pending, error, setError, run } = useRecoverableAction();
  const [doing, setDoing] = useState<'get' | 'new' | null>(null);

  function act(kind: 'get' | 'new') {
    setDoing(kind);
    run(async () => {
      const res: StayLinkActionResult = await stayLinkAction(propertyId, bookingId, kind === 'new');
      if (res.ok) setLink({ url: res.url, closes: res.closes });
      else setError(res.message);
      setDoing(null);
    }, 'Could not confirm the link was made. Try again.');
  }

  if (!link) {
    return (
      <div style={{ marginTop: 4 }}>
        <Button variant="quiet" size="sm" pending={pending && doing === 'get'} pendingLabel="Making the link" onClick={() => act('get')}>
          Guest app link
        </Button>
        {error ? <div style={errorStyle}>{error}</div> : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
          {link.url}
        </span>
        <CopyValue value={link.url} label="stay link" />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>Door code inside from 10 AM the day before check-in · works until {link.closes}</div>
      <div>
        <Button
          variant="quiet"
          size="sm"
          pending={pending && doing === 'new'}
          pendingLabel="Making a new link"
          onClick={() => act('new')}
          confirm={{
            title: 'Make a new link for this stay?',
            body: 'The link already sent stops working at once, and the guest needs the new one. Use this when the link reached someone it should not have.',
            confirmLabel: 'Make a new link',
            tone: 'danger',
            irreversible: true,
          }}
        >
          New link
        </Button>
      </div>
      {error ? <div style={errorStyle}>{error}</div> : null}
    </div>
  );
}

const errorStyle: React.CSSProperties = { fontSize: 12, color: 'var(--negative)', lineHeight: 1.5, marginTop: 4 };
