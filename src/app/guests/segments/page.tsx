import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { listSegments } from '@/lib/guests';

export const dynamic = 'force-dynamic';

export default async function GuestSegmentsPage() {
  const segments = await listSegments();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="marketing" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Guests</Link>
        </div>
        <h1 className="font-serif" style={{
          fontSize: 36,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
        }}>
          Segments
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          Saved tag-based filters used as send targets. Edit and creation UI lands with the campaign composer.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {segments.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
            No segments yet. Run the audience migration to seed defaults.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {segments.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 24,
                  padding: '20px 0',
                  borderBottom: '1px solid var(--rule)',
                  alignItems: 'baseline',
                }}
              >
                <div>
                  <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, margin: 0, color: 'var(--ink)' }}>
                    {s.name}
                  </h3>
                  {s.description && (
                    <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>{s.description}</p>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {s.required_tags.map((t) => (
                      <span key={'r-' + t} style={chipStyle('include')}>{t}</span>
                    ))}
                    {s.excluded_tags.map((t) => (
                      <span key={'e-' + t} style={chipStyle('exclude')}>!{t}</span>
                    ))}
                    {s.status_in.map((st) => (
                      <span key={'s-' + st} style={chipStyle('status')}>{st}</span>
                    ))}
                  </div>
                </div>
                <span className="tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {s.cached_recipient_count != null ? `${s.cached_recipient_count} recipients` : '—'}
                </span>
                <span className="eyebrow" style={{ color: s.is_system ? 'var(--ink-4)' : 'var(--ink)' }}>
                  {s.is_system ? 'system' : 'custom'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot;Guests&middot; Segments</span>
        </div>
      </footer>
    </div>
  );
}

function chipStyle(kind: 'include' | 'exclude' | 'status'): React.CSSProperties {
  const palette = {
    include: { color: 'var(--ink-3)', border: '1px solid var(--rule)' },
    exclude: { color: 'var(--signal)', border: '1px solid var(--signal)' },
    status: { color: 'var(--ink)', border: '1px solid var(--ink)' },
  } as const;
  return {
    fontSize: 10,
    letterSpacing: '.04em',
    padding: '2px 8px',
    ...palette[kind],
  };
}
