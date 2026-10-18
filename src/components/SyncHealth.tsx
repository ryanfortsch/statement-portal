import Link from 'next/link';
import { Section } from '@/components/Section';
import { loadChannelsAttention, loadFeedsNeedingAttention } from '@/lib/daily-brief';
import { feedLine, plainDates } from '@/lib/sync-feed-words';

/**
 * Two blocks for Delivery & sync (/messaging/status), moved from the retired
 * /today page on 2026-10-18 and put in operator words:
 *
 *   Syncs               Helm's background feeds that have stopped or slowed,
 *                       each as Broken or Delayed with when it last worked.
 *   Calendars Helm runs homes whose calendar Helm runs instead of Guesty,
 *                       with what only a person can settle.
 *
 * Each renders nothing when all is well. A failed read says so: silence here
 * would read as "all clear".
 */
export async function SyncFeedsSection() {
  let feeds;
  try {
    feeds = await loadFeedsNeedingAttention();
  } catch {
    return (
      <Section title="Syncs" eyebrow="could not check">
        <p style={{ margin: 0, padding: '12px 0', borderTop: '1px solid var(--rule)', fontSize: 13, color: 'var(--ink-3)' }}>
          Helm could not read how its syncs are doing. Reload to try again.
        </p>
      </Section>
    );
  }
  if (feeds.length === 0) return null;
  const broken = feeds.filter((f) => f.status === 'error').length;
  const delayed = feeds.length - broken;
  const eyebrow = [broken ? `${broken} broken` : null, delayed ? `${delayed} delayed` : null].filter(Boolean).join(' · ');
  return (
    <Section id="syncs" title="Syncs" eyebrow={eyebrow}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--ink)' }}>
        {feeds.map((f) => {
          const line = feedLine(f);
          return (
            <li
              key={f.source}
              title={f.lastError ?? undefined}
              style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--rule)' }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ink)' }}>
                <span style={{ fontWeight: 500 }}>{line.name}</span>
                <span style={{ color: 'var(--ink-3)' }}> · {line.detail}</span>
              </span>
              <span
                className="eyebrow"
                style={{ flexShrink: 0, color: line.word === 'Broken' ? 'var(--signal)' : '#7a6a3a', fontWeight: 600 }}
              >
                {line.word}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export async function HelmRunHomesSection() {
  let homes;
  try {
    homes = await loadChannelsAttention();
  } catch {
    return null;
  }
  if (homes.length === 0) return null;
  return (
    <Section id="helm-run-homes" title="Calendars Helm runs" eyebrow={`${homes.length} to check`}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--ink)' }}>
        {homes.map((h) => (
          <li key={h.propertyId || h.propertyName} style={{ padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
            {h.propertyId ? (
              <Link href={`/channels/${h.propertyId}#attention`} style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', textDecoration: 'none' }}>
                {h.propertyName} →
              </Link>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{h.propertyName}</span>
            )}
            {h.items.map((item, i) => (
              <div key={i} style={{ marginTop: 3, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                {plainDates(item)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </Section>
  );
}
