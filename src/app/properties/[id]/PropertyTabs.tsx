'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/**
 * Tabbed shell for the property detail page.
 *
 * The page is a server component that fetches a lot and renders many
 * server sub-components (PropertyActivityList, PropertyCrmSection, the
 * CollapsibleSections, etc.). Rather than refactor all of that into
 * client code, this client shell takes the already-server-rendered
 * sections as children and shows only the active tab's panel via the
 * `hidden` attribute. Everything renders once on the server; switching
 * tabs is instant with no refetch.
 *
 * Active tab syncs to `?tab=` through history.replaceState (no full
 * navigation, so it's shareable + survives back/forward without a
 * server round-trip). The server reads the same param to pick the
 * initial tab so a deep link lands on the right panel.
 */

type TabDef = { id: string; label: string; badge?: string | number };

const TabCtx = createContext<{ active: string }>({ active: '' });

export function PropertyTabs({
  tabs,
  initialTab,
  children,
}: {
  tabs: TabDef[];
  initialTab: string;
  children: ReactNode;
}) {
  const valid = tabs.some((t) => t.id === initialTab) ? initialTab : tabs[0]?.id ?? '';
  const [active, setActive] = useState(valid);

  function select(id: string) {
    setActive(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', id);
      window.history.replaceState(null, '', url.toString());
    } catch {
      // history API unavailable — tab still switches, URL just won't update.
    }
  }

  return (
    <TabCtx.Provider value={{ active }}>
      <nav
        className="rt-tabnav"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--paper)',
          borderBottom: '1px solid var(--ink)',
        }}
        aria-label="Property sections"
      >
        <div
          className="max-w-[1100px] mx-auto px-10"
          style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}
        >
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => select(t.id)}
                aria-current={on ? 'page' : undefined}
                style={{
                  appearance: 'none',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: on ? '2px solid var(--ink)' : '2px solid transparent',
                  margin: '0 0 -1px',
                  padding: '14px 14px 12px',
                  fontSize: 11,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  fontWeight: on ? 600 : 500,
                  color: on ? 'var(--ink)' : 'var(--ink-3)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                {t.label}
                {t.badge != null && t.badge !== '' && t.badge !== 0 && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono-dash), ui-monospace, monospace',
                      fontSize: 10,
                      letterSpacing: '0.02em',
                      color: on ? 'var(--signal)' : 'var(--ink-4)',
                      fontWeight: 600,
                    }}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
      {children}
    </TabCtx.Provider>
  );
}

/** One tab's content. Renders its children always (so server data is
 *  pre-rendered) and hides the panel when its tab isn't active. */
export function TabSection({ tab, children }: { tab: string; children: ReactNode }) {
  const { active } = useContext(TabCtx);
  return (
    <div role="tabpanel" hidden={active !== tab}>
      {children}
    </div>
  );
}
