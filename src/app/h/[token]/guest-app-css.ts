/**
 * The guest app's styles. Stay Cape Ann's palette (staycapeann.com's
 * tailwind.config.ts: ink navy, cream paper, driftwood, seaglass, the
 * sunset accent kept for the one thing that is urgent), Fraunces for
 * display and Inter for reading. Phone first: one 600px column, big tap
 * targets, a fixed Text us button clear of the iPhone home indicator.
 * Scoped under .ga so nothing leaks into Helm.
 *
 * Home and pages: every section is a .ga-page, hidden until its #id is the
 * URL's fragment (:target). While one is open, :has hides the home screen,
 * so a tile tap reads as a new screen and Back returns to the tiles. No
 * JavaScript decides what shows.
 */
export const guestAppCss = `
.ga {
  --ink: #0F2A44;
  --ink-2: #2B4C6F;
  --ink-3: #476B8E;
  --paper: #FCFAF5;
  --cream: #F3EFE4;
  --cream-2: #EDE6D3;
  --drift: #B89B6E;
  --drift-deep: #7A6340;
  --sea: #6E8B85;
  --rule: rgba(15, 42, 68, 0.12);
  --alert: #A8452B;
  --alert-bg: #F8E9E2;
  --serif: var(--font-fraunces), 'Fraunces', Georgia, serif;
  --sans: var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif;
  --mono: var(--font-mono-dash), 'JetBrains Mono', ui-monospace, Menlo, monospace;
  background: var(--cream);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.5;
  min-height: 100vh;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
.ga *, .ga *::before, .ga *::after { box-sizing: border-box; }
/* :where keeps this at class weight, so every .ga-btn and .ga-action colour wins. */
.ga :where(a) { color: inherit; }
.ga-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ga-mono { font-family: var(--mono); font-size: 0.94em; letter-spacing: 0; word-break: break-all; }

/* Home and pages */
.ga-page { display: none; }
.ga-page:target { display: block; }
.ga:has(.ga-page:target) .ga-home { display: none; }

/* Hero */
.ga-hero { position: relative; background: var(--ink); color: var(--paper); display: flex; align-items: flex-end; overflow: hidden; }
.ga-hero.has-photo { min-height: min(40vh, 320px); }
.ga-hero-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ga-hero.has-photo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,30,50,0.10) 0%, rgba(10,30,50,0.25) 45%, rgba(10,30,50,0.82) 100%); }
.ga-hero-inner { position: relative; z-index: 1; width: 100%; max-width: 600px; margin: 0 auto; padding: calc(22px + env(safe-area-inset-top)) 20px 22px; }
.ga-brand { display: flex; align-items: center; gap: 9px; font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; margin-bottom: 14px; }
.ga-h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(30px, 8.4vw, 44px); line-height: 1.05; letter-spacing: -0.02em; margin: 0; }
.ga-hero-addr { margin: 8px 0 0; font-size: 13.5px; opacity: 0.86; }

.ga-main { max-width: 600px; margin: 0 auto; padding: 0 16px calc(96px + env(safe-area-inset-bottom)); }

/* Welcome */
.ga-welcome { padding: 22px 4px 4px; }
.ga-display { font-family: var(--serif); font-weight: 400; font-size: 27px; line-height: 1.1; letter-spacing: -0.015em; margin: 0 0 6px; }
.ga-display em { font-style: italic; color: var(--drift-deep); }
.ga-welcome-text { margin: 0; color: var(--ink-2); font-size: 15.5px; }

/* Wi-Fi card */
.ga-wificard { margin: 16px 0 10px; background: var(--paper); border: 1px solid var(--rule); border-radius: 16px; padding: 12px 16px 14px; }
.ga-wificard-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
.ga-wificard-k { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; color: var(--drift-deep); }
.ga-wificard-k .ga-ico { width: 18px; height: 18px; }
.ga-wificard-more { font-size: 13px; font-weight: 600; color: var(--ink-3); text-decoration: none; padding: 4px 0; }
.ga-wificard-ssid { font-size: 17px; overflow-wrap: anywhere; }
.ga-wificard-pass { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--rule); font-size: 17px; }
.ga-wificard-sub { font-size: 14px; color: var(--ink-3); }

/* Today: one or two chips, never a paragraph */
.ga-today { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
.ga-today-chip { display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 999px; background: var(--paper); border: 1px solid var(--rule); font-size: 13px; font-weight: 500; color: var(--ink-2); text-decoration: none; }
.ga-today-chip.is-alert { background: var(--alert-bg); border-color: rgba(168,69,43,0.35); color: var(--alert); font-weight: 600; }

/* Search */
.ga-search { display: block; margin: 0 0 12px; }
.ga-search input { width: 100%; font: inherit; font-size: 16px; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); outline: none; -webkit-appearance: none; appearance: none; }
.ga-search input:focus { border-color: var(--ink-3); box-shadow: 0 0 0 3px rgba(71,107,142,0.15); }

/* Tiles: the guide's table of contents */
.ga-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ga-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; min-height: 108px; padding: 14px 14px 13px; background: var(--paper); border: 1px solid var(--rule); border-radius: 16px; text-decoration: none; }
.ga-tile:active { background: var(--cream-2); }
.ga-tile .ga-ico { color: var(--drift-deep); margin-bottom: auto; }
.ga-tile-name { font-family: var(--serif); font-size: 19px; line-height: 1.15; letter-spacing: -0.01em; margin-top: 12px; }
.ga-tile-glance { font-size: 13px; color: var(--ink-3); line-height: 1.35; overflow-wrap: anywhere; }
/* An odd tile out takes the whole row rather than sitting alone. */
.ga-grid > .ga-tile:not(.ga-tile-row):nth-last-child(2):nth-child(odd) { grid-column: 1 / -1; }
.ga-tile-row { grid-column: 1 / -1; min-height: 0; display: grid; grid-template-columns: auto 1fr; column-gap: 12px; align-items: center; padding: 13px 14px; border-left: 3px solid var(--alert); }
.ga-tile-row .ga-ico { color: var(--alert); margin: 0; grid-row: span 2; }
.ga-tile-row .ga-tile-name { margin: 0; font-size: 17px; }

/* Search results */
.ga-results { display: grid; gap: 10px; }
.ga-result { display: grid; gap: 4px; background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 12px 14px; text-decoration: none; }
.ga-result-h { font-family: var(--serif); font-size: 18px; }
.ga-result-line { font-size: 14px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ga-empty { text-align: center; padding: 20px 0 6px; color: var(--ink-2); }
.ga-empty p { margin: 0 0 14px; }

/* Page bar: Back, and the home's name */
.ga-pagebar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px; padding: calc(10px + env(safe-area-inset-top)) 16px 10px; background: rgba(15,42,68,0.97); color: var(--paper); }
.ga-back { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 14px 0 10px; border-radius: 999px; border: 1px solid rgba(252,250,245,0.35); font-size: 14px; font-weight: 600; text-decoration: none; flex: 0 0 auto; }
.ga-back span { font-size: 22px; line-height: 1; margin-top: -2px; }
.ga-pagebar-t { font-family: var(--serif); font-size: 15px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ga-h2.ga-page-h { margin-top: 24px; }

/* Sections */
.ga-h2 { font-family: var(--serif); font-weight: 400; font-size: 26px; letter-spacing: -0.015em; line-height: 1.15; margin: 0 0 6px; }
.ga-intro { margin: 0 0 14px; color: var(--ink-2); }
.ga-items { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 2px 16px; }
.ga-item { padding: 12px 0; border-top: 1px solid var(--rule); }
.ga-item:first-child { border-top: 0; }
.ga-item-k { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; color: var(--drift-deep); margin-bottom: 3px; }
.ga-item-v { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ga-item.is-aside .ga-item-v, .ga-item.is-aside .ga-more p { font-size: 14px; color: var(--ink-3); }
.ga-more summary { display: inline-block; margin-top: 4px; font-size: 13px; font-weight: 600; color: var(--ink-3); cursor: pointer; list-style: none; padding: 2px 0; }
.ga-more summary::-webkit-details-marker { display: none; }
.ga-more summary::after { content: ' +'; }
.ga-more[open] summary { display: none; }
.ga-more p { margin: 4px 0 0; }
.ga-link { display: inline-block; margin-top: 6px; font-size: 14px; font-weight: 600; color: var(--ink-2); text-decoration: none; padding: 4px 0; }
.ga-aside { font-size: 14px; color: var(--ink-3); margin: 4px 0 0; }
.ga-sign { font-family: var(--serif); font-style: italic; color: var(--drift-deep); margin: 14px 2px 0; font-size: 17px; }

.ga-copy { flex: 0 0 auto; font: inherit; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); background: var(--cream); border: 1px solid var(--rule); border-radius: 999px; padding: 6px 12px; cursor: pointer; min-height: 34px; }
.ga-copy:active { transform: translateY(1px); }

/* Wi-Fi page */
.ga-wifi { display: grid; gap: 10px; margin-bottom: 12px; }
.ga-wifi-card { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 14px 16px; }
/* The label sits over the value, so a long password keeps the full width
   and never breaks beside a label column. */
.ga-wifi-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 2px; align-items: center; padding: 7px 0; }
.ga-wifi-k { grid-column: 1 / -1; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; color: var(--ink-3); }
.ga-wifi-v { font-size: 18px; overflow-wrap: anywhere; }
.ga-wifi-qr { margin-top: 8px; border-top: 1px dashed var(--rule); padding-top: 10px; }
.ga-wifi-qr summary { cursor: pointer; font-size: 14px; font-weight: 600; color: var(--ink-2); list-style: none; }
.ga-wifi-qr summary::-webkit-details-marker { display: none; }
.ga-wifi-qr summary::after { content: ' +'; }
.ga-wifi-qr[open] summary::after { content: ' \\2212'; }
.ga-wifi-qr-box { width: 180px; height: 180px; margin: 14px auto 6px; background: var(--paper); }
.ga-wifi-qr-box svg { width: 100%; height: 100%; display: block; }
.ga-wifi-qr .ga-aside { text-align: center; }

/* Safety */
.ga-safety { display: grid; gap: 10px; margin-bottom: 12px; }
.ga-911 { display: flex; align-items: center; gap: 16px; background: var(--alert); color: #fff; border-radius: 14px; padding: 16px; text-decoration: none; }
.ga-911-n { font-family: var(--serif); font-size: 40px; line-height: 1; letter-spacing: -0.02em; }
.ga-911-t { font-size: 14px; line-height: 1.45; }
.ga-911-t strong { font-weight: 600; }
.ga-hospital { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 14px 16px; }
.ga-hospital-name { font-family: var(--serif); font-size: 20px; }
.ga-hospital-links { display: flex; gap: 18px; flex-wrap: wrap; }

/* Nearby: each card opens directions */
.ga-places { display: grid; gap: 10px; }
.ga-place { display: grid; gap: 4px; justify-items: start; background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 12px 14px; text-decoration: none; }
.ga-place:active { background: var(--cream-2); }
.ga-place-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; width: 100%; }
.ga-place-name { font-family: var(--serif); font-size: 18px; line-height: 1.25; }
.ga-place-travel { flex: 0 0 auto; font-size: 13px; font-weight: 600; color: var(--ink-3); }
.ga-place-travel.is-walk { color: var(--sea); }
.ga-place-travel::after { content: ' \\2192'; }
.ga-pick { background: var(--ink); color: var(--paper); border-radius: 999px; padding: 2px 8px; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
.ga-place-blurb { font-size: 14px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ga-guide { margin-top: 16px; }
.ga-guide-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.ga-chip { display: inline-block; padding: 7px 13px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); font-size: 13px; font-weight: 500; text-decoration: none; white-space: nowrap; }

/* Buttons */
.ga-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 0 20px; border-radius: 999px; background: var(--ink); color: var(--paper); text-decoration: none; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
.ga-btn-light { background: var(--paper); color: var(--ink); }
.ga-btn-ghost { background: transparent; color: var(--paper); border: 1px solid rgba(252,250,245,0.45); }

/* Next stay */
.ga-next { margin: 28px -16px 0; padding: 28px 20px 26px; background: var(--ink); color: var(--paper); text-align: center; }
.ga-next-mark { display: flex; justify-content: center; margin-bottom: 12px; }
.ga-h2-light { color: var(--paper); margin-bottom: 16px; }
.ga-next-links { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

/* Footer */
.ga-foot { padding: 18px 0 0; font-size: 13px; color: var(--ink-3); text-align: center; }
.ga-foot p { margin: 0 0 4px; }
.ga-foot a { color: var(--ink-2); }
.ga-foot-tip { font-size: 12px; opacity: 0.85; }

/* Fixed action: one way to a person */
.ga-actions { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: flex; justify-content: center; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); background: rgba(243,239,228,0.94); -webkit-backdrop-filter: saturate(1.4) blur(10px); backdrop-filter: saturate(1.4) blur(10px); border-top: 1px solid var(--rule); }
.ga-action { flex: 1 1 auto; max-width: 420px; display: inline-flex; align-items: center; justify-content: center; min-height: 50px; padding: 0 16px; border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; white-space: nowrap; text-transform: uppercase; background: var(--ink); color: var(--paper); }

/* Inactive link */
.ga-inactive { padding-top: calc(80px + env(safe-area-inset-top)); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.ga-inactive .ga-display { margin-top: 10px; }

/* Your stay (the stay link, /h/s/<token>, inside its window) */
.ga-stay { margin: 16px 0 6px; background: var(--paper); border: 1px solid var(--rule); border-top: 3px solid var(--ink); border-radius: 14px; padding: 16px 16px 6px; }
.ga-stay .ga-h2 { margin-bottom: 10px; }
.ga-stay-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
.ga-stay-date { background: var(--cream); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.ga-stay-date-v { font-family: var(--serif); font-size: 18px; line-height: 1.2; }
.ga-stay-date-t { font-size: 13px; color: var(--ink-3); }
.ga-code { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 14px 0; margin-bottom: 4px; display: grid; gap: 8px; justify-items: start; }
.ga-code-v { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ga-code-digits { font-family: var(--mono); font-size: 40px; line-height: 1; letter-spacing: 0.16em; color: var(--ink); }
.ga-code button.ga-btn { border: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
.ga-code button.ga-btn[disabled] { opacity: 0.7; cursor: wait; }
.ga-code-err { margin: 0; font-size: 14px; color: var(--alert); }
.ga-stay .ga-items { background: transparent; border: 0; padding: 0; border-radius: 0; }
.ga-stay-until { margin: 6px 0 10px; font-size: 13px; color: var(--ink-3); }
.ga-stay-later { margin: 16px 0 6px; background: var(--paper); border: 1px solid var(--rule); border-left: 3px solid var(--drift); border-radius: 14px; padding: 13px 16px; font-size: 15px; color: var(--ink-2); }

@media (min-width: 640px) {
  .ga-grid { grid-template-columns: repeat(3, 1fr); }
  .ga-grid > .ga-tile:not(.ga-tile-row):nth-last-child(2):nth-child(odd) { grid-column: auto; }
}
`;
