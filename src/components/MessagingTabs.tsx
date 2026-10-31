import Link from 'next/link';
import { SectionTabs } from './SectionTabs';
import { MessagingTabCount } from './MessagingTabCount';

/**
 * Sub-navigation for the Messaging section, in two rows.
 *
 * Row 1 (audience) is the primary axis: Guests, Owners, Team. Each is a
 * queue on the one approval card, with a MessagingTabCount pill so the
 * operator can see which has drafts waiting. Team is the cleaners and the
 * contractors in one list (/messaging/team, 2026-10-18); the two old routes
 * redirect there. `current` stays required: the routes share no common
 * prefix, so the caller names its own tab.
 *
 * Row 2 (lens) is the function within an audience. Guests has four
 * surfaces: Inbox (the approval queue + conversation browser), Send (pick a
 * stay and write to them), Saved replies, and Quality (how the AI is doing
 * and what it is being taught; off the Inbox since 2026-10-17 so the working
 * page ends at Conversations). It rides in SectionTabs' `secondRow` slot,
 * the same primitive FieldTabs uses for its lens row.
 *
 * A lens row appears only when there is more than one destination: Guests
 * has four, the other audiences have none. A single Inbox label would add
 * no navigation and waste the space.
 *
 * Role-aware through SectionTabs: Owners (`/owner-messaging`) is an owner
 * page, so the strip drops that tab and its count pill for a staff login.
 */

type MessagingAudience = 'guests' | 'owners' | 'team';
/** 'none' is a page of the section that belongs to no audience (Delivery &
 *  sync): the strip renders with no tab lit, so the way out is still there. */
type MessagingLens = 'inbox' | 'reviews' | 'send' | 'blurbs' | 'quality';

export function MessagingTabs({
  current,
  lens = 'inbox',
}: {
  current: MessagingAudience | 'none';
  lens?: MessagingLens;
}) {
  const lenses: { id: MessagingLens; label: string; href: string }[] =
    current === 'guests'
      ? [
          { id: 'inbox', label: 'Inbox', href: '/messaging' },
          // Our reviews of guests and replies to theirs (2026-10-30): a
          // stop card is time-bound, so this lens carries a count pill.
          { id: 'reviews', label: 'Guest reviews', href: '/messaging/reviews' },
          { id: 'send', label: 'Send', href: '/messaging/send' },
          { id: 'blurbs', label: 'Saved replies', href: '/messaging/blurbs' },
          { id: 'quality', label: 'Quality', href: '/messaging/quality' },
        ]
      : [];

  return (
    <div className="rt-messaging-tabs">
    <SectionTabs
      current={current}
      tabs={[
        { id: 'guests', label: 'Guests', href: '/messaging', badge: <MessagingTabCount category="guests" /> },
        { id: 'owners', label: 'Owners', href: '/owner-messaging', badge: <MessagingTabCount category="owners" /> },
        { id: 'team', label: 'Team', href: '/messaging/team', badge: <MessagingTabCount category="team" /> },
      ]}
      secondRow={lenses.length > 0 ?
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
                {l.id === 'reviews' && <MessagingTabCount category="reviews" />}
              </span>
            );
          })}
        </div> : undefined
      }
    />
    {/* Search and the Delivery & sync row are no longer drawn here: the
        queue comes first on every inbox page (2026-10-18). Pages render
        InboxHealth placement="top" (problems only) above the queue and
        InboxBottomTools at their foot. */}
    </div>
  );
}
