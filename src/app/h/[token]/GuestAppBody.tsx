'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GuestApp, GuestItem, GuestSection } from '@/lib/guest-app';
import type { NearbyPlace } from '@/lib/guest-app-nearby';

/**
 * The guest app below the hero: quick tiles, today at the house, the
 * section chips, search, every section, and the fixed Text us bar.
 *
 * Everything renders on the server first, so the page reads in full with
 * JavaScript off or blocked. This component adds the three things that need
 * a browser: copying a password, filtering by a search, and registering the
 * offline copy (the moment the Wi-Fi drops is the moment a guest needs the
 * page that says how to fix it).
 */

type Props = {
  app: GuestApp;
  /** One join-code SVG per network, by SSID. */
  wifiQr: Record<string, string>;
  /** Mark of the Stay Cape Ann brand, server-rendered. */
  mark: React.ReactNode;
};

const GUIDE_LINKS = [
  { href: 'https://staycapeann.com/guide/beaches', label: 'Beaches' },
  { href: 'https://staycapeann.com/guide/dining', label: 'Dining' },
  { href: 'https://staycapeann.com/guide/outdoors', label: 'Outdoors' },
  { href: 'https://staycapeann.com/guide/shopping-arts', label: 'Shopping & arts' },
  { href: 'https://staycapeann.com/guide/day-trips', label: 'Day trips' },
  { href: 'https://staycapeann.com/guide/seasonal', label: 'This season' },
];

function words(q: string): string[] {
  return q.toLowerCase().split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

function itemText(i: GuestItem): string {
  return `${i.label ?? ''} ${i.text}`.toLowerCase();
}

function matches(text: string, ws: string[]): boolean {
  return ws.every((w) => text.includes(w));
}

export function GuestAppBody({ app, wifiQr, mark }: Props) {
  const [query, setQuery] = useState('');
  const ws = useMemo(() => words(query), [query]);

  // The offline copy. Scoped to /h/ so it never touches Helm's own pages.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/h/sw.js', { scope: '/h/' }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (ws.length === 0) return app.sections.map((s) => ({ section: s, items: s.items, whole: true }));
    const out: Array<{ section: GuestSection; items: GuestItem[]; whole: boolean }> = [];
    for (const s of app.sections) {
      const head = `${s.title} ${s.nav} ${s.intro ?? ''}`.toLowerCase();
      if (matches(head, ws)) {
        out.push({ section: s, items: s.items, whole: true });
        continue;
      }
      const items = s.items.filter((i) => matches(itemText(i), ws));
      const extra =
        (s.id === 'wifi' && app.wifi.some((n) => matches(`wifi wi-fi internet password network ${n.ssid} ${n.label ?? ''}`.toLowerCase(), ws))) ||
        (s.id === 'nearby' && app.nearby.some((p) => matches(`${p.name} ${p.town} ${p.category} ${p.blurb}`.toLowerCase(), ws))) ||
        (s.id === 'safety' && matches('emergency 911 hospital doctor fire police ambulance', ws));
      if (items.length || extra) out.push({ section: s, items, whole: false });
    }
    return out;
  }, [app, ws]);

  const askHref = app.contact.text.replace(/body=([^&]*)$/, (_m, b) => `body=${b}${encodeURIComponent(query.trim() ? `Quick question: ${query.trim()}` : '')}`);

  const firstWifi = app.wifi[0] ?? null;
  const trashToday = app.today.find((t) => t.kind === 'trash') ?? null;
  const urgentTrash = trashToday && (trashToday.title === 'Trash night' || trashToday.title === 'Pickup day');

  return (
    <>
      {/* QUICK TILES: the four things asked most, one tap each. */}
      <section className="ga-quick" aria-label="At a glance">
        <div className="ga-tile ga-tile-wifi">
          <a className="ga-tile-k ga-tile-k-link" href="#wifi">
            Wi-Fi{app.wifi.length > 1 ? ` · ${app.wifi.length} networks` : ''}
          </a>
          {firstWifi ? (
            <>
              <span className="ga-tile-v ga-mono" translate="no">{firstWifi.ssid}</span>
              {firstWifi.password ? (
                <span className="ga-tile-pass">
                  <span className="ga-mono" translate="no">{firstWifi.password}</span>
                  <CopyButton value={firstWifi.password} label="Copy" />
                </span>
              ) : (
                <span className="ga-tile-sub">No password, just join</span>
              )}
            </>
          ) : (
            <span className="ga-tile-sub">See the card by the entry, or text us.</span>
          )}
        </div>

        <a className="ga-tile" href="#checkout">
          <span className="ga-tile-k">Checkout</span>
          <span className="ga-tile-v">{app.checkOut ?? 'See below'}</span>
          <span className="ga-tile-sub">No chores required</span>
        </a>

        {app.trashDay && trashToday ? (
          <a className={`ga-tile${urgentTrash ? ' ga-tile-alert' : ''}`} href="#trash">
            <span className="ga-tile-k">{trashToday.title}</span>
            <span className="ga-tile-v">{app.trashDay}</span>
            <span className="ga-tile-sub">{urgentTrash ? 'Tap for what to do' : 'Carts out the night before'}</span>
          </a>
        ) : app.checkIn ? (
          <a className="ga-tile" href="#arrival">
            <span className="ga-tile-k">Check-in</span>
            <span className="ga-tile-v">{app.checkIn}</span>
            <span className="ga-tile-sub">Getting here</span>
          </a>
        ) : (
          <a className="ga-tile" href="#rules">
            <span className="ga-tile-k">House rules</span>
            <span className="ga-tile-v">Quick read</span>
            <span className="ga-tile-sub">Quiet hours and more</span>
          </a>
        )}

        <a className="ga-tile ga-tile-help" href={app.contact.text}>
          <span className="ga-tile-k">Need anything?</span>
          <span className="ga-tile-v">Text us</span>
          <span className="ga-tile-sub ga-mono" translate="no">{app.contact.phoneDisplay}</span>
        </a>
      </section>

      {/* TODAY AT THE HOUSE: date-aware, Eastern time. */}
      {app.today.length > 0 && (
        <section className="ga-today" aria-label="Today at the house">
          {app.today.map((t) => (
            <div key={t.kind} className={`ga-today-line${t.kind === 'trash' && urgentTrash ? ' is-alert' : ''}`}>
              <span className="ga-today-k">{t.title}</span>
              <span className="ga-today-v">{t.text}</span>
            </div>
          ))}
        </section>
      )}

      {/* CHIPS + SEARCH */}
      <div className="ga-bar">
        <nav className="ga-chips" aria-label="Sections">
          {app.sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="ga-chip">
              {s.nav}
            </a>
          ))}
        </nav>
        <label className="ga-search">
          <span className="ga-sr">Search this guide</span>
          <input
            type="search"
            inputMode="search"
            placeholder="Search: towels, heat, beach, TV"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
          />
        </label>
      </div>

      {ws.length > 0 && filtered.length === 0 && (
        <div className="ga-empty">
          <p>Nothing here for &ldquo;{query.trim()}&rdquo;.</p>
          <a className="ga-btn" href={askHref}>Text us your question</a>
        </div>
      )}

      {filtered.map(({ section, items, whole }) => (
        <section key={section.id} id={section.id} className="ga-section">
          <h2 className="ga-h2">{section.title}</h2>
          {section.intro && (whole || ws.length === 0) ? <p className="ga-intro">{section.intro}</p> : null}

          {section.id === 'wifi' && <WifiCards app={app} wifiQr={wifiQr} />}
          {section.id === 'safety' && <SafetyCards app={app} />}

          {items.length > 0 && (
            <div className="ga-items">
              {items.map((i, idx) => (
                <Item key={`${section.id}-${idx}`} item={i} />
              ))}
            </div>
          )}

          {section.id === 'checkout' && (whole || ws.length === 0) && (
            <p className="ga-sign">Thank you for staying with us. Travel safely.</p>
          )}

          {section.id === 'nearby' && <Nearby places={app.nearby} ws={ws} />}
        </section>
      ))}

      {/* NEXT STAY + FOOTER */}
      {ws.length === 0 && (
        <section className="ga-next">
          <div className="ga-next-mark">{mark}</div>
          <h2 className="ga-h2 ga-h2-light">Come back to Cape Ann.</h2>
          <p>Book your next stay direct with us on staycapeann.com.</p>
          <div className="ga-next-links">
            {app.bookAgainUrl ? (
              <a className="ga-btn ga-btn-light" href={app.bookAgainUrl} target="_blank" rel="noreferrer">
                This home
              </a>
            ) : null}
            <a className="ga-btn ga-btn-ghost" href="https://staycapeann.com/stays" target="_blank" rel="noreferrer">
              Browse the homes
            </a>
          </div>
          <a className="ga-next-quiet" href="https://staycapeann.com/contact" target="_blank" rel="noreferrer">
            Join the list for first word on openings
          </a>
        </section>
      )}

      <footer className="ga-foot">
        <p>
          Stay Cape Ann &middot; {app.title}
          {app.address ? (
            <>
              {' '}&middot; <span translate="no">{app.address}</span>
            </>
          ) : null}
        </p>
        <p>
          Questions any time: text{' '}
          <a href={app.contact.text} translate="no">
            {app.contact.phoneDisplay}
          </a>{' '}
          or email{' '}
          <a href={`mailto:${app.contact.email}`} translate="no">
            {app.contact.email}
          </a>
          .
        </p>
        <p className="ga-foot-tip">Tip: add this page to your home screen to keep it handy for the stay.</p>
      </footer>

      {/* FIXED ACTIONS: a person is always one tap away. */}
      <div className="ga-actions" role="navigation" aria-label="Contact">
        <a className="ga-action ga-action-primary" href={app.contact.text}>
          Text us
        </a>
        <a className="ga-action" href={app.contact.report}>
          Something&rsquo;s wrong
        </a>
      </div>
    </>
  );
}

function Item({ item }: { item: GuestItem }) {
  return (
    <div className={`ga-item${item.aside ? ' is-aside' : ''}`}>
      {item.label ? <div className="ga-item-k">{item.label}</div> : null}
      <div className="ga-item-v">
        <span className={item.copy ? 'ga-mono' : undefined} translate={item.noTranslate ? 'no' : undefined}>
          {item.text}
        </span>
        {item.copy ? <CopyButton value={item.text} label="Copy" /> : null}
      </div>
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
    return <p className="ga-intro">The network and password are on the card by the entry. Text us if you cannot find it.</p>;
  }
  return (
    <div className="ga-wifi">
      {app.wifi.map((n) => (
        <div key={n.ssid} className="ga-wifi-card">
          {n.label ? <div className="ga-item-k">{n.label}</div> : null}
          <div className="ga-wifi-row">
            <span className="ga-wifi-k">Network</span>
            <span className="ga-mono ga-wifi-v" translate="no">{n.ssid}</span>
          </div>
          <div className="ga-wifi-row">
            <span className="ga-wifi-k">Password</span>
            {n.password ? (
              <>
                <span className="ga-mono ga-wifi-v" translate="no">{n.password}</span>
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
              <p className="ga-aside">Point the other phone&rsquo;s camera at this code and tap to join.</p>
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
              {' '}The address to give: <strong translate="no">{app.emergency.address}</strong>
            </>
          ) : null}
        </span>
      </a>
      {h ? (
        <div className="ga-hospital">
          <div className="ga-item-k">Nearest emergency room</div>
          <div className="ga-hospital-name">{h.name}</div>
          <div className="ga-aside" translate="no">{h.address}</div>
          <div className="ga-aside">{h.note}</div>
          <div className="ga-hospital-links">
            <a className="ga-link" href={h.tel}>{h.phone} &rarr;</a>
            <a className="ga-link" href={h.directionsUrl} target="_blank" rel="noreferrer">Directions &rarr;</a>
          </div>
        </div>
      ) : null}
      <a className="ga-urgent" href={app.contact.report}>
        <strong>Something urgent at the house?</strong> No heat, water where it should not be, a lock that will not open: text us. An urgent text reaches our team day or night.
      </a>
    </div>
  );
}

function Nearby({ places, ws }: { places: NearbyPlace[]; ws: string[] }) {
  const shown = ws.length ? places.filter((p) => matches(`${p.name} ${p.town} ${p.category} ${p.blurb}`.toLowerCase(), ws)) : places;
  return (
    <>
      <div className="ga-places">
        {shown.map((p) => (
          <div key={p.name} className="ga-place">
            <div className="ga-place-head">
              <span className="ga-place-name">{p.name}</span>
              <span className={`ga-place-travel${p.walk ? ' is-walk' : ''}`}>{p.travel}</span>
            </div>
            <div className="ga-place-meta">
              {p.ourPick ? <span className="ga-pick">Our pick</span> : null}
              <span>{p.town}</span>
            </div>
            {p.blurb ? <p className="ga-place-blurb">{p.blurb}</p> : null}
            <a className="ga-link" href={p.directionsUrl} target="_blank" rel="noreferrer">
              Directions &rarr;
            </a>
          </div>
        ))}
      </div>
      {ws.length === 0 && (
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
      )}
    </>
  );
}

function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`ga-copy${className ? ` ${className}` : ''}`}
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
