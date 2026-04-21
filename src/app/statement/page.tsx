import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const PROPERTY_DETAILS: Record<string, { name: string; address: string; city: string; owner_full: string; fee_pct: number; listing_match: string }> = {
  '3_south_st':    { name: '3 South St',        address: '3 South Street',       city: 'Rockport, MA',    owner_full: 'Marci & Paul Bailey', fee_pct: 25, listing_match: '3 south' },
  '21_horton':     { name: '21 Horton St',       address: '21 Horton Street',     city: 'Gloucester, MA',  owner_full: 'Claudia Kittredge', fee_pct: 22, listing_match: '21 horton' },
  '53_rocky_neck': { name: '53 Rocky Neck Ave',  address: '53 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'Mark Prudenzi', fee_pct: 25, listing_match: '53 rocky neck' },
  '4_brier_neck':  { name: '4 Brier Neck Rd',    address: '4 Brier Neck Road',    city: 'Gloucester, MA',  owner_full: 'The Armstrong Family', fee_pct: 20, listing_match: '4 brier neck' },
  '30_woodward':   { name: '30 Woodward Ave',    address: '30 Woodward Avenue',   city: 'Gloucester, MA',  owner_full: 'The McWethy Family', fee_pct: 25, listing_match: '30 woodward' },
  '20_hammond':    { name: '20 Hammond St',      address: '20 Hammond Street',    city: 'Gloucester, MA',  owner_full: 'The Ramsey Family', fee_pct: 25, listing_match: '20 hammond' },
  '20_enon':       { name: '20 Enon Rd',         address: '20 Enon Road',         city: 'Gloucester, MA',  owner_full: 'The Snyder Family', fee_pct: 25, listing_match: '20 enon' },
  '73_rocky_neck': { name: '73 Rocky Neck Ave',  address: '73 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'The Moynahan Family', fee_pct: 25, listing_match: '73 rocky neck' },
  '17_beach_rd':   { name: '17 Beach Rd',        address: '17 Beach Road',        city: 'Gloucester, MA',  owner_full: 'The Nolan Family', fee_pct: 22, listing_match: '17 beach' },
  '65_calderwood': { name: '65 Calderwood Ln',   address: '65 Calderwood Lane',   city: 'Fairfield, CT',   owner_full: 'The Liu Family', fee_pct: 25, listing_match: '65 calderwood' },
  '3_locust':      { name: '3 Locust St',        address: '3 Locust Street',      city: 'Gloucester, MA',  owner_full: 'The Lucas Family', fee_pct: 25, listing_match: '3 locust' },
  '3246_ne_27th':  { name: '3246 NE 27th Ave',   address: '3246 NE 27th Avenue',  city: 'Lighthouse Point, FL', owner_full: 'The Enriquez Family', fee_pct: 25, listing_match: '3246 ne 27th' },
};

// ---- helpers ----
function fmt(n: number) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function shortDate(d: string) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function monthName(m: string) { return new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long' }); }
function daysInMonth(m: string) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
function chLabel(p: string) { return ({ HomeAway: 'VRBO', Manual: 'Direct', 'Booking.com': 'Booking' } as Record<string, string>)[p] || p; }

function parseCSVLine(line: string): string[] {
  const fields: string[] = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur); return fields;
}

function parseCSV(text: string, propertyId: string, month: string) {
  const details = PROPERTY_DETAILS[propertyId];
  if (!details) return { reviews: [] as { guest: string; review: string }[], upcoming: [] as { guest: string; checkIn: string; nights: number; platform: string }[] };

  const lines = text.split('\n');
  const reviews: { guest: string; review: string }[] = [];
  const upcoming: { guest: string; checkIn: string; nights: number; platform: string }[] = [];
  const [yr, mo] = month.split('-');
  const lastDay = daysInMonth(month);
  const monthEnd = `${yr}-${mo}-${String(lastDay).padStart(2, '0')}`;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = parseCSVLine(line);
    if (f.length < 7) continue;

    const listing = f[3].toLowerCase();
    if (!listing.includes(details.listing_match)) continue;

    const checkIn = f[0].split(' ')[0];
    const checkOut = f[1].split(' ')[0];
    const guest = f[4];
    const platform = f[5];
    const review = f[6].trim();

    // Reviews: past stays with review text
    if (review && review !== ' ' && review.length > 15) {
      reviews.push({ guest, review });
    }

    // Upcoming: check-in after this month
    if (checkIn > monthEnd) {
      const d1 = new Date(checkIn + 'T00:00:00');
      const d2 = new Date(checkOut + 'T00:00:00');
      const nights = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      upcoming.push({ guest, checkIn, nights, platform });
    }
  }

  return {
    reviews,
    upcoming: upcoming.sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 4),
  };
}

function getBestReview(reviews: { guest: string; review: string }[]): { guest: string; snippet: string } | null {
  if (!reviews.length) return null;
  const best = [...reviews].sort((a, b) => b.review.length - a.review.length)[0];
  let snippet = best.review;
  if (snippet.length > 180) {
    const sentences = snippet.split(/(?<=[.!])/).filter(s => s.trim().length > 15);
    snippet = sentences.length > 0 ? sentences[0].trim() : snippet.substring(0, 177) + '...';
    if (snippet.length > 180) snippet = snippet.substring(0, 177) + '...';
  }
  return { guest: best.guest, snippet };
}

// ---- page ----
export default async function StatementPage({ searchParams }: { searchParams: Promise<{ id?: string; month?: string; csv?: string }> }) {
  const params = await searchParams;
  const { id, month, csv: csvB64 } = params;

  if (!id || !month) {
    return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Missing ?id=...&amp;month=YYYY-MM</div>;
  }

  const { data: prop } = await supabase.from('property_statements').select('*').eq('id', id).single();
  if (!prop) return <div style={{ padding: 40 }}>Not found</div>;

  const { data: reservations } = await supabase.from('reservations').select('*').eq('property_statement_id', id).order('check_out');
  const { data: cleaningEvents } = await supabase.from('cleaning_events').select('*').eq('property_statement_id', id);

  // Reviews from Guesty (populated via /api/sync-reviews). Query all for this property
  // so we can fall back to lifetime averages when the statement month has none.
  const { data: allReviews } = await supabase
    .from('reviews')
    .select('overall_rating, public_review, guest_name, review_created_at')
    .eq('property_id', prop.property_id)
    .order('review_created_at', { ascending: false });

  const d = PROPERTY_DETAILS[prop.property_id] || { name: prop.property_name, address: prop.property_name, city: 'Gloucester, MA', owner_full: prop.owner_name || 'Owner', fee_pct: 25, listing_match: '' };
  const numStays = prop.num_stays || (reservations?.length || 0);
  const nightsBooked = prop.nights_booked || 0;
  const totalDays = daysInMonth(month);
  const occupancy = totalDays > 0 ? Math.round((nightsBooked / totalDays) * 100) : 0;
  const adr = nightsBooked > 0 ? prop.rental_revenue / nightsBooked : 0;
  const [yr, moStr] = month.split('-');
  const mo = monthName(month);
  const cleans = cleaningEvents?.length || numStays;

  // CSV data (still drives "On the horizon" upcoming bookings)
  let csvText = '';
  if (csvB64) { try { csvText = Buffer.from(csvB64, 'base64').toString('utf-8'); } catch {} }
  const csvData = csvText ? parseCSV(csvText, prop.property_id, month) : { reviews: [], upcoming: [] };

  // Compute Guest Rating from real Guesty data. Prefer month-scoped, fall back to lifetime.
  const monthStart = `${month}-01T00:00:00Z`;
  const monthEndIso = new Date(Date.UTC(parseInt(yr), parseInt(moStr), 1)).toISOString();
  const reviewsList = allReviews || [];
  const monthReviews = reviewsList.filter(r => {
    const t = r.review_created_at;
    return t >= monthStart && t < monthEndIso && r.overall_rating != null;
  });
  const ratedLifetime = reviewsList.filter(r => r.overall_rating != null);
  const avg = (arr: { overall_rating: number | null }[]) =>
    arr.length ? arr.reduce((s, r) => s + (r.overall_rating ?? 0), 0) / arr.length : null;
  const rating = monthReviews.length > 0
    ? { value: avg(monthReviews)!, count: monthReviews.length, scope: 'month' as const }
    : ratedLifetime.length > 0
    ? { value: avg(ratedLifetime)!, count: ratedLifetime.length, scope: 'lifetime' as const }
    : null;

  // Best review snippet: prefer Supabase (real reviews), fall back to CSV.
  const supabaseReviewPool = (monthReviews.length > 0 ? monthReviews : reviewsList)
    .filter(r => r.public_review && r.public_review.trim().length > 15);
  const bestSupabaseReview = supabaseReviewPool.length > 0
    ? getBestReview(supabaseReviewPool.map(r => ({ guest: r.guest_name || 'Guest', review: r.public_review! })))
    : null;
  const bestReview = bestSupabaseReview || getBestReview(csvData.reviews);

  // Channel mix
  const chRev: Record<string, number> = {};
  (reservations || []).forEach(r => { const c = chLabel(r.platform); chRev[c] = (chRev[c] || 0) + (r.adjusted_revenue || r.rental_income || 0); });
  const totRev = Object.values(chRev).reduce((a, b) => a + b, 0);
  const mix = Object.entries(chRev).map(([c, v]) => ({ ch: c, pct: totRev > 0 ? (v / totRev) * 100 : 0 })).sort((a, b) => b.pct - a.pct);

  const chColors: Record<string, string> = { Airbnb: '#ff5a5f', VRBO: '#245abc', Booking: '#003580', Direct: '#4a6b3a' };

  // Donut arcs
  let offset = 25;
  const arcs = mix.map(m => { const a = { ...m, da: `${m.pct} ${100 - m.pct}`, off: offset }; offset -= m.pct; return a; });

  // Reservation rows
  const rows = (reservations || []).map(r => {
    const d1 = new Date(r.check_in + 'T00:00:00'), d2 = new Date(r.check_out + 'T00:00:00');
    const nts = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    return { ...r, nts, perNt: nts > 0 ? Math.round((r.adjusted_revenue || r.rental_income) / nts) : 0 };
  });

  // Issue date
  const nxMo = parseInt(moStr) === 12 ? 1 : parseInt(moStr) + 1;
  const nxYr = parseInt(moStr) === 12 ? parseInt(yr) + 1 : parseInt(yr);
  const issued = new Date(nxYr, nxMo - 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Owner Statement - {d.name} - {mo} {yr}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body data-variant="editorial">
        <div className="canvas">
          <main className="sheet">

            {/* ── MASTHEAD ── */}
            <header className="masthead">
              <div className="mast-left"><b>Rising Tide</b> &middot; Vacation Rentals</div>
              <div className="mast-center">Owner Statement &middot; No. {moStr} / {yr}</div>
              <div className="mast-right">85 Eastern Ave &middot; Gloucester, MA 01930<br />allie@risingtidestr.com</div>
            </header>

            {/* ── HEADER: logo + headline ── */}
            <section className="header-row">
              <div className="logo-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/rising-tide-logo.png" alt="Rising Tide" />
              </div>
              <div className="headline-block">
                <div className="kicker">{mo} &middot; {yr}</div>
                <h1 className="display">{mo} <em>Statement</em></h1>
                <div className="display-sub">{d.address.toUpperCase()} &middot; {d.city.toUpperCase()}</div>
              </div>
            </section>

            {/* ── ADDRESSEE ── */}
            <section className="addressee">
              <div className="cell">
                <div className="label">Prepared for</div>
                <div className="val">{d.owner_full}</div>
                <div className="sub">{d.address} &middot; {d.city}</div>
              </div>
              <div className="cell">
                <div className="label">Period</div>
                <div className="val">{mo.substring(0, 3)} 1 &mdash; {mo.substring(0, 3)} {totalDays}, {yr}</div>
                <div className="sub">{totalDays} days &middot; {nightsBooked} nights booked</div>
              </div>
              <div className="cell">
                <div className="label">Issued &middot; Payout</div>
                <div className="val">{issued}</div>
                <div className="sub">Direct deposit</div>
              </div>
            </section>

            {/* ── HERO ── */}
            <section className="hero">
              <div>
                <div className="payout-label">Owner Payout</div>
                <div className="payout-amount">
                  <span className="dollar">$</span>
                  <span>{Math.floor(prop.owner_payout).toLocaleString()}</span>
                  <span className="cents">.{fmt(prop.owner_payout).split('.')[1]}</span>
                </div>
              </div>
              <div className="mini-grid">
                <div className="mini">
                  <div className="mini-label">Stays</div>
                  <div className="mini-value">{numStays}</div>
                </div>
                <div className="mini">
                  <div className="mini-label">Nights</div>
                  <div className="mini-value">{nightsBooked}<span className="u"> / {totalDays}</span></div>
                  <div className="mini-sub">{occupancy}% occupancy</div>
                </div>
                <div className="mini">
                  <div className="mini-label">Avg Daily Rate</div>
                  <div className="mini-value">${Math.round(adr)}<span className="u">.{fmt(adr).split('.')[1]}</span></div>
                </div>
              </div>
            </section>

            {/* ── TWO-COL: Reservations + Financials ── */}
            <div className="two-col">
              <section>
                <div className="sec-head">
                  <span className="sec-num">01</span>
                  <h2 className="sec-title">Reservations</h2>
                  <span className="sec-meta">{numStays} stays</span>
                </div>
                <table className="res-table">
                  <thead><tr><th>Guest</th><th>Stay</th><th>Channel</th><th className="num">Net Rev</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <div className="guest">{r.guest_name}</div>
                          <div className="guest-sub">{r.nts} nts &middot; ${r.perNt}/nt</div>
                        </td>
                        <td><div className="stay-dates">{shortDate(r.check_in)} &rarr; {shortDate(r.check_out)}</div></td>
                        <td><span className="channel" data-ch={chLabel(r.platform)}><span className="dot" />{chLabel(r.platform)}</span></td>
                        <td className="num">${fmt(r.adjusted_revenue || r.rental_income)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <div className="sec-head">
                  <span className="sec-num">02</span>
                  <h2 className="sec-title">Financials</h2>
                  <span className="sec-meta">Net ${fmt(prop.owner_payout)}</span>
                </div>
                <table className="fin-table"><tbody>
                  <tr><td><span className="cat">Rental Revenue</span></td><td className="amt">${fmt(prop.rental_revenue)}</td></tr>
                  <tr><td><span className="cat">Mgmt Fee<small>({d.fee_pct}%)</small></span></td><td className="amt neg">&minus;${fmt(prop.management_fee)}</td></tr>
                  <tr><td><span className="cat">Cleaning<small>({cleans} turns)</small></span></td><td className="amt neg">&minus;${fmt(prop.cleaning_total)}</td></tr>
                  <tr><td><span className="cat">Repairs &amp; Maint.</span></td><td className="amt" style={prop.repairs_total > 0 ? {} : { color: 'var(--ink-4)' }}>{prop.repairs_total > 0 ? `\u2212$${fmt(prop.repairs_total)}` : '\u2014'}</td></tr>
                  <tr className="total"><td><span className="cat">Owner Payout</span></td><td className="amt">${fmt(prop.owner_payout)}</td></tr>
                </tbody></table>

                {/* Donut */}
                <div className="donut">
                  <svg viewBox="0 0 42 42">
                    <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--paper-2)" strokeWidth="7" />
                    {arcs.map((a, i) => (
                      <circle key={i} cx="21" cy="21" r="15.915" fill="none" stroke={chColors[a.ch] || '#888'} strokeWidth="7"
                        strokeDasharray={a.da} strokeDashoffset={String(a.off)} transform="rotate(-90 21 21)" />
                    ))}
                    <text x="21" y="20" textAnchor="middle" fontFamily="Fraunces" fontSize="6" fontWeight="500" fill="#1e2e34">${totRev >= 1000 ? (totRev / 1000).toFixed(1) + 'k' : Math.round(totRev)}</text>
                    <text x="21" y="25" textAnchor="middle" fontFamily="Inter" fontSize="2" fill="#506068" letterSpacing="0.2">GROSS</text>
                  </svg>
                  <div className="donut-legend">
                    {mix.map((m, i) => (
                      <div key={i} className="legend-row">
                        <span className="sw" style={{ background: chColors[m.ch] || '#888' }} />
                        <span>{m.ch}</span>
                        <span className="pct">{m.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {/* ── INSIGHTS ── */}
            <section className="insights">
              <div className="insight">
                <div className="insight-label">Guest Rating</div>
                {rating ? (
                  <>
                    <div className="insight-value">{rating.value.toFixed(1)}<span className="u">/5</span></div>
                    <div className="insight-sub">
                      {rating.count} review{rating.count === 1 ? '' : 's'} {rating.scope === 'month' ? 'this month' : 'to date'}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="insight-value">&mdash;</div>
                    <div className="insight-sub">No reviews yet</div>
                  </>
                )}
              </div>
              <div className="insight">
                <div className="insight-label">ADR</div>
                <div className="insight-value">${Math.round(adr)}</div>
                <div className="insight-sub">avg. daily rate</div>
              </div>
              <div className="insight">
                <div className="insight-label">Occupancy</div>
                <div className="insight-value">{occupancy}<span className="u">%</span></div>
                <div className="insight-sub">{nightsBooked} of {totalDays} nights</div>
              </div>
            </section>

            {/* ── BOTTOM: Upcoming + Review/Note ── */}
            <div className="bottom-two">
              <section>
                <div className="sec-head">
                  <span className="sec-num">03</span>
                  <h2 className="sec-title">On the horizon</h2>
                  <span className="sec-meta">Next 60d</span>
                </div>
                <div className="upcoming-list">
                  {csvData.upcoming.length > 0 ? csvData.upcoming.map((b, i) => {
                    const bd = new Date(b.checkIn + 'T00:00:00');
                    return (
                      <div key={i} className="upcoming-item">
                        <div className="cal">
                          <div className="cal-m">{bd.toLocaleDateString('en-US', { month: 'short' })}</div>
                          <div className="cal-d">{bd.getDate()}</div>
                        </div>
                        <div>
                          <div className="up-guest">{b.guest}</div>
                          <div className="up-sub">{b.nights} nights &middot; {chLabel(b.platform)}</div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', padding: '6px 0' }}>Upload reviews CSV for upcoming data</div>
                  )}
                </div>
              </section>

              <section className="note">
                {bestReview ? (
                  <>
                    <div className="note-kicker">Guest Review</div>
                    <div className="note-body">
                      <p>&ldquo;{bestReview.snippet}&rdquo;</p>
                    </div>
                    <div className="note-sig">
                      <div className="avatar">{bestReview.guest.charAt(0)}</div>
                      <div>
                        <div className="note-sig-name">{bestReview.guest}</div>
                        <div className="note-sig-title">5-star guest</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="note-kicker">A note from Allie</div>
                    <div className="note-body">
                      <p>Thank you for another great month at {d.name}. Your guests loved their stays and we look forward to continued success.</p>
                    </div>
                    <div className="note-sig">
                      <div className="avatar">AM</div>
                      <div>
                        <div className="note-sig-name">Allie Marsden</div>
                        <div className="note-sig-title">Property Manager &middot; Rising Tide STR</div>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>

            {/* ── FOOTER ── */}
            <footer className="footer">
              <div>Rising Tide STR &middot; Gloucester, MA</div>
              <div className="center">&ldquo;A rising tide lifts all boats.&rdquo;</div>
              <div className="right">Statement {moStr}&middot;{yr} &middot; pg 1/1</div>
            </footer>

          </main>
        </div>
      </body>
    </html>
  );
}

/* ────────────────────────────────────────────────
   CSS — copied verbatim from the Claude Design HTML
   ──────────────────────────────────────────────── */
const CSS = `
:root {
  --ink: #1e2e34; --ink-2: #2a3d45; --ink-3: #506068; --ink-4: #8a969c;
  --paper: #faf7f1; --paper-2: #f3ede1; --paper-3: #e8dfcc;
  --rule: #d9cfb8; --rule-soft: #ece3cf;
  --tide: #4b8a9e; --tide-deep: #2e5c6e;
  --signal: #c85a3a; --positive: #3a6b4a; --negative: #8a3a2e;
  --serif: 'Fraunces', 'Times New Roman', serif;
  --sans: 'Inter', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#e4ddcb; font-family:var(--sans); color:var(--ink); -webkit-font-smoothing:antialiased; }
.canvas { max-width:860px; margin:24px auto; padding:0 12px 40px; }
.sheet {
  background:var(--paper); border:1px solid var(--rule);
  box-shadow:0 30px 80px -20px rgba(30,46,52,.25),0 8px 24px -8px rgba(30,46,52,.1);
  position:relative; overflow:hidden;
  width:816px; min-height:1056px; max-width:100%;
  margin:0 auto; padding:22px 44px 18px;
  display:flex; flex-direction:column;
}
.sheet::before {
  content:''; position:absolute; inset:0;
  background-image: linear-gradient(to right,rgba(30,46,52,.03) 1px,transparent 1px), linear-gradient(to bottom,rgba(30,46,52,.03) 1px,transparent 1px);
  background-size:32px 32px; pointer-events:none; z-index:0;
}
.sheet>* { position:relative; z-index:1; }

/* MASTHEAD */
.masthead { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:20px; padding-bottom:12px; border-bottom:1px solid var(--ink); font-size:10px; color:var(--ink-3); }
.mast-left { font-family:var(--sans); letter-spacing:.18em; text-transform:uppercase; }
.mast-left b { color:var(--ink); font-weight:600; }
.mast-center { text-align:center; font-size:9px; letter-spacing:.3em; text-transform:uppercase; color:var(--ink-4); }
.mast-right { text-align:right; line-height:1.4; }

/* HEADER ROW */
.header-row { display:grid; grid-template-columns:150px 1fr; gap:24px; align-items:center; padding:18px 0 16px; border-bottom:1px solid var(--rule); }
.logo-block { display:flex; flex-direction:column; align-items:flex-start; gap:10px; }
.logo-block img { width:130px; height:auto; display:block; }
.headline-block { text-align:right; }
.kicker { font-family:var(--sans); font-size:10px; letter-spacing:.28em; text-transform:uppercase; color:var(--signal); margin-bottom:8px; }
.display { font-family:var(--serif); font-weight:300; font-size:50px; line-height:.92; letter-spacing:-.025em; color:var(--ink); margin:0; }
.display em { font-style:italic; font-weight:400; color:var(--tide-deep); }
.display-sub { margin-top:8px; font-family:var(--mono); font-size:11px; color:var(--ink-3); letter-spacing:.04em; }

/* ADDRESSEE */
.addressee { display:grid; grid-template-columns:1.2fr 1fr 1fr; gap:16px; padding:14px 0; border-bottom:1px solid var(--rule); }
.addressee .cell { line-height:1.35; }
.addressee .label { font-size:9px; text-transform:uppercase; letter-spacing:.2em; color:var(--ink-4); margin-bottom:4px; }
.addressee .val { font-family:var(--serif); font-size:15px; font-weight:500; color:var(--ink); }
.addressee .sub { font-size:11px; color:var(--ink-3); }

/* HERO */
.hero { display:grid; grid-template-columns:1.2fr 1.8fr; gap:24px; padding:18px 0 16px; align-items:center; border-bottom:1px solid var(--ink); }
.payout-label { font-size:10px; text-transform:uppercase; letter-spacing:.22em; color:var(--ink-3); margin-bottom:6px; }
.payout-amount { font-family:var(--serif); font-weight:400; font-size:54px; line-height:.9; letter-spacing:-.03em; color:var(--ink); display:flex; align-items:baseline; gap:4px; }
.payout-amount .dollar { font-size:.48em; color:var(--ink-3); align-self:flex-start; margin-top:.28em; }
.payout-amount .cents { font-size:.48em; color:var(--ink-3); align-self:flex-start; margin-top:.28em; }
.mini-grid { display:grid; grid-template-columns:repeat(3,1fr); }
.mini { padding:0 14px; border-right:1px solid var(--rule); }
.mini:first-child { padding-left:0; }
.mini:last-child { border-right:none; padding-right:0; }
.mini-label { font-size:9px; text-transform:uppercase; letter-spacing:.18em; color:var(--ink-4); margin-bottom:4px; }
.mini-value { font-family:var(--serif); font-size:24px; font-weight:400; color:var(--ink); line-height:1; font-variant-numeric:tabular-nums; }
.mini-value .u { font-size:.48em; color:var(--ink-3); }
.mini-sub { font-size:10px; color:var(--ink-3); margin-top:3px; }

/* SECTION HEAD */
.sec-head { display:grid; grid-template-columns:auto 1fr auto; gap:14px; align-items:baseline; padding:14px 0 8px; }
.sec-num { font-family:var(--mono); font-size:10px; color:var(--signal); letter-spacing:.08em; }
.sec-title { font-family:var(--serif); font-weight:500; font-size:17px; color:var(--ink); margin:0; }
.sec-meta { font-size:10px; color:var(--ink-3); text-transform:uppercase; letter-spacing:.14em; }

/* TWO COLUMN */
.two-col { display:grid; grid-template-columns:1.35fr 1fr; gap:28px; padding-bottom:12px; }

/* RESERVATIONS TABLE */
.res-table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.res-table thead th { text-align:left; font-family:var(--sans); font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-3); padding:6px; border-bottom:1px solid var(--ink); }
.res-table thead th.num { text-align:right; }
.res-table tbody td { padding:8px 6px; border-bottom:1px solid var(--rule-soft); vertical-align:middle; font-size:12px; }
.res-table tbody tr:last-child td { border-bottom:1px solid var(--ink); }
.res-table tbody td.num { text-align:right; font-family:var(--serif); font-size:14px; }
.guest { font-family:var(--serif); font-weight:500; font-size:13px; color:var(--ink); line-height:1.2; }
.guest-sub { font-size:10px; color:var(--ink-4); font-family:var(--sans); margin-top:1px; }
.stay-dates { font-size:12px; color:var(--ink-2); font-weight:500; }
.channel { display:inline-flex; align-items:center; gap:6px; padding:2px 7px 2px 6px; border:1px solid var(--rule); background:var(--paper-2); border-radius:3px; font-size:10px; font-weight:600; color:var(--ink-2); }
.channel .dot { width:6px; height:6px; border-radius:50%; }
.channel[data-ch="Airbnb"] .dot { background:#ff5a5f; }
.channel[data-ch="VRBO"] .dot { background:#245abc; }
.channel[data-ch="Booking"] .dot { background:#003580; }
.channel[data-ch="Direct"] .dot { background:#4a6b3a; }

/* FINANCIALS */
.fin-table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.fin-table td { padding:8px 0 7px; border-bottom:1px dotted var(--rule); font-size:12px; color:var(--ink-2); vertical-align:baseline; line-height:1.25; }
.fin-table td.amt { text-align:right; font-family:var(--serif); font-size:13px; color:var(--ink); }
.fin-table td.amt.neg { color:var(--negative); }
.fin-table tr.total td { border-top:1.5px solid var(--ink); border-bottom:2.5px double var(--ink); font-weight:600; font-size:13px; padding:8px 0 7px; color:var(--ink); vertical-align:baseline; }
.fin-table tr.total td.amt { font-size:15px; font-weight:600; }
.fin-table .cat { display:inline-flex; align-items:baseline; gap:8px; line-height:1.2; }
.fin-table .cat::before { content:''; width:6px; height:6px; border:1px solid var(--ink-3); border-radius:50%; flex-shrink:0; transform:translateY(-1px); }
.fin-table tr.total .cat::before { background:var(--ink); border-color:var(--ink); width:7px; height:7px; }
.fin-table small { color:var(--ink-4); font-size:10px; margin-left:4px; }

/* DONUT */
.donut { display:flex; align-items:center; gap:12px; margin-top:10px; }
.donut svg { width:78px; height:78px; flex-shrink:0; }
.donut-legend { flex:1; display:flex; flex-direction:column; gap:4px; }
.legend-row { display:grid; grid-template-columns:auto 1fr auto; gap:8px; align-items:center; font-size:11px; padding:3px 0; border-bottom:1px dotted var(--rule); }
.legend-row:last-child { border-bottom:none; }
.legend-row .sw { width:8px; height:8px; border-radius:2px; }
.legend-row .pct { font-family:var(--mono); font-size:10px; color:var(--ink-3); }

/* INSIGHTS */
.insights { display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid var(--ink); border-bottom:1px solid var(--ink); margin-top:14px; }
.insight { padding:12px 14px; border-right:1px solid var(--rule); }
.insight:last-child { border-right:none; }
.insight-label { font-size:9px; text-transform:uppercase; letter-spacing:.18em; color:var(--ink-3); margin-bottom:6px; }
.insight-value { font-family:var(--serif); font-size:19px; font-weight:400; line-height:1; color:var(--ink); font-variant-numeric:tabular-nums; }
.insight-value .u { font-size:.5em; color:var(--ink-3); }
.insight-sub { margin-top:5px; font-size:10px; color:var(--ink-3); }

/* BOTTOM TWO */
.bottom-two { display:grid; grid-template-columns:1fr 1fr; gap:24px; padding:16px 0 12px; }
.upcoming-list { display:flex; flex-direction:column; }
.upcoming-item { display:grid; grid-template-columns:36px 1fr auto; gap:10px; padding:6px 0; align-items:center; border-bottom:1px dotted var(--rule); }
.upcoming-item:last-child { border-bottom:none; }
.cal { width:40px; border:1px solid var(--ink); border-radius:3px; text-align:center; overflow:hidden; font-variant-numeric:tabular-nums; }
.cal-m { background:var(--ink); color:var(--paper); font-size:8px; font-weight:600; text-transform:uppercase; letter-spacing:.12em; padding:2px 0 1px; }
.cal-d { font-family:var(--serif); font-size:15px; font-weight:500; padding:2px 0 3px; color:var(--ink); line-height:1; }
.up-guest { font-family:var(--serif); font-size:12px; font-weight:500; line-height:1.2; }
.up-sub { font-size:9px; color:var(--ink-3); margin-top:1px; }

/* NOTE */
.note { padding:14px 16px; background:var(--paper-2); border:1px solid var(--rule); position:relative; }
.note::before { content:''; position:absolute; left:-1px; top:-1px; bottom:-1px; width:2px; background:var(--signal); }
.note-kicker { font-size:9px; text-transform:uppercase; letter-spacing:.22em; color:var(--signal); margin-bottom:6px; }
.note-body { font-family:var(--serif); font-size:12px; line-height:1.5; color:var(--ink); }
.note-body p { margin:0 0 5px; }
.note-sig { margin-top:6px; display:flex; align-items:center; gap:8px; padding-top:6px; border-top:1px dotted var(--rule); }
.note-sig .avatar { width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,var(--tide),var(--tide-deep)); color:var(--paper); display:flex; align-items:center; justify-content:center; font-family:var(--serif); font-size:11px; font-weight:500; }
.note-sig-name { font-family:var(--serif); font-size:12px; font-weight:500; }
.note-sig-title { font-size:9px; color:var(--ink-3); }

/* FOOTER */
.footer { margin-top:auto; padding-top:12px; border-top:1px solid var(--ink); display:grid; grid-template-columns:1fr auto 1fr; gap:16px; align-items:center; font-size:9px; color:var(--ink-3); text-transform:uppercase; letter-spacing:.15em; }
.footer .center { text-align:center; font-family:var(--serif); font-style:italic; font-size:12px; color:var(--ink); text-transform:none; letter-spacing:0; }
.footer .right { text-align:right; }

/* PRINT */
@media print {
  body { background:white; }
  .canvas { margin:0; max-width:none; padding:0; }
  .sheet { box-shadow:none; border:none; width:100%; min-height:auto; padding:.35in .4in; }
  @page { size:letter; margin:0; }
}
`;
