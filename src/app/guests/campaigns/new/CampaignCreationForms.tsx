'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { createDraftFromBrief, createDraftCampaign } from '../actions';
import { DraftButton } from './DraftButton';

type Props = {
  segments: { id: string; name: string }[];
  tones: { id: string; label: string; sub: string }[];
  defaultSegment: string;
};

export function CampaignCreationForms({ segments, tones, defaultSegment }: Props) {
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState(tones[0]?.id ?? 'editorial');
  const [segment, setSegment] = useState(defaultSegment);
  const [name, setName] = useState('');
  const [active, setActive] = useState<'brief' | 'blank'>('brief');
  const { busy, pending, error, run } = useRecoverableAction();
  useDraftNavigationGuard(Boolean(brief || name || tone !== tones[0]?.id || segment !== defaultSegment), pending);

  function submit(event: FormEvent<HTMLFormElement>, kind: 'brief' | 'blank') {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    setActive(kind);
    run(async () => {
      await (kind === 'brief' ? createDraftFromBrief(data) : createDraftCampaign(data));
    }, 'Could not confirm draft creation. Your text is still here. Check Campaigns in a new tab before retrying, in case the draft was created.');
  }

  return <>
    {error && <p role="alert" style={{ color: 'var(--negative)', maxWidth: 720 }}>
      {error} <a href="/guests/campaigns" target="_blank" rel="noopener noreferrer">Check Campaigns</a> Then use the draft button to retry.
    </p>}
        <form
          action={createDraftFromBrief}
          onSubmit={(event) => submit(event, 'brief')}
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            padding: '32px 0',
            display: 'grid',
            gap: 24,
            maxWidth: 720,
          }}
        >
          <div>
            <label htmlFor="brief" className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>
              What&rsquo;s the campaign about?
            </label>
            <textarea
              id="brief"
              name="brief"
              required
              value={brief}
              onChange={event => setBrief(event.target.value)}
              disabled={pending}
              rows={5}
              placeholder="21 Horton just opened a July 4 week. Members-only rate of $X/night. Want it to feel like a quiet heads-up, not a sale."
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--rule)',
                color: 'var(--ink)',
                fontSize: 14,
                lineHeight: 1.6,
                padding: '12px 14px',
                outline: 'none',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
            <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-4)' }}>
              Plain English. Mention the home, the window, the rate or angle. Vague briefs get a reasonable specific guess and you can edit.
            </p>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Tone</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {tones.map((t) => (
                <label
                  key={t.id}
                  style={{
                    border: '1px solid var(--rule)',
                    padding: '14px 16px',
                    cursor: 'pointer',
                    display: 'block',
                  }}
                >
                  <input
                    type="radio"
                    name="tone"
                    value={t.id}
                    checked={tone === t.id}
                    onChange={() => setTone(t.id)}
                    disabled={pending}
                    required
                    style={{ marginRight: 8 }}
                  />
                  <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{t.label}</strong>
                  <p style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.45 }}>{t.sub}</p>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="segment_id" className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>
              Send to
            </label>
            <select
              id="segment_id"
              name="segment_id"
              value={segment}
              onChange={event => setSegment(event.target.value)}
              disabled={pending}
              style={{
                width: '100%',
                maxWidth: 480,
                background: 'transparent',
                border: '1px solid var(--rule)',
                color: 'var(--ink)',
                fontSize: 14,
                padding: '10px 12px',
                outline: 'none',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <option value="">No segment yet (pick later)</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-4)' }}>
              Picking now helps the AI tune the message to who&rsquo;s receiving it. You can change this on the composer.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <DraftButton pending={pending && active === 'brief'} disabled={pending} />
            <Link href="/guests/campaigns" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Cancel
            </Link>
          </div>
        </form>

        {/* Escape hatch for the case where you just want a blank composer
            (drafting from scratch, AI is down, etc.) */}
        <details style={{ marginTop: 24, fontSize: 12, color: 'var(--ink-3)' }}>
          <summary style={{ cursor: 'pointer' }}>Or start from a blank draft</summary>
          <form
            action={createDraftCampaign}
            onSubmit={(event) => submit(event, 'blank')}
            style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <input
              name="name"
              aria-label="Campaign name"
              value={name}
              onChange={event => setName(event.target.value)}
              disabled={pending}
              type="text"
              required
              placeholder="The Weekly · vol 12"
              style={{
                background: 'transparent',
                border: '1px solid var(--rule)',
                color: 'var(--ink)',
                fontSize: 13,
                padding: '8px 12px',
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 280,
              }}
            />
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending && active === 'blank'}
              style={{
                background: 'transparent',
                color: 'var(--ink)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                padding: '8px 14px',
                border: '1px solid var(--ink)',
                cursor: 'pointer',
              }}
            >
              {pending && active === 'blank' ? 'Creating draft…' : 'Blank draft'}
            </button>
          </form>
        </details>
  </>;
}
