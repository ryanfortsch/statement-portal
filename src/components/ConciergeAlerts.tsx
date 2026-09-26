import Link from 'next/link';
import { FeedClearButton } from '@/components/FeedClearButton';
import { getConciergeAttention, isStayConciergeConfigured } from '@/lib/stay-concierge';
import { alertSummary, conciergeAlertHref, conciergeAlertTitle } from '@/lib/concierge-alerts';
import { ageLabel } from '@/lib/payment-links-text';

/**
 * "Concierge needs you": what the stay-concierge could not finish on its own,
 * at the top of the home page.
 *
 * Every one of these used to be a text to a team list that has been empty
 * since 2026-08-20, so they reached nobody: 19 guest messages with no draft
 * and 12 guest emergencies between Sep 12 and Sep 26, one of them a guest
 * locked out at 73 Rocky Neck at 2:45 AM. Emergencies lead and clear
 * themselves once their card is handled; everything else clears with ×, for
 * everyone, because an alert somebody handled is handled.
 *
 * Renders nothing when there is nothing to show, and nothing when the
 * concierge cannot be read: /messaging owns "service unreachable", and a
 * failed read must never pass for an all-clear.
 */
export async function ConciergeAlerts() {
  if (!isStayConciergeConfigured()) return null;
  const res = await getConciergeAttention();
  if (!res.ok) return null;
  const { criticals, items } = res.data;
  const total = criticals.length + items.length;
  if (total === 0) return null;
  const now = Date.now();

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 28 }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 10, gap: 12 }}>
        <div className="eyebrow" style={{ color: 'var(--signal)', fontWeight: 700 }}>
          Concierge needs you
        </div>
        <span className="eyebrow">
          {criticals.length > 0
            ? `${criticals.length} emergenc${criticals.length === 1 ? 'y' : 'ies'}${items.length ? ` · ${items.length} more` : ''}`
            : `${items.length} to look at`}
        </span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {criticals.map((c) => (
          <AlertRow
            key={c.item_key}
            itemKey={c.item_key}
            emergency
            title="Guest emergency"
            meta={
              c.alert_count > 1
                ? `${ageLabel(c.created_at, now)} · flagged ${c.alert_count} times`
                : ageLabel(c.created_at, now)
            }
            summary={c.summary}
            href="/messaging"
          />
        ))}
        {items.map((i) => (
          <AlertRow
            key={i.item_key}
            itemKey={i.item_key}
            title={conciergeAlertTitle(i.kind)}
            meta={ageLabel(i.created_at, now)}
            summary={i.summary}
            href={conciergeAlertHref(i.kind)}
          />
        ))}
      </div>
    </section>
  );
}

function AlertRow({
  itemKey,
  title,
  meta,
  summary,
  href,
  emergency = false,
}: {
  itemKey: string;
  title: string;
  meta: string;
  summary: string;
  href: string;
  emergency?: boolean;
}) {
  return (
    <div
      role={emergency ? 'alert' : undefined}
      style={{
        display: 'flex',
        gap: 12,
        padding: emergency ? '14px 12px' : '14px 0',
        borderBottom: '1px solid var(--rule)',
        alignItems: 'flex-start',
        ...(emergency ? { borderLeft: '4px solid var(--signal)', background: 'var(--paper-2)' } : {}),
      }}
    >
      {!emergency && (
        <span
          aria-hidden
          style={{ flexShrink: 0, width: 6, height: 6, marginTop: 7, borderRadius: 999, background: 'var(--signal)' }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
          <Link
            href={href}
            style={{
              fontSize: 14,
              fontWeight: emergency ? 700 : 500,
              color: emergency ? 'var(--signal)' : 'var(--ink)',
              textDecoration: 'none',
            }}
          >
            {title}
          </Link>
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ink-4)' }}>{meta}</span>
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          {alertSummary(summary)}
        </div>
      </div>
      <FeedClearButton itemType="concierge" itemId={itemKey} />
    </div>
  );
}
