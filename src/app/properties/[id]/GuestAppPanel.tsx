'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { houseDay } from '@/lib/house-date';
import { DEFAULT_WELCOME, GUEST_APP_WELCOME_MAX, type MissingFact } from '@/lib/guest-app';
import type { GuestAppView } from '@/lib/guest-app-db';
import { CopyValue } from './CopyValue';
import {
  newGuestAppLink,
  saveGuestAppWelcome,
  turnOffGuestApp,
  turnOnGuestApp,
  type GuestAppActionResult,
} from './guest-app-actions';

/**
 * The Guest app panel on Guest & listing: this home's one permanent link,
 * the verbs that change it, the welcome under the home's name, and what the
 * app has nothing for yet. The QR card prints from the Guest documents grid
 * below; this panel is the link itself.
 */
export function GuestAppPanel({
  propertyId,
  initial,
  missing,
}: {
  propertyId: string;
  initial: GuestAppView | null;
  missing: MissingFact[];
}) {
  const [view, setView] = useState<GuestAppView | null>(initial);
  const [note, setNote] = useState(initial?.welcomeNote ?? '');
  const [saved, setSaved] = useState(false);
  const { pending, error, setError, run } = useRecoverableAction();
  const [doing, setDoing] = useState<string | null>(null);

  function act(name: string, call: () => Promise<GuestAppActionResult>) {
    setDoing(name);
    setSaved(false);
    run(async () => {
      const res = await call();
      if (res.ok) {
        setView(res.view);
        if (name === 'welcome') setSaved(true);
      } else setError(res.error);
      setDoing(null);
    }, 'Could not confirm the change was saved. Try again.');
  }

  if (!view) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: 560 }}>
          One link for this home: the QR card in the house and the link in a message both open it.
        </p>
        <Button variant="primary" size="sm" pending={pending && doing === 'on'} pendingLabel="Turning on" onClick={() => act('on', () => turnOnGuestApp(propertyId))}>
          Turn on the guest app
        </Button>
        {error ? <p style={errorStyle}>{error}</p> : null}
      </div>
    );
  }

  const opened =
    view.openCount > 0
      ? `Opened ${view.openCount === 1 ? 'once' : `${view.openCount.toLocaleString()} times`}${view.lastOpenedDay ? `, last ${houseDay(view.lastOpenedDay)}` : ''}`
      : 'Not opened by a guest yet';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 13,
              color: view.enabled ? 'var(--ink)' : 'var(--ink-4)',
              textDecoration: view.enabled ? 'none' : 'line-through',
              overflowWrap: 'anywhere',
            }}
          >
            {view.url}
          </span>
          <CopyValue value={view.url} label="guest app link" />
          {view.enabled ? (
            <a href={view.url} target="_blank" rel="noreferrer" style={linkStyle}>
              Open ↗
            </a>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {view.enabled ? opened : 'Off. The card and any link already sent show “This guide link has moved.”'}
          {view.rotatedDay ? ` · New link made ${houseDay(view.rotatedDay)}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {view.enabled ? (
            <Button
              variant="secondary"
              size="sm"
              pending={pending && doing === 'off'}
              pendingLabel="Turning off"
              onClick={() => act('off', () => turnOffGuestApp(propertyId))}
              confirm={{
                title: 'Turn off the guest app for this home?',
                body: 'The QR card in the house and every link already sent will show a page asking the guest to text us, until you turn it back on. The link itself stays the same.',
                confirmLabel: 'Turn off',
              }}
            >
              Turn off
            </Button>
          ) : (
            <Button variant="primary" size="sm" pending={pending && doing === 'on'} pendingLabel="Turning on" onClick={() => act('on', () => turnOnGuestApp(propertyId))}>
              Turn back on
            </Button>
          )}
          <Button
            variant="quiet"
            size="sm"
            pending={pending && doing === 'rotate'}
            pendingLabel="Making a new link"
            onClick={() => act('rotate', () => newGuestAppLink(propertyId))}
            confirm={{
              title: 'Make a new link for this home?',
              body: 'The printed QR card and every link already sent stop working at once. Print a new card for the house afterwards. Use this when a link reached someone it should not have.',
              confirmLabel: 'Make a new link',
              tone: 'danger',
              irreversible: true,
            }}
          >
            New link
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6, maxWidth: 640 }}>
        <label htmlFor={`guest-app-welcome-${propertyId}`} className="eyebrow">
          Welcome
        </label>
        <textarea
          id={`guest-app-welcome-${propertyId}`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          maxLength={GUEST_APP_WELCOME_MAX}
          rows={3}
          placeholder={DEFAULT_WELCOME}
          style={{
            width: '100%',
            fontSize: 13,
            lineHeight: 1.55,
            padding: '8px 10px',
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            size="sm"
            pending={pending && doing === 'welcome'}
            pendingLabel="Saving"
            disabled={note.trim() === view.welcomeNote.trim()}
            onClick={() => act('welcome', () => saveGuestAppWelcome(propertyId, note))}
          >
            Save welcome
          </Button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {saved ? 'Saved. Guests see it the next time they open the app.' : 'Blank uses the house welcome shown here.'}
          </span>
        </div>
      </div>

      {error ? <p style={errorStyle}>{error}</p> : null}

      {missing.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="eyebrow">Not in the app yet</div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            The app leaves each of these out until it is filled in here.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {missing.map((m) => (
              <li key={m.label} style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                {m.label}
                <span style={{ color: 'var(--ink-4)' }}> · {m.where}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  textDecoration: 'none',
};

const errorStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--negative)', lineHeight: 1.55 };
