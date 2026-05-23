export type ProspectText = { direction: 'inbound' | 'outbound'; body: string; at: string };

// Light heuristic to flag deal-relevant texts. This only HIGHLIGHTS — it
// never advances the deal stage (the e-sign flow stays the source of truth).
const DEAL_RE = /\b(sign|signed|signing|contract|photo|photos|photoshoot|onboard|onboarding|deposit|schedule|scheduled|agreement|docusign|paperwork)\b/i;

export function ProspectTexts({ texts, name }: { texts: ProspectText[]; name: string | null }) {
  if (!texts.length) return null;
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 32, width: '100%' }}>
      <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '0 0 6px' }}>
        Texts{name ? ` with ${name}` : ''}
      </h2>
      <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '0 0 14px' }}>
        From Quo, matched to this prospect&rsquo;s phone. Deal-relevant texts are flagged.
      </p>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {texts.map((t, i) => {
          const deal = DEAL_RE.test(t.body);
          const inbound = t.direction === 'inbound';
          const accent = inbound ? 'var(--signal)' : 'var(--tide-deep)';
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                padding: '12px 0',
                paddingLeft: deal ? 12 : 0,
                borderBottom: '1px solid var(--rule)',
                borderLeft: deal ? '3px solid var(--signal)' : 'none',
                background: deal ? 'rgba(200, 90, 58, 0.04)' : 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: accent,
                  border: `1px solid ${accent}`,
                  padding: '2px 7px',
                  flexShrink: 0,
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {inbound ? 'Them' : 'Us'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{t.body || '(no text)'}</div>
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                  {fmtWhen(t.at)}
                  {deal ? ' · deal signal' : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}
