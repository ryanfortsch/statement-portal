import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { listSegments } from '@/lib/guests';
import { TONE_OPTIONS } from '@/lib/ai/brand-voice';
import { createDraftFromBrief, createDraftCampaign } from '../actions';
import { DraftButton } from './DraftButton';

export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const segments = await listSegments();
  const insider = segments.find((s) => s.name === 'Insider List');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="marketing" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests/campaigns" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Campaigns</Link>
        </div>
        <h1 className="font-serif" style={{
          fontSize: 36,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
        }}>
          New campaign
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 580 }}>
          Describe what the campaign is about, pick a tone and a segment, and Helm will draft the subject, preheader, and body in the Stay Cape Ann voice. You can refine everything on the next page.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, flex: 1, width: '100%' }}>
        <form
          action={createDraftFromBrief}
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
              {TONE_OPTIONS.map((t, i) => (
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
                    defaultChecked={i === 0}
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
              defaultValue={insider?.id ?? ''}
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
            <DraftButton />
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
            style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <input
              name="name"
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
              Blank draft
            </button>
          </form>
        </details>
      </section>

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot; Guests &middot; New Campaign</span>
        </div>
      </footer>
    </div>
  );
}
