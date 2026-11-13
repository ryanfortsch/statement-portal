'use client';

import { useState } from 'react';
import type { StayLayer } from '@/lib/guest-app-stays';

/**
 * "Your stay": the guest's dates, the door code behind one tap, and the
 * arrival steps. Rendered on the server like the rest of the app; the one
 * browser-only thing is the tap, which POSTs to /h/s/<token>/code and gets
 * the digits back. The digits are never in this component's props: the
 * page's HTML cannot carry what it was never given.
 */
type Reveal =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'shown'; code: string; worksFrom: string | null; worksUntil: string | null; doorCount: number }
  | { state: 'error'; message: string };

export function StayCard({ token, stay, textUs }: { token: string; stay: StayLayer; textUs: string }) {
  const [reveal, setReveal] = useState<Reveal>({ state: 'idle' });
  const [copied, setCopied] = useState(false);

  async function show() {
    setReveal({ state: 'loading' });
    try {
      const res = await fetch(`/h/s/${token}/code`, { method: 'POST', cache: 'no-store', headers: { Accept: 'application/json' } });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; code: string; worksFrom: string | null; worksUntil: string | null; doorCount: number }
        | { ok: false; reason?: string }
        | null;
      if (body && body.ok) {
        setReveal({ state: 'shown', code: body.code, worksFrom: body.worksFrom, worksUntil: body.worksUntil, doorCount: body.doorCount });
        return;
      }
      const reason = body && !body.ok ? body.reason : null;
      setReveal({
        state: 'error',
        message:
          reason === 'not_open'
            ? 'This stay link has closed. Text us if you are still at the house.'
            : 'We could not load your code just now. It is also in your check-in message, or text us.',
      });
    } catch {
      setReveal({ state: 'error', message: 'No connection right now. Your code is also in your check-in message.' });
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the code is on screen */
    }
  }

  const code = stay.code;

  return (
    <section className="ga-stay" id="your-stay" aria-label="Your stay">
      <h2 className="ga-h2">Your stay</h2>
      <div className="ga-stay-dates">
        <div className="ga-stay-date">
          <div className="ga-item-k">Arrive</div>
          <div className="ga-stay-date-v">{stay.arriveDay}</div>
          {stay.arriveTime ? <div className="ga-stay-date-t">From {stay.arriveTime}</div> : null}
        </div>
        <div className="ga-stay-date">
          <div className="ga-item-k">Leave</div>
          <div className="ga-stay-date-v">{stay.leaveDay}</div>
          <div className="ga-stay-date-t">By {stay.leaveTime}</div>
        </div>
      </div>

      {code?.available ? (
        <div className="ga-code">
          <div className="ga-item-k">Door code</div>
          {reveal.state === 'shown' ? (
            <>
              <div className="ga-code-v">
                <span className="ga-code-digits" translate="no">
                  {reveal.code}
                </span>
                <button type="button" className="ga-copy" onClick={() => copy(reveal.code)}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="ga-aside">
                {reveal.worksFrom ? `Works from ${reveal.worksFrom}. ` : ''}
                {reveal.worksUntil ? `Works until ${reveal.worksUntil}.` : ''}
                {reveal.doorCount > 1 ? ' The same code opens every keypad at the house.' : ''}
              </p>
            </>
          ) : (
            <>
              <button type="button" className="ga-btn" onClick={show} disabled={reveal.state === 'loading'}>
                {reveal.state === 'loading' ? 'One moment' : 'Show my door code'}
              </button>
              {reveal.state === 'error' ? (
                <p className="ga-code-err">
                  {reveal.message}{' '}
                  <a href={textUs}>Text us</a>
                </p>
              ) : (
                <p className="ga-aside">Your own code for this stay. It stops working at checkout.</p>
              )}
            </>
          )}
        </div>
      ) : null}

      <div className="ga-items">
        {stay.steps.map((s, i) => (
          <div key={`${s.label ?? 'step'}-${i}`} className="ga-item">
            {s.label ? <div className="ga-item-k">{s.label}</div> : null}
            <div className="ga-item-v">
              <span className={s.copy ? 'ga-mono' : undefined} translate={s.noTranslate ? 'no' : undefined}>
                {s.text}
              </span>
            </div>
            {s.link ? (
              <a className="ga-link" href={s.link.href} target={s.link.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                {s.link.label} &rarr;
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
