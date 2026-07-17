'use client';

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

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
 * Active tab flips locally (instant — all panels are pre-rendered) and
 * syncs to `?tab=` via router.replace in a background transition, so
 * deep links stay shareable and the router's canonical URL stays honest
 * (a raw history.replaceState desyncs it and the next server-action
 * revalidation scroll-yanks; see #1056). The server reads the same
 * param to pick the initial tab so a deep link lands on the right panel.
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
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  function select(id: string) {
    // Local state flips the panel instantly (everything is already
    // server-rendered); the URL syncs in a background transition via
    // router.replace so the router's canonical URL stays honest. A raw
    // history.replaceState here desyncs it, and the NEXT server-action
    // revalidation (mark a slip done, quick capture) then treats its
    // refresh as a real navigation and yanks scroll to the top — the
    // same 16.2.4 trap the work board hit (#1056).
    setActive(id);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', id);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <TabCtx.Provider value={{ active }}>
      <style>{`
        .rt-tab { transition: color 0.15s ease, border-color 0.15s ease; }
        .rt-tab:hover { color: var(--ink); }
        .rt-tab:focus-visible { outline: 2px solid var(--tide-deep); outline-offset: -2px; }
      `}</style>
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
                className="rt-tab"
                onClick={() => select(t.id)}
                aria-current={on ? 'page' : undefined}
                style={{
                  appearance: 'none',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: on ? '2px solid var(--signal)' : '2px solid transparent',
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
