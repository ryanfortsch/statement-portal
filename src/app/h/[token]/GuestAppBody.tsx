'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { splitLong, type GuestApp, type GuestItem, type GuestSection, type GuestSectionId } from '@/lib/guest-app';
import type { NearbyPlace } from '@/lib/guest-app-nearby';

/**
 * The guest app as a phone reads it (2026-11-11, Dotti: "sections at the
 * top as options ... it's all gonna be on the phone, too much text").
 *
 * Two views, one document:
 *  - HOME: the hero and welcome (server-rendered, passed in), the stay card
 *    on a stay link, the Wi-Fi card, a search field, and a grid of tiles, one per section, each with the answer most
 *    guests open it for ("Checkout · 11:00 AM").
 *  - PAGES: each section is its own screen at #<id>, with a back link.
 *
 * The switch is CSS (`:target` and `:has`, in guest-app-css.ts), not React
 * state, so it works with JavaScript off, a tile tap is a real history
 * entry, and the phone's back gesture returns to the tiles. A browser too
 * old for `:has` gets the home screen with the section under it, which is
 * still the right content.
 *
 * Fewer words: long text (a city ordinance, a parking regulation) shows
 * its first sentence and a More toggle; one Text us button is pinned to
 * the bottom of every screen, and nothing asks a guest what went wrong.
 */

type Props = {
  app: GuestApp;
  /** One join-code SVG per network, by SSID. */
  wifiQr: Record<string, string>;
  /** Mark of the Stay Cape Ann brand, server-rendered. */
  mark: React.ReactNode;
  /** The hero, server-rendered. */
  hero: React.ReactNode;
  /** The welcome, and the stay card on a stay link, server-rendered. */
  intro: React.ReactNode;
  /** The stay link's email line on a direct booking, under "Come back to Cape Ann". The permanent page passes nothing. */
  join?: React.ReactNode;
};

const GUIDE_LINKS = [
  { href: 'https://staycapeann.com/guide/beaches', label: 'Beaches' },
  { href: 'https://staycapeann.com/guide/dining', label: 'Dining' },
  { href: 'https://staycapeann.com/guide/outdoors', label: 'Outdoors' },
  { href: 'https://staycapeann.com/guide/shopping-arts', label: 'Shopping & arts' },
  { href: 'https://staycapeann.com/guide/day-trips', label: 'Day trips' },
  { href: 'https://staycapeann.com/guide/seasonal', label: 'This season' },
];

/** The tile order on the home screen: what a guest in the house reaches for first. Safety is its own row under the grid, and Wi-Fi has its card. */
const TILE_ORDER: GuestSectionId[] = ['house', 'checkout', 'nearby', 'trash', 'rules', 'arrival'];

function words(q: string): string[] {
  return q.toLowerCase().split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

function itemText(i: GuestItem): string {
  return `${i.label ?? ''} ${i.text}`.toLowerCase();
}

function matches(text: string, ws: string[]): boolean {
  return ws.every((w) => text.includes(w));
}

function placeText(p: NearbyPlace): string {
  return `${p.name} ${p.town} ${p.category} ${p.blurb}`.toLowerCase();
}

export function GuestAppBody({ app, wifiQr, mark, hero, intro, join }: Props) {
  const [query, setQuery] = useState('');
  const ws = useMemo(() => words(query), [query]);
  // Whether the open page was reached from the home screen, so Back can
  // step back through history instead of stacking a new entry.
  const fromHome = useRef(false);

  useEffect(() => {
    // The offline copy. Scoped to /h/ so it never touches Helm's own pages.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        navigator.serviceWorker.register('/h/sw.js', { scope: '/h/' }).catch(() => {});
      } else {
        // A local preview: a saved copy of the last edit's code would hide this one.
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      }
    }
    const ids = new Set(app.sections.map((s) => s.id as string));
    const isPage = (h: string) => ids.has(h.replace(/^#/, ''));
    let prev = window.location.hash;
    const onHash = () => {
      const now = window.location.hash;
      fromHome.current = isPage(now) && !isPage(prev);
      prev = now;
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [app.sections]);

  function back(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!fromHome.current) return; // a page opened from a link: "#" lands on the tiles
    e.preventDefault();
    fromHome.current = false;
    window.history.back();
  }

  const byId = new Map(app.sections.map((s) => [s.id, s]));
  const tiles = TILE_ORDER.map((id) => byId.get(id)).filter((s): s is GuestSection => Boolean(s));
  const safety = byId.get('safety') ?? null;
  const wifiPage = byId.get('wifi') ?? null;
  const firstWifi = app.wifi[0] ?? null;

  return (
    <>
      <div className="ga-home">
        {hero}
        <main className="ga-main">
          {intro}

          {/* WI-FI: the thing asked most, readable without a tap. */}
          <section className="ga-wificard" aria-label="Wi-Fi">
            <div className="ga-wificard-head">
              <span className="ga-wificard-k">
                <Icon id="wifi" />
                Wi-Fi
              </span>
              {wifiPage ? (
                <a className="ga-wificard-more" href="#wifi">
                  {app.wifi.length > 1 ? `${app.wifi.length} networks` : 'More'} &rarr;
                </a>
              ) : null}
            </div>
            {firstWifi ? (
              <>
                <div className="ga-wificard-ssid ga-exact" translate="no">
                  {firstWifi.ssid}
                </div>
                {firstWifi.password ? (
                  <div className="ga-wificard-pass">
                    <span className="ga-exact" translate="no">
                      {firstWifi.password}
                    </span>
                    <CopyButton value={firstWifi.password} label="Copy" />
                  </div>
                ) : (
                  <div className="ga-wificard-sub">No password, just join.</div>
                )}
              </>
            ) : (
              <div className="ga-wificard-sub">The network and password are on the card by the entry.</div>
            )}
          </section>

          <label className="ga-search">
            <span className="ga-sr">Search this guide</span>
            <input
              type="search"
              inputMode="search"
              placeholder="Search: towels, heat, beach"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
            />
          </label>

          {ws.length > 0 ? (
            <Results app={app} ws={ws} query={query} />
          ) : (
            <nav className="ga-grid" aria-label="Guide">
              {tiles.map((s) => (
                <a key={s.id} className="ga-tile" href={`#${s.id}`}>
                  <Icon id={s.id} />
                  <span className="ga-tile-name">{s.nav}</span>
                  <span className="ga-tile-glance">{s.glance}</span>
                </a>
              ))}
              {safety ? (
                <a className="ga-tile ga-tile-row" href="#safety">
                  <Icon id="safety" />
                  <span className="ga-tile-name">{safety.nav}</span>
                  <span className="ga-tile-glance">{safety.glance}</span>
                </a>
              ) : null}
            </nav>
          )}

          {ws.length === 0 ? (
            <section className="ga-next">
              <div className="ga-next-mark">{mark}</div>
              <h2 className="ga-h2 ga-h2-light">Come back to Cape Ann.</h2>
              <div className="ga-next-links">
                {app.bookAgainUrl ? (
                  <a className="ga-btn ga-btn-light" href={app.bookAgainUrl} target="_blank" rel="noreferrer">
                    Book this home
                  </a>
                ) : null}
                <a className="ga-btn ga-btn-ghost" href="https://staycapeann.com/stays" target="_blank" rel="noreferrer">
                  All our homes
                </a>
              </div>
              {join}
            </section>
          ) : null}

          <footer className="ga-foot">
            <p>
              Stay Cape Ann &middot;{' '}
              <a href={`mailto:${app.contact.email}`} translate="no">
                {app.contact.email}
              </a>
            </p>
            <p className="ga-foot-tip">Add this page to your home screen for the stay.</p>
          </footer>
        </main>
      </div>

      {/* PAGES: one screen per section, shown by its #id. */}
      {app.sections.map((s) => (
        <section key={s.id} id={s.id} className="ga-page" aria-labelledby={`${s.id}-h`}>
          <div className="ga-pagebar">
            <a className="ga-back" href="#" onClick={back}>
              <span aria-hidden="true">&lsaquo;</span> Guide
            </a>
            <span className="ga-pagebar-t">{app.title}</span>
          </div>
          <div className="ga-main">
            <h2 id={`${s.id}-h`} className="ga-h2 ga-page-h">
              {s.title}
            </h2>
            {s.intro ? <p className="ga-intro">{s.intro}</p> : null}

            {s.id === 'wifi' && <WifiCards app={app} wifiQr={wifiQr} />}
            {s.id === 'safety' && <SafetyCards app={app} />}

            {s.items.length > 0 && (
              <div className="ga-items">
                {s.items.map((i, idx) => (
                  <Item key={`${s.id}-${idx}`} item={i} />
                ))}
              </div>
            )}

            {s.id === 'checkout' && <p className="ga-sign">Thank you for staying with us. Travel safely.</p>}
            {s.id === 'nearby' && <Nearby places={app.nearby} />}
          </div>
        </section>
      ))}

      {/* One way to reach a person, on every screen. */}
      <div className="ga-actions" role="navigation" aria-label="Contact">
        <a className="ga-action" href={app.contact.text}>
          Text us
        </a>
      </div>
    </>
  );
}

/** Search results: the matching lines, each under the section it opens. */
function Results({ app, ws, query }: { app: GuestApp; ws: string[]; query: string }) {
  const groups: Array<{ section: GuestSection; lines: string[] }> = [];
  for (const s of app.sections) {
    const lines: string[] = [];
    const head = `${s.title} ${s.nav} ${s.intro ?? ''}`.toLowerCase();
    for (const i of s.items) if (matches(itemText(i), ws)) lines.push(i.label ? `${i.label}: ${i.text}` : i.text);
    if (s.id === 'wifi') {
      for (const n of app.wifi) if (matches(`wifi wi-fi internet password network ${n.ssid} ${n.label ?? ''}`.toLowerCase(), ws)) lines.push(`Network: ${n.ssid}`);
    }
    if (s.id === 'nearby') for (const p of app.nearby) if (matches(placeText(p), ws)) lines.push(`${p.name}, ${p.travel}`);
    if (s.id === 'safety' && matches('emergency 911 hospital doctor fire police ambulance', ws)) lines.unshift('Call 911 first, then text us.');
    if (lines.length || matches(head, ws)) groups.push({ section: s, lines: lines.slice(0, 4) });
  }
  const ask = app.contact.text.replace(/body=([^&]*)$/, (_m, b) => `body=${b}${encodeURIComponent(`Quick question: ${query.trim()}`)}`);
  if (groups.length === 0) {
    return (
      <div className="ga-empty">
        <p>Nothing in the guide for &ldquo;{query.trim()}&rdquo;.</p>
        <a className="ga-btn" href={ask}>
          Ask us instead
        </a>
      </div>
    );
  }
  return (
    <div className="ga-results">
      {groups.map(({ section, lines }) => (
        <a key={section.id} className="ga-result" href={`#${section.id}`}>
          <span className="ga-result-h">
            {section.title} <span aria-hidden="true">&rarr;</span>
          </span>
          {lines.map((l, i) => (
            <span key={i} className="ga-result-line">
              {l}
            </span>
          ))}
        </a>
      ))}
    </div>
  );
}

function Item({ item }: { item: GuestItem }) {
  const split = item.copy ? null : splitLong(item.text);
  return (
    <div className={`ga-item${item.aside ? ' is-aside' : ''}`}>
      {item.label ? <div className="ga-item-k">{item.label}</div> : null}
      <div className="ga-item-v">
        <span className={item.copy ? 'ga-exact' : undefined} translate={item.noTranslate ? 'no' : undefined}>
          {split ? split[0] : item.text}
        </span>
        {item.copy ? <CopyButton value={item.text} label="Copy" /> : null}
      </div>
      {split ? (
        <details className="ga-more">
          <summary>More</summary>
          <p>{split[1]}</p>
        </details>
      ) : null}
      {item.link ? (
        <a className="ga-link" href={item.link.href} target={item.link.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
          {item.link.label} &rarr;
        </a>
      ) : null}
    </div>
  );
}

function WifiCards({ app, wifiQr }: { app: GuestApp; wifiQr: Record<string, string> }) {
  if (app.wifi.length === 0) {
    return <p className="ga-intro">The network and password are on the card by the entry.</p>;
  }
  return (
    <div className="ga-wifi">
      {app.wifi.map((n) => (
        <div key={n.ssid} className="ga-wifi-card">
          {n.label ? <div className="ga-item-k">{n.label}</div> : null}
          <div className="ga-wifi-row">
            <span className="ga-wifi-k">Network</span>
            <span className="ga-exact ga-wifi-v" translate="no">
              {n.ssid}
            </span>
          </div>
          <div className="ga-wifi-row">
            <span className="ga-wifi-k">Password</span>
            {n.password ? (
              <>
                <span className="ga-exact ga-wifi-v" translate="no">
                  {n.password}
                </span>
                <CopyButton value={n.password} label="Copy" />
              </>
            ) : (
              <span className="ga-wifi-v">None, just join</span>
            )}
          </div>
          {wifiQr[n.ssid] ? (
            <details className="ga-wifi-qr">
              <summary>Join from another phone</summary>
              <div className="ga-wifi-qr-box" dangerouslySetInnerHTML={{ __html: wifiQr[n.ssid] }} />
              <p className="ga-aside">Point the other phone&rsquo;s camera here and tap to join.</p>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SafetyCards({ app }: { app: GuestApp }) {
  const h = app.emergency.hospital;
  return (
    <div className="ga-safety">
      <a className="ga-911" href="tel:911">
        <span className="ga-911-n">911</span>
        <span className="ga-911-t">
          Fire, police, ambulance.
          {app.emergency.address ? (
            <>
              {' '}
              Give this address: <strong translate="no">{app.emergency.address}</strong>
            </>
          ) : null}
        </span>
      </a>
      {h ? (
        <div className="ga-hospital">
          <div className="ga-item-k">Nearest emergency room</div>
          <div className="ga-hospital-name">{h.name}</div>
          <div className="ga-aside" translate="no">
            {h.address} &middot; open 24 hours
          </div>
          <div className="ga-hospital-links">
            <a className="ga-link" href={h.tel}>
              {h.phone} &rarr;
            </a>
            <a className="ga-link" href={h.directionsUrl} target="_blank" rel="noreferrer">
              Directions &rarr;
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Nearby({ places }: { places: NearbyPlace[] }) {
  return (
    <>
      <div className="ga-places">
        {places.map((p) => (
          <a key={p.name} className="ga-place" href={p.directionsUrl} target="_blank" rel="noreferrer">
            <span className="ga-place-head">
              <span className="ga-place-name">{p.name}</span>
              <span className={`ga-place-travel${p.walk ? ' is-walk' : ''}`}>{p.travel}</span>
            </span>
            {p.ourPick ? <span className="ga-pick">Our pick</span> : null}
            {p.blurb ? <span className="ga-place-blurb">{p.blurb}</span> : null}
          </a>
        ))}
      </div>
      <div className="ga-guide">
        <div className="ga-item-k">More from our Cape Ann guide</div>
        <div className="ga-guide-links">
          {GUIDE_LINKS.map((g) => (
            <a key={g.href} href={g.href} target="_blank" rel="noreferrer" className="ga-chip">
              {g.label}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ga-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Older browsers: select-and-copy through a temporary field.
          const t = document.createElement('textarea');
          t.value = value;
          document.body.appendChild(t);
          t.select();
          try {
            document.execCommand('copy');
          } catch {
            /* nothing more to try */
          }
          t.remove();
        }
        setDone(true);
        window.setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/** One line icon per section, 24px, drawn in the tile's ink. */
function Icon({ id }: { id: GuestSectionId }) {
  const paths: Record<GuestSectionId, React.ReactNode> = {
    wifi: (
      <>
        <path d="M2.5 9a14 14 0 0 1 19 0" />
        <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" />
        <path d="M8.7 15.8a5 5 0 0 1 6.6 0" />
        <circle cx="12" cy="19" r="1" />
      </>
    ),
    house: (
      <>
        <path d="M3 11l9-7 9 7" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-5h4v5" />
      </>
    ),
    checkout: (
      <>
        <path d="M14 4H6v16h8" />
        <path d="M10.5 12H21" />
        <path d="M18 9l3 3-3 3" />
      </>
    ),
    nearby: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M15.5 8.5l-2 5-5 2 2-5z" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16" />
        <path d="M9 7V4h6v3" />
        <path d="M6 7l1 13h10l1-13" />
      </>
    ),
    rules: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V3h6v1" />
        <path d="M8.5 10h7M8.5 14h7M8.5 18h4" />
      </>
    ),
    arrival: (
      <>
        <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    safety: (
      <>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
        <path d="M12 9v6M9 12h6" />
      </>
    ),
  };
  return (
    <svg className="ga-ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[id]}
    </svg>
  );
}
