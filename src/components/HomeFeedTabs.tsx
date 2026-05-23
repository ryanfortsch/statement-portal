'use client';

import { useState } from 'react';

/**
 * Home-page feed tabs. "For Me" (the triaged signal feed — important
 * emails + messages that need attention) is the default; "Recent
 * Activity" (the team-wide event log) sits behind the second tab.
 *
 * Both panels are server-rendered and passed in as props; this client
 * shell only toggles which one is visible, so neither re-fetches on
 * switch and the default ("For Me") is what the user lands on.
 */
export function HomeFeedTabs({
  forMe,
  recentActivity,
}: {
  forMe: React.ReactNode;
  recentActivity: React.ReactNode;
}) {
  const [tab, setTab] = useState<'forme' | 'activity'>('forme');

  return (
    <>
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%' }}>
        <div
          role="tablist"
          aria-label="Home feed"
          style={{
            display: 'flex',
            gap: 28,
            borderBottom: '1px solid var(--ink)',
          }}
        >
          <TabButton active={tab === 'forme'} onClick={() => setTab('forme')}>
            For Me
          </TabButton>
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
            Recent Activity
          </TabButton>
        </div>
      </section>

      {/* Both panels stay mounted; we toggle visibility so switching is
          instant and the server data isn't re-fetched. */}
      <div style={{ display: tab === 'forme' ? 'block' : 'none' }}>{forMe}</div>
      <div style={{ display: tab === 'activity' ? 'block' : 'none' }}>{recentActivity}</div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: '0 0 12px',
        marginBottom: -1,
        fontSize: 13,
        letterSpacing: '0.04em',
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        borderBottom: active ? '2px solid var(--signal)' : '2px solid transparent',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
