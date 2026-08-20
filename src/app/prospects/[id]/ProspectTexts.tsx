import type { GmailTouches, GmailTouchType } from '@/lib/projections-types';

export type ProspectText = { direction: 'inbound' | 'outbound'; body: string; at: string };

// Light heuristic to flag deal-relevant texts. This only HIGHLIGHTS — it
// never advances the deal stage (the e-sign flow stays the source of truth).
const DEAL_RE = /\b(sign|signed|signing|contract|photo|photos|photoshoot|onboard|onboarding|deposit|schedule|scheduled|agreement|docusign|paperwork)\b/i;

const EMAIL_LABEL: Record<GmailTouchType, string> = {
  projection: 'Sent the projection',
  guide: 'Sent the partnership guide',
  contract: 'Sent the contract',
  onboarding: 'Sent the onboarding link',
};

type CommItem =
  | { kind: 'sms'; direction: 'inbound' | 'outbound'; body: string; at: string }
  | { kind: 'email'; from_user: string | undefined; type: GmailTouchType; subject: string; at: string };

/**
 * Communications panel on the prospect detail page.
 *
 * Merges Quo SMS exchanges (matched to this prospect's phone) and Gmail
 * sends (one entry per deliverable type) into a single chronological
 * stream so the deal's whole back-and-forth lives in one place. Renamed
 * from "Texts" once email events were folded in.
 *
 * Wrapped in a native <details> so the section is collapsed by default
 * — the stream gets long quickly and shouldn't push the rest of the
 * page below the fold for every prospect detail visit. The summary
 * line surfaces the count and the most recent timestamp so it's still
 * scannable while closed.
 */
export function ProspectTexts({
  texts,
  touches,
  name,
}: {
  texts: ProspectText[];
  touches?: GmailTouches | null;
  name: string | null;
}) {
  const items = mergeStream(texts, touches);
  if (items.length === 0) return null;

  const mostRecent = items[0]; // sorted desc by `at`
  const counts = { sms: 0, email: 0 };
  for (const i of items) counts[i.kind] += 1;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 32, width: '100%' }}>
      <details>
        <summary
          style={{
            listStyle: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            padding: '8px 0',
            userSelect: 'none',
            flexWrap: 'wrap',
          }}
        >
          <span aria-hidden style={{ fontSize: 10, color: 'var(--ink-4)' }}>▸</span>
          <h2
            className="font-serif"
            style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}
          >
            Communications{name ? ` with ${name}` : ''}
          </h2>
          <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
            {summaryLine(counts, mostRecent.at)}
          </span>
        </summary>

        <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '6px 0 14px' }}>
          Texts from Quo (matched to this prospect&rsquo;s phone) and Gmail sends from
          Helm. Deal-relevant texts are flagged.
        </p>

        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {items.map((item, i) => (item.kind === 'sms'
            ? <SmsRow key={i} item={item} />
            : <EmailRow key={i} item={item} />
          ))}
        </div>
      </details>
    </section>
  );
}

function SmsRow({ item }: { item: Extract<CommItem, { kind: 'sms' }> }) {
  const deal = DEAL_RE.test(item.body);
  const inbound = item.direction === 'inbound';
  const accent = inbound ? 'var(--signal)' : 'var(--tide-deep)';
  return (
    <div
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
      <Badge color={accent}>{inbound ? 'Them' : 'Us'}</Badge>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
          {item.body || '(no text)'}
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
          {fmtWhen(item.at)}
          {' · text'}
          {deal ? ' · deal signal' : ''}
        </div>
      </div>
    </div>
  );
}

function EmailRow({ item }: { item: Extract<CommItem, { kind: 'email' }> }) {
  const senderLabel = (item.from_user || 'Us').trim() || 'Us';
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        padding: '12px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <Badge color="var(--ink-3)">{senderLabel}</Badge>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{EMAIL_LABEL[item.type]}</div>
        {item.subject && (
          <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.subject}>
            {item.subject}
          </div>
        )}
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
          {fmtWhen(item.at)} · email
        </div>
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        color,
        border: `1px solid ${color}`,
        padding: '2px 7px',
        flexShrink: 0,
        marginTop: 2,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function mergeStream(texts: ProspectText[], touches: GmailTouches | null | undefined): CommItem[] {
  const out: CommItem[] = [];
  for (const t of texts) out.push({ kind: 'sms', direction: t.direction, body: t.body, at: t.at });
  if (touches) {
    (Object.entries(touches) as [GmailTouchType, GmailTouches[GmailTouchType]][]).forEach(([type, entry]) => {
      if (!entry) return;
      out.push({
        kind: 'email',
        type,
        from_user: entry.from_user,
        subject: entry.subject,
        at: entry.sent_at,
      });
    });
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

function summaryLine(counts: { sms: number; email: number }, mostRecentAt: string): string {
  const parts: string[] = [];
  if (counts.sms) parts.push(`${counts.sms} text${counts.sms === 1 ? '' : 's'}`);
  if (counts.email) parts.push(`${counts.email} email${counts.email === 1 ? '' : 's'}`);
  return `${parts.join(' · ')} · last ${fmtWhen(mostRecentAt)}`;
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}
