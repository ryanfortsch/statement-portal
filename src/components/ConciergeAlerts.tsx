import Link from 'next/link';
import { Section } from '@/components/Section';
import { ConciergeClearButton } from '@/components/ConciergeClearButton';
import { getConciergeAttention, isStayConciergeConfigured } from '@/lib/stay-concierge';
import {
  conciergeAlertCopy,
  conciergeAlertsFor,
  conciergeAlertTitle,
  criticalAlertCopy,
  plainAlertDate,
  type AlertCopy,
  type AlertHome,
  type ConciergeAlert,
  type ConciergeCritical,
} from '@/lib/concierge-alerts';
import { sessionRole } from '@/lib/helm-access-server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

/**
 * What the stay-concierge could not finish on its own: guest emergencies and
 * the alerts it files (a guest message that got no draft, a reply the
 * channel refused, a payment link that never went out).
 *
 * Every one of these used to be a text to a team list that has been empty
 * since 2026-08-20, so they reached nobody: 19 guest messages with no draft
 * and 12 guest emergencies between Sep 12 and Sep 26, one of them a guest
 * locked out at 73 Rocky Neck at 2:45 AM.
 *
 * They are messaging work, so the rows live on /messaging above the queue
 * (ConciergeAlertList), each as the home, a plain date, one sentence and one
 * verb. The home page carries one line with the count (ConciergeAlertsLine).
 * Emergencies lead and clear themselves once their card is handled; every
 * row also clears with "Clear for everyone", because an alert somebody
 * handled is handled.
 *
 * Both render nothing when there is nothing to show, and nothing when the
 * concierge cannot be read: /messaging owns "service unreachable", and a
 * failed read must never pass for an all-clear.
 *
 * Role-aware: an owner-line alert is owner work, so a staff login never sees
 * one (`conciergeAlertsFor`), and the counts are of what that login can act
 * on.
 */
async function loadAlerts(): Promise<{ criticals: ConciergeCritical[]; items: ConciergeAlert[] } | null> {
  if (!isStayConciergeConfigured()) return null;
  const [res, role] = await Promise.all([getConciergeAttention(), sessionRole()]);
  if (!res.ok) return null;
  const items = conciergeAlertsFor(role ?? 'staff', res.data.items);
  return { criticals: res.data.criticals, items };
}

async function loadHomes(): Promise<AlertHome[]> {
  try {
    const { data } = await supabase.from('properties').select('id, name');
    return ((data ?? []) as AlertHome[]).filter((h) => h.id && h.name);
  } catch {
    return [];
  }
}

function countLine(criticals: number, items: number): string {
  const bits = [
    criticals > 0 ? `${criticals} guest emergenc${criticals === 1 ? 'y' : 'ies'}` : null,
    items > 0 ? `${items} alert${items === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

/** The home page's one line: how many, linking to the rows on Messaging. */
export async function ConciergeAlertsLine() {
  const alerts = await loadAlerts();
  if (!alerts) return null;
  const { criticals, items } = alerts;
  if (criticals.length + items.length === 0) return null;
  const urgent = criticals.length > 0;
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20 }}>
      <Link
        href="/messaging#alerts"
        role={urgent ? 'alert' : undefined}
        className="eyebrow"
        style={{
          display: 'inline-block',
          padding: '6px 0',
          textDecoration: 'none',
          color: urgent ? 'var(--signal)' : 'var(--ink-3)',
          fontWeight: urgent ? 700 : 500,
        }}
      >
        {countLine(criticals.length, items.length)} on Messaging →
      </Link>
    </section>
  );
}

/** The rows themselves, above the queue on /messaging. */
export async function ConciergeAlertList() {
  const alerts = await loadAlerts();
  if (!alerts) return null;
  const { criticals, items } = alerts;
  if (criticals.length + items.length === 0) return null;
  const homes = await loadHomes();
  const now = new Date();

  return (
    <Section id="alerts" title="Alerts" eyebrow={countLine(criticals.length, items.length)} paddingTop={28} paddingBottom={8}>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {criticals.map((c) => {
          const copy = criticalAlertCopy(c, homes);
          return (
            <AlertRow
              key={c.item_key}
              itemKey={c.item_key}
              emergency
              head={copy.home ? `Guest emergency · ${copy.home}` : 'Guest emergency'}
              when={plainAlertDate(c.created_at, now)}
              copy={copy}
            />
          );
        })}
        {items.map((i) => {
          const copy = conciergeAlertCopy(i, homes);
          return (
            <AlertRow
              key={i.item_key}
              itemKey={i.item_key}
              head={copy.home ?? conciergeAlertTitle(i.kind)}
              when={plainAlertDate(i.created_at, now)}
              copy={copy}
            />
          );
        })}
      </div>
    </Section>
  );
}

function AlertRow({
  itemKey,
  head,
  when,
  copy,
  emergency = false,
}: {
  itemKey: string;
  head: string;
  when: string;
  copy: AlertCopy;
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
          <span
            style={{
              fontSize: 14,
              fontWeight: emergency ? 700 : 600,
              color: emergency ? 'var(--signal)' : 'var(--ink)',
            }}
          >
            {head}
          </span>
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ink-4)' }}>{when}</span>
        </div>
        <div style={{ marginTop: 3, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          {copy.sentence}
        </div>
        <div className="flex items-center flex-wrap" style={{ gap: 18, marginTop: 4 }}>
          {copy.verb && (
            <Link
              href={copy.verb.href}
              style={{
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: emergency ? 'var(--signal)' : 'var(--tide-deep)',
                textDecoration: 'none',
                padding: '6px 0',
              }}
            >
              {copy.verb.label} →
            </Link>
          )}
          <ConciergeClearButton itemKey={itemKey} />
        </div>
      </div>
    </div>
  );
}
