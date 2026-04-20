import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const PROPERTY_DETAILS: Record<string, { name: string; address: string; city: string; owner_full: string; fee_pct: number }> = {
  '3_south_st':    { name: '3 South St',        address: '3 South Street',       city: 'Rockport, MA',    owner_full: 'Marci & Paul Bailey', fee_pct: 25 },
  '21_horton':     { name: '21 Horton St',       address: '21 Horton Street',     city: 'Gloucester, MA',  owner_full: 'Claudia Kittredge', fee_pct: 22 },
  '53_rocky_neck': { name: '53 Rocky Neck Ave',  address: '53 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'Mark Prudenzi', fee_pct: 25 },
  '4_brier_neck':  { name: '4 Brier Neck Rd',    address: '4 Brier Neck Road',    city: 'Gloucester, MA',  owner_full: 'The Armstrong Family', fee_pct: 20 },
  '30_woodward':   { name: '30 Woodward Ave',    address: '30 Woodward Avenue',   city: 'Gloucester, MA',  owner_full: 'The McWethy Family', fee_pct: 25 },
  '20_hammond':    { name: '20 Hammond St',      address: '20 Hammond Street',    city: 'Gloucester, MA',  owner_full: 'The Ramsey Family', fee_pct: 25 },
  '20_enon':       { name: '20 Enon Rd',         address: '20 Enon Road',         city: 'Gloucester, MA',  owner_full: 'The Snyder Family', fee_pct: 25 },
  '73_rocky_neck': { name: '73 Rocky Neck Ave',  address: '73 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'The Moynahan Family', fee_pct: 25 },
  '17_beach_rd':   { name: '17 Beach Rd',        address: '17 Beach Road',        city: 'Gloucester, MA',  owner_full: 'The Nolan Family', fee_pct: 22 },
  '65_calderwood': { name: '65 Calderwood Ln',   address: '65 Calderwood Lane',   city: 'Fairfield, CT',   owner_full: 'The Liu Family', fee_pct: 25 },
  '3_locust':      { name: '3 Locust St',        address: '3 Locust Street',      city: 'Gloucester, MA',  owner_full: 'The Lucas Family', fee_pct: 25 },
  '3246_ne_27th':  { name: '3246 NE 27th Ave',   address: '3246 NE 27th Avenue',  city: 'Lighthouse Point, FL', owner_full: 'The Enriquez Family', fee_pct: 25 },
};

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWhole(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthName(m: string): string {
  return new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long' });
}

function daysInMonth(m: string): number {
  const [year, mo] = m.split('-').map(Number);
  return new Date(year, mo, 0).getDate();
}

function channelLabel(platform: string): string {
  const map: Record<string, string> = { 'HomeAway': 'VRBO', 'Manual': 'Direct', 'Booking.com': 'Booking' };
  return map[platform] || platform;
}

function channelAttr(platform: string): string {
  const map: Record<string, string> = { 'HomeAway': 'VRBO', 'Manual': 'Direct', 'Booking.com': 'Booking' };
  return map[platform] || platform;
}

export default async function StatementPage({ searchParams }: { searchParams: Promise<{ id?: string; month?: string }> }) {
  const params = await searchParams;
  const { id, month } = params;

  if (!id || !month) {
    return <div style={{ padding: 40, fontFamily: 'Inter, sans-serif' }}>Missing id or month parameter. Usage: /statement?id=...&amp;month=YYYY-MM</div>;
  }

  // Fetch data from Supabase
  const { data: prop } = await supabase
    .from('property_statements')
    .select('*')
    .eq('id', id)
    .single();

  if (!prop) {
    return <div style={{ padding: 40, fontFamily: 'Inter, sans-serif' }}>Statement not found.</div>;
  }

  const { data: reservations } = await supabase
    .from('reservations')
    .select('*')
    .eq('property_statement_id', id)
    .order('check_out');

  const { data: cleaningEvents } = await supabase
    .from('cleaning_events')
    .select('*')
    .eq('property_statement_id', id);

  const details = PROPERTY_DETAILS[prop.property_id] || {
    name: prop.property_name, address: prop.property_name, city: 'Gloucester, MA',
    owner_full: prop.owner_name || 'Owner', fee_pct: 25,
  };

  const numStays = prop.num_stays || (reservations?.length || 0);
  const nightsBooked = prop.nights_booked || 0;
  const totalDays = daysInMonth(month);
  const occupancy = totalDays > 0 ? Math.round((nightsBooked / totalDays) * 100) : 0;
  const adr = nightsBooked > 0 ? prop.rental_revenue / nightsBooked : 0;
  const revPAN = totalDays > 0 ? prop.rental_revenue / totalDays : 0;
  const [yearStr, moStr] = month.split('-');
  const mo = monthName(month);
  const cleaningCount = cleaningEvents?.length || numStays;

  // Channel mix
  const channelRevenue: Record<string, number> = {};
  if (reservations) {
    for (const r of reservations) {
      const ch = channelLabel(r.platform);
      channelRevenue[ch] = (channelRevenue[ch] || 0) + (r.adjusted_revenue || r.rental_income || 0);
    }
  }
  const totalRevenue = Object.values(channelRevenue).reduce((a, b) => a + b, 0);
  const channelMix = Object.entries(channelRevenue)
    .map(([ch, rev]) => ({ channel: ch, revenue: rev, pct: totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);

  // Donut SVG arcs
  let offset = 25;
  const donutArcs = channelMix.map(ch => {
    const arc = { channel: ch.channel, pct: ch.pct, dasharray: `${ch.pct} ${100 - ch.pct}`, offset };
    offset -= ch.pct;
    return arc;
  });

  const channelColors: Record<string, string> = {
    'Airbnb': '#ff5a5f', 'VRBO': '#245abc', 'Booking': '#003580', 'Direct': '#4a6b3a',
  };

  // Issue date (1st of next month)
  const nextMo = parseInt(moStr) === 12 ? 1 : parseInt(moStr) + 1;
  const nextYear = parseInt(moStr) === 12 ? parseInt(yearStr) + 1 : parseInt(yearStr);
  const issueDate = new Date(nextYear, nextMo - 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Reservation details with computed fields
  const resRows = (reservations || []).map(r => {
    const d1 = new Date(r.check_in + 'T00:00:00');
    const d2 = new Date(r.check_out + 'T00:00:00');
    const nights = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    const perNight = nights > 0 ? Math.round((r.adjusted_revenue || r.rental_income) / nights) : 0;
    return { ...r, nights, perNight };
  });

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Owner Statement &middot; {details.name} &middot; {mo} {yearStr}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: STATEMENT_CSS }} />
      </head>
      <body data-variant="editorial">
        <div className="canvas">
          <main className="sheet" id="sheet">

            {/* MASTHEAD */}
            <header className="masthead">
              <div className="mast-left"><b>Rising Tide</b> &middot; Vacation Rentals</div>
              <div className="mast-center">Owner Statement &middot; No. {moStr} / {yearStr}</div>
              <div className="mast-right">
                85 Eastern Ave &middot; Gloucester, MA 01930<br />
                allie@risingtidestr.com
              </div>
            </header>

            {/* HEADER ROW */}
            <section className="header-row">
              <div className="logo-block">
                {/* Pennant SVG */}
                <svg width="130" height="80" viewBox="0 0 130 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 5 L95 40 L5 75 Z" stroke="#1e2e34" strokeWidth="3" fill="none" />
                  <line x1="5" y1="42" x2="82" y2="68" stroke="#1e2e34" strokeWidth="2" />
                  <text x="15" y="38" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="16" fill="#1e2e34">RISING</text>
                  <text x="20" y="58" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="16" fill="#1e2e34">TIDE</text>
                </svg>
              </div>
              <div className="headline-block">
                <div className="kicker">{mo.toUpperCase()} &middot; {yearStr}</div>
                <h1 className="display">{mo} <em>Statement</em></h1>
                <div className="display-sub">{details.address.toUpperCase()} &middot; {details.city.toUpperCase()}</div>
              </div>
            </section>

            {/* ADDRESSEE */}
            <section className="addressee">
              <div className="cell">
                <div className="label">Prepared for</div>
                <div className="val">{details.owner_full}</div>
                <div className="sub">{details.address} &middot; {details.city}</div>
              </div>
              <div className="cell">
                <div className="label">Period</div>
                <div className="val">{mo.substring(0, 3)} 1 &mdash; {mo.substring(0, 3)} {totalDays}, {yearStr}</div>
                <div className="sub">{totalDays} days &middot; {nightsBooked} nights booked</div>
              </div>
              <div className="cell">
                <div className="label">Issued</div>
                <div className="val">{issueDate}</div>
                <div className="sub">Direct deposit</div>
              </div>
            </section>

            {/* HERO */}
            <section className="hero">
              <div>
                <div className="payout-label">Owner Payout</div>
                <div className="payout-amount">
                  <span className="dollar">$</span>
                  <span>{fmt(prop.owner_payout).split('.')[0].replace('$', '')}</span>
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
                  <div className="mini-value">${fmtWhole(adr)}</div>
                </div>
              </div>
            </section>

            {/* TWO COLUMN: Reservations + Financials */}
            <div className="two-col">
              {/* Reservations */}
              <section>
                <div className="sec-head">
                  <span className="sec-num">01</span>
                  <h2 className="sec-title">Reservations</h2>
                  <span className="sec-meta">{numStays} stays</span>
                </div>
                <table className="res-table">
                  <thead>
                    <tr>
                      <th>Guest</th>
                      <th>Stay</th>
                      <th>Channel</th>
                      <th className="num">Net Rev</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resRows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <div className="guest">{r.guest_name}</div>
                          <div className="guest-sub">{r.nights} nts &middot; ${r.perNight}/nt</div>
                        </td>
                        <td>
                          <div className="stay-dates">{shortDate(r.check_in)} &rarr; {shortDate(r.check_out)}</div>
                        </td>
                        <td>
                          <span className="channel" data-ch={channelAttr(r.platform)}>
                            <span className="dot" />
                            {channelLabel(r.platform)}
                          </span>
                        </td>
                        <td className="num">${fmt(r.adjusted_revenue || r.rental_income)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Financials */}
              <section>
                <div className="sec-head">
                  <span className="sec-num">02</span>
                  <h2 className="sec-title">Financials</h2>
                  <span className="sec-meta">Net ${fmt(prop.owner_payout)}</span>
                </div>
                <table className="fin-table">
                  <tbody>
                    <tr>
                      <td><span className="cat">Rental Revenue</span></td>
                      <td className="amt">${fmt(prop.rental_revenue)}</td>
                    </tr>
                    <tr>
                      <td><span className="cat">Mgmt Fee<small>({details.fee_pct}%)</small></span></td>
                      <td className="amt neg">&minus;${fmt(prop.management_fee)}</td>
                    </tr>
                    <tr>
                      <td><span className="cat">Cleaning<small>({cleaningCount} turns)</small></span></td>
                      <td className="amt neg">&minus;${fmt(prop.cleaning_total)}</td>
                    </tr>
                    <tr>
                      <td><span className="cat">Repairs &amp; Maint.</span></td>
                      <td className="amt" style={prop.repairs_total > 0 ? {} : { color: 'var(--ink-4)' }}>
                        {prop.repairs_total > 0 ? `−$${fmt(prop.repairs_total)}` : '—'}
                      </td>
                    </tr>
                    <tr className="total">
                      <td><span className="cat">Owner Payout</span></td>
                      <td className="amt">${fmt(prop.owner_payout)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Donut */}
                <div className="donut">
                  <svg viewBox="0 0 42 42">
                    <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--paper-2)" strokeWidth="7" />
                    {donutArcs.map((arc, i) => (
                      <circle key={i} cx="21" cy="21" r="15.915" fill="none"
                        stroke={channelColors[arc.channel] || '#888'}
                        strokeWidth="7"
                        strokeDasharray={arc.dasharray}
                        strokeDashoffset={String(arc.offset)}
                        transform="rotate(-90 21 21)" />
                    ))}
                    <text x="21" y="20" textAnchor="middle" fontFamily="Fraunces" fontSize="6" fontWeight="500" fill="#1e2e34">
                      ${totalRevenue >= 1000 ? (totalRevenue / 1000).toFixed(1) + 'k' : fmtWhole(totalRevenue)}
                    </text>
                    <text x="21" y="25" textAnchor="middle" fontFamily="Inter" fontSize="2" fill="#506068" letterSpacing="0.2">GROSS</text>
                  </svg>
                  <div className="donut-legend">
                    {channelMix.map((ch, i) => (
                      <div key={i} className="legend-row">
                        <span className="sw" style={{ background: channelColors[ch.channel] || '#888' }} />
                        <span>{ch.channel}</span>
                        <span className="pct">{ch.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {/* INSIGHTS STRIP */}
            <section className="insights">
              <div className="insight">
                <div className="insight-label">ADR</div>
                <div className="insight-value">${fmtWhole(adr)}</div>
                <div className="insight-sub">avg. daily rate</div>
              </div>
              <div className="insight">
                <div className="insight-label">RevPAN</div>
                <div className="insight-value">${fmtWhole(revPAN)}</div>
                <div className="insight-sub">rev per avail. night</div>
              </div>
              <div className="insight">
                <div className="insight-label">Guest Rating</div>
                <div className="insight-value">5.0<span className="u">/5</span></div>
                <div className="insight-sub">{numStays} reviews</div>
              </div>
              <div className="insight">
                <div className="insight-label">Occupancy</div>
                <div className="insight-value">{occupancy}<span className="u">%</span></div>
                <div className="insight-sub">{nightsBooked} of {totalDays} nights</div>
              </div>
            </section>

            {/* BOTTOM: Note from Allie */}
            <div className="bottom-two">
              <div />
              <section className="note">
                <div className="note-kicker">A note from Allie</div>
                <div className="note-body">
                  <p>{details.owner_full.split(' ').pop()} &mdash; Thank you for another great month at {details.name}. Your guests loved their stays and we look forward to continued success.</p>
                </div>
                <div className="note-sig">
                  <div className="avatar">AM</div>
                  <div>
                    <div className="note-sig-name">Allie Marsden</div>
                    <div className="note-sig-title">Property Manager &middot; Rising Tide STR</div>
                  </div>
                </div>
              </section>
            </div>

            {/* FOOTER */}
            <footer className="footer">
              <div>Rising Tide STR &middot; Gloucester, MA</div>
              <div className="center">&ldquo;A rising tide lifts all boats.&rdquo;</div>
              <div className="right">Statement {moStr}&middot;{yearStr} &middot; pg 1/1</div>
            </footer>

          </main>
        </div>
      </body>
    </html>
  );
}

// ─── The exact CSS from the Claude Design HTML ───
const STATEMENT_CSS = `
  :root {
    --ink: #1e2e34;
    --ink-2: #2a3d45;
    --ink-3: #506068;
    --ink-4: #8a969c;
    --paper: #faf7f1;
    --paper-2: #f3ede1;
    --paper-3: #e8dfcc;
    --rule: #d9cfb8;
    --rule-soft: #ece3cf;
    --tide: #4b8a9e;
    --tide-deep: #2e5c6e;
    --signal: #c85a3a;
    --positive: #3a6b4a;
    --negative: #8a3a2e;
    --serif: 'Fraunces', 'Times New Roman', serif;
    --sans: 'Inter', system-ui, sans-serif;
    --mono: 'JetBrains Mono', ui-monospace, monospace;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e4ddcb; font-family: var(--sans); color: var(--ink); -webkit-font-smoothing: antialiased; }

  .canvas {
    max-width: 860px;
    margin: 24px auto;
    padding: 0 12px 40px;
  }

  .sheet {
    background: var(--paper);
    border: 1px solid var(--rule);
    box-shadow: 0 30px 80px -20px rgba(30,46,52,0.25), 0 8px 24px -8px rgba(30,46,52,0.1);
    position: relative;
    overflow: hidden;
    width: 816px;
    min-height: 1056px;
    max-width: 100%;
    margin: 0 auto;
    padding: 22px 44px 18px;
    display: flex;
    flex-direction: column;
  }

  .sheet::before {
    content: '';
    position: absolute; inset: 0;
    background-image:
      linear-gradient(to right, rgba(30,46,52,0.03) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(30,46,52,0.03) 1px, transparent 1px);
    background-size: 32px 32px;
    pointer-events: none;
    z-index: 0;
  }
  .sheet > * { position: relative; z-index: 1; }

  .masthead {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--ink);
    font-size: 10px;
    color: var(--ink-3);
  }
  .mast-left { font-family: var(--sans); letter-spacing: 0.18em; text-transform: uppercase; }
  .mast-left b { color: var(--ink); font-weight: 600; }
  .mast-center { text-align: center; font-family: var(--sans); font-size: 9px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink-4); }
  .mast-right { text-align: right; line-height: 1.4; }

  .header-row {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 24px;
    align-items: center;
    padding: 14px 0 12px;
    border-bottom: 1px solid var(--rule);
  }
  .logo-block { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  .logo-block img, .logo-block svg { width: 130px; height: auto; display: block; }

  .headline-block { text-align: right; }
  .kicker { font-family: var(--sans); font-size: 10px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--signal); margin-bottom: 8px; }
  .display { font-family: var(--serif); font-weight: 300; font-size: 50px; line-height: 0.92; letter-spacing: -0.025em; color: var(--ink); margin: 0; font-variation-settings: "opsz" 144; }
  .display em { font-style: italic; font-weight: 400; color: var(--tide-deep); }
  .display-sub { margin-top: 8px; font-family: var(--mono); font-size: 11px; color: var(--ink-3); letter-spacing: 0.04em; }

  .addressee { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--rule); }
  .addressee .cell { line-height: 1.35; }
  .addressee .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--ink-4); margin-bottom: 4px; }
  .addressee .val { font-family: var(--serif); font-size: 15px; font-weight: 500; color: var(--ink); }
  .addressee .sub { font-size: 11px; color: var(--ink-3); }

  .hero { display: grid; grid-template-columns: 1.2fr 1.8fr; gap: 24px; padding: 14px 0 12px; align-items: center; border-bottom: 1px solid var(--ink); }
  .payout-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.22em; color: var(--ink-3); margin-bottom: 6px; }
  .payout-amount { font-family: var(--serif); font-weight: 400; font-size: 54px; line-height: 0.9; letter-spacing: -0.03em; color: var(--ink); font-variation-settings: "opsz" 144; display: flex; align-items: baseline; gap: 4px; }
  .payout-amount .dollar { font-size: 0.48em; color: var(--ink-3); align-self: flex-start; margin-top: 0.28em; }
  .payout-amount .cents { font-size: 0.48em; color: var(--ink-3); align-self: flex-start; margin-top: 0.28em; }

  .mini-grid { display: grid; grid-template-columns: repeat(3, 1fr); }
  .mini { padding: 0 14px; border-right: 1px solid var(--rule); }
  .mini:first-child { padding-left: 0; }
  .mini:last-child { border-right: none; padding-right: 0; }
  .mini-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--ink-4); margin-bottom: 4px; }
  .mini-value { font-family: var(--serif); font-size: 24px; font-weight: 400; color: var(--ink); line-height: 1; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .mini-value .u { font-size: 0.48em; color: var(--ink-3); }
  .mini-sub { font-size: 10px; color: var(--ink-3); margin-top: 3px; }

  .sec-head { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: baseline; padding: 10px 0 6px; }
  .sec-num { font-family: var(--mono); font-size: 10px; color: var(--signal); letter-spacing: 0.08em; }
  .sec-title { font-family: var(--serif); font-weight: 500; font-size: 17px; color: var(--ink); letter-spacing: -0.005em; margin: 0; }
  .sec-meta { font-size: 10px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.14em; }

  .two-col { display: grid; grid-template-columns: 1.35fr 1fr; gap: 24px; padding-bottom: 6px; }

  .res-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .res-table thead th { text-align: left; font-family: var(--sans); font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-3); padding: 6px 6px; border-bottom: 1px solid var(--ink); }
  .res-table thead th.num { text-align: right; }
  .res-table tbody td { padding: 6px 6px; border-bottom: 1px solid var(--rule-soft); vertical-align: middle; font-size: 12px; }
  .res-table tbody tr:last-child td { border-bottom: 1px solid var(--ink); }
  .res-table tbody td.num { text-align: right; font-family: var(--serif); font-size: 14px; font-weight: 400; }
  .guest { font-family: var(--serif); font-weight: 500; font-size: 13px; color: var(--ink); line-height: 1.2; }
  .guest-sub { font-size: 10px; color: var(--ink-4); font-family: var(--sans); margin-top: 1px; }
  .stay-dates { font-size: 12px; color: var(--ink-2); font-weight: 500; }
  .channel { display: inline-flex; align-items: center; gap: 6px; padding: 2px 7px 2px 6px; border: 1px solid var(--rule); background: var(--paper-2); border-radius: 3px; font-size: 10px; font-weight: 600; color: var(--ink-2); }
  .channel .dot { width: 6px; height: 6px; border-radius: 50%; }
  .channel[data-ch="Airbnb"] .dot { background: #ff5a5f; }
  .channel[data-ch="VRBO"] .dot { background: #245abc; }
  .channel[data-ch="Booking"] .dot { background: #003580; }
  .channel[data-ch="Direct"] .dot { background: #4a6b3a; }

  .fin-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .fin-table td { padding: 6px 0 5px; border-bottom: 1px dotted var(--rule); font-size: 12px; color: var(--ink-2); vertical-align: baseline; line-height: 1.25; }
  .fin-table td.amt { text-align: right; font-family: var(--serif); font-size: 13px; color: var(--ink); vertical-align: baseline; }
  .fin-table td.amt.neg { color: var(--negative); }
  .fin-table tr.total td { border-top: 1.5px solid var(--ink); border-bottom: 2.5px double var(--ink); font-weight: 600; font-size: 13px; padding: 8px 0 7px; color: var(--ink); vertical-align: baseline; line-height: 1.25; }
  .fin-table tr.total td.amt { font-size: 15px; font-weight: 600; }
  .fin-table .cat { display: inline-flex; align-items: baseline; gap: 8px; line-height: 1.2; }
  .fin-table .cat::before { content: ''; width: 6px; height: 6px; border: 1px solid var(--ink-3); border-radius: 50%; flex-shrink: 0; transform: translateY(-1px); }
  .fin-table tr.total .cat::before { background: var(--ink); border-color: var(--ink); width: 7px; height: 7px; }
  .fin-table small { color: var(--ink-4); font-size: 10px; margin-left: 4px; }

  .donut { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
  .donut svg { width: 78px; height: 78px; flex-shrink: 0; }
  .donut-legend { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .legend-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font-size: 11px; padding: 3px 0; border-bottom: 1px dotted var(--rule); }
  .legend-row:last-child { border-bottom: none; }
  .legend-row .sw { width: 8px; height: 8px; border-radius: 2px; }
  .legend-row .pct { font-family: var(--mono); font-size: 10px; color: var(--ink-3); }

  .insights { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); margin-top: 10px; }
  .insight { padding: 8px 12px; border-right: 1px solid var(--rule); }
  .insight:last-child { border-right: none; }
  .insight-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--ink-3); margin-bottom: 6px; }
  .insight-value { font-family: var(--serif); font-size: 19px; font-weight: 400; line-height: 1; letter-spacing: -0.01em; color: var(--ink); font-variant-numeric: tabular-nums; }
  .insight-value .u { font-size: 0.5em; color: var(--ink-3); }
  .insight-sub { margin-top: 5px; font-size: 10px; color: var(--ink-3); line-height: 1.4; }

  .bottom-two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 10px 0 8px; }

  .note { padding: 10px 14px; background: var(--paper-2); border: 1px solid var(--rule); position: relative; }
  .note::before { content: ''; position: absolute; left: -1px; top: -1px; bottom: -1px; width: 2px; background: var(--signal); }
  .note-kicker { font-size: 9px; text-transform: uppercase; letter-spacing: 0.22em; color: var(--signal); margin-bottom: 6px; }
  .note-body { font-family: var(--serif); font-size: 11.5px; line-height: 1.45; color: var(--ink); }
  .note-body p { margin: 0 0 5px; }
  .note-body p:last-child { margin-bottom: 0; }
  .note-sig { margin-top: 6px; display: flex; align-items: center; gap: 8px; padding-top: 6px; border-top: 1px dotted var(--rule); }
  .note-sig .avatar { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, var(--tide) 0%, var(--tide-deep) 100%); color: var(--paper); display: flex; align-items: center; justify-content: center; font-family: var(--serif); font-size: 11px; font-weight: 500; }
  .note-sig-name { font-family: var(--serif); font-size: 12px; font-weight: 500; line-height: 1.2; }
  .note-sig-title { font-size: 9px; color: var(--ink-3); }

  .footer { margin-top: auto; padding-top: 8px; border-top: 1px solid var(--ink); display: grid; grid-template-columns: 1fr auto 1fr; gap: 16px; align-items: center; font-size: 9px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.15em; }
  .footer .center { text-align: center; font-family: var(--serif); font-style: italic; font-size: 12px; color: var(--ink); text-transform: none; letter-spacing: 0; }
  .footer .right { text-align: right; }

  @media print {
    body { background: white; }
    .canvas { margin: 0; max-width: none; padding: 0; }
    .sheet { box-shadow: none; border: none; width: 100%; min-height: auto; padding: 0.35in 0.4in; }
    @page { size: letter; margin: 0; }
  }
`;
