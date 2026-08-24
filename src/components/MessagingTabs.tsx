import Link from 'next/link';
import { SectionTabs } from './SectionTabs';
import { MessagingTabCount } from './MessagingTabCount';

/**
 * Sub-navigation for the Messaging section, in two rows.
 *
 * Row 1 (audience) is the primary axis: Guests, Owners, Cleaners,
 * Contractors. Each is a queue backed by the same Stay Concierge approval
 * flow, with a MessagingTabCount pill so the operator can see which queue
 * has drafts waiting. `current` stays required: the four routes share no
 * common prefix, so the caller names its own tab.
 *
 * Row 2 (lens) is the function within an audience. Guests has two surfaces:
 * Inbox (the approval queue + conversation browser) and Send (pick a stay
 * and write to them). It rides in SectionTabs' `secondRow` slot, the same
 * primitive FieldTabs uses for its lens row.
 *
 * The second row renders on ALL FOUR tabs, not just Guests. The other three
 * have a single Inbox lens today, but rendering the strip only for Guests
 * would make the header jump ~30px on every move between Guests and Owners,
 * which is a constant motion in real use.
 */

type MessagingAudience = 'guests' | 'owners' | 'cleaners' | 'contractors';
type MessagingLens = 'inbox' | 'send';

const AUDIENCE_HOME: Record<MessagingAudience, string> = {
  guests: '/messaging',
  owners: '/owner-messaging',
  cleaners: '/cleaner-messaging',
  contractors: '/contractor-messaging',
};

export function MessagingTabs({
  current,
  lens = 'inbox',
}: {
  current: MessagingAudience;
  lens?: MessagingLens;
}) {
  const lenses: { id: MessagingLens; label: string; href: string }[] =
    current === 'guests'
      ? [
          { id: 'inbox', label: 'Inbox', href: '/messaging' },
          { id: 'send', label: 'Send', href: '/messaging/send' },
        ]
      : [{ id: 'inbox', label: 'Inbox', href: AUDIENCE_HOME[current] }];

  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'guests', label: 'Guests', href: '/messaging', badge: <MessagingTabCount category="guests" /> },
        { id: 'owners', label: 'Owners', href: '/owner-messaging', badge: <MessagingTabCount category="owners" /> },
        { id: 'cleaners', label: 'Cleaners', href: '/cleaner-messaging', badge: <MessagingTabCount category="cleaners" /> },
        { id: 'contractors', label: 'Contractors', href: '/contractor-messaging', badge: <MessagingTabCount category="contractors" /> },
      ]}
      secondRow={
        <div className="flex items-center" style={{ gap: 16, paddingTop: 10, paddingBottom: 2, overflowX: 'auto' }}>
          {lenses.map((l, i) => {
            const isActive = l.id === lens;
            return (
              <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 16, whiteSpace: 'nowrap' }}>
                {i > 0 && <span style={{ color: 'var(--rule)', fontSize: 12 }}>·</span>}
                <Link
                  href={l.href}
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    fontSize: 12,
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--ink)' : 'var(--ink-4)',
                    textDecoration: 'none',
                  }}
                >
                  {l.label}
                </Link>
              </span>
            );
          })}
        </div>
      }
    />
  );
}
