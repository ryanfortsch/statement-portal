import { createClient } from '@supabase/supabase-js';
import { DownloadPdfChip } from '@/components/DownloadPdfChip';
import { PROPERTIES } from '@/lib/properties';

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
  '20_enon':       { name: '20 Enon Rd',         address: '20 Enon Road',         city: 'Beverly, MA',     owner_full: 'The Snyder Family', fee_pct: 25, listing_match: '20 enon' },
  '73_rocky_neck': { name: '73 Rocky Neck Ave',  address: '73 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'The Moynahan Family', fee_pct: 25, listing_match: '73 rocky neck' },
  '17_beach_rd':   { name: '17 Beach Rd',        address: '17 Beach Road',        city: 'Gloucester, MA',  owner_full: 'Susan & London Nolan', fee_pct: 22, listing_match: '17 beach' },
};

// ---- helpers ----
function fmt(n: number) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function shortDate(d: string) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function monthName(m: string) { return new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long' }); }
function daysInMonth(m: string) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
function chLabel(p: string) { return ({ HomeAway: 'VRBO', Manual: 'Direct', 'Booking.com': 'Booking' } as Record<string, string>)[p] || p; }

// Normalize guest names: "julie polvinen" -> "Julie Polvinen". Preserves
// common connectors lowercase ("Mary Van Der Berg" stays as-is after title-casing).
function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\b[\p{L}'’-]+/gu, w =>
    w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase()
  );
}

// Nights a reservation occupies inside [monthStart, monthEnd_exclusive).
// Using hotel convention: night is counted by check-in date, so the range
// of occupied nights is [check_in, check_out).
function nightsInMonth(checkIn: string, checkOut: string, month: string): number {
  const [y, mo] = month.split('-').map(Number);
  const ms = Date.UTC(y, mo - 1, 1);
  const me = Date.UTC(y, mo, 1);
  const ci = Date.parse(checkIn + 'T00:00:00Z');
  const co = Date.parse(checkOut + 'T00:00:00Z');
  if (isNaN(ci) || isNaN(co)) return 0;
  const start = Math.max(ci, ms);
  const end = Math.min(co, me);
  return Math.max(0, Math.round((end - start) / 86400_000));
}

function trimToSnippet(text: string, maxLen: number): string {
  const cleaned = text.trim();
  if (cleaned.length <= maxLen) return cleaned;
  // Prefer a clean sentence boundary
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
  let acc = '';
  for (const s of sentences) {
    if ((acc + (acc ? ' ' : '') + s).length <= maxLen) {
      acc = acc ? acc + ' ' + s : s;
    } else {
      break;
    }
  }
  if (acc.length >= 30) return acc.trim();
  // Fallback: hard truncate on a word boundary with an ellipsis
  return cleaned.substring(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
}

type ReviewSnippet = { guest: string; snippet: string };

/**
 * Pick 1–3 review snippets for the statement:
 *   - 1 review available: show it in long form (up to 180 chars)
 *   - Multiple reviews: stack short quotes (up to 100 chars each), capped
 *     at 3 or ~320 total chars so the Note block doesn't overflow
 */
function pickReviews(reviews: { guest: string; review: string }[]): ReviewSnippet[] {
  if (!reviews.length) return [];
  if (reviews.length === 1) {
    return [{ guest: reviews[0].guest, snippet: trimToSnippet(reviews[0].review, 180) }];
  }

  // Multi-review case: trim each to a short form, rank by quality proxy
  // (longer = more substantive, but capped so visual balance is preserved)
  const trimmed = reviews
    .map(r => ({ guest: r.guest, snippet: trimToSnippet(r.review, 110) }))
    .filter(r => r.snippet.length >= 25)
    // Prefer the more substantive / closer-to-cap snippets first
    .sort((a, b) => b.snippet.length - a.snippet.length);

  const picks: ReviewSnippet[] = [];
  let total = 0;
  for (const r of trimmed) {
    if (picks.length >= 3) break;
    if (picks.length >= 1 && total + r.snippet.length > 320) break;
    picks.push(r);
    total += r.snippet.length;
  }
  return picks;
}

// ---- page ----
export default async function StatementPage({ searchParams }: { searchParams: Promise<{ id?: string; month?: string }> }) {
  const params = await searchParams;
  const { id, month } = params;

  if (!id || !month) {
    return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Missing ?id=...&amp;month=YYYY-MM</div>;
  }

  const { data: prop } = await supabase.from('property_statements').select('*').eq('id', id).single();
  if (!prop) return <div style={{ padding: 40 }}>Not found</div>;

  const { data: reservations } = await supabase.from('reservations').select('*').eq('property_statement_id', id).order('check_out');
  const { data: cleaningEvents } = await supabase.from('cleaning_events').select('*').eq('property_statement_id', id);

  // The monthly ingest sometimes stores the confirmation code as the guest_name
  // when the Guesty PDF doesn't surface a real name. If the user has uploaded
  // a Guesty reservations CSV (or synced via API), the real guest name and
  // channel live in guesty_reservations -- look them up by confirmation_code.
  const confirmationCodes = (reservations || []).map(r => r.confirmation_code).filter(Boolean) as string[];
  const { data: guestyLookups } = confirmationCodes.length > 0
    ? await supabase
        .from('guesty_reservations')
        .select('confirmation_code, guest_name, channel, guesty_channel_id')
        .in('confirmation_code', confirmationCodes)
    : { data: [] as { confirmation_code: string | null; guest_name: string | null; channel: string | null; guesty_channel_id: string | null }[] };
  const guestyByCode = new Map<string, { guest_name: string | null; channel: string | null; guesty_channel_id: string | null }>();
  (guestyLookups || []).forEach(r => { if (r.confirmation_code) guestyByCode.set(r.confirmation_code, r); });

  // A guest_name that looks like a Guesty/VRBO/Airbnb confirmation code is
  // almost certainly a fallback, not a real name. Prefer the CSV-sourced one.
  const looksLikeConfirmationCode = (s: string | null | undefined) =>
    !!s && (/^(GY|HM)[- ]?[A-Za-z0-9]{6,}$/i.test(s.trim()) || s.trim() === '' );

  // Reviews from Guesty (populated via /api/sync-guesty). Query all for this property
  // so we can fall back to lifetime averages when the statement month has none.
  const { data: allReviews } = await supabase
    .from('reviews')
    .select('overall_rating, public_review, guest_name, review_created_at')
    .eq('property_id', prop.property_id)
    .order('review_created_at', { ascending: false });

  // Upcoming reservations from Guesty. Populated by /api/sync-guesty (API
  // sync) or /api/ingest-guesty-csv (manual CSV upload fallback).
  const monthEndStr = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const { data: upcomingDb } = await supabase
    .from('guesty_reservations')
    .select('guest_name, check_in, nights, channel, guesty_channel_id, status')
    .eq('property_id', prop.property_id)
    .gt('check_in', monthEndStr)
    // Accept confirmed / reserved / null. Guesty-API-sourced rows often
    // have status=null (the API response doesn't always include it), and
    // those are still real upcoming bookings.
    .or('status.is.null,status.in.(confirmed,reserved)')
    .order('check_in', { ascending: true })
    // Fetch extra so that after filtering out owner stays we still have
    // 4 real guest bookings to show.
    .limit(20);

  const d = PROPERTY_DETAILS[prop.property_id] || { name: prop.property_name, address: prop.property_name, city: 'Gloucester, MA', owner_full: prop.owner_name || 'Owner', fee_pct: 25, listing_match: '' };
  const numStays = prop.num_stays || (reservations?.length || 0);
  const nightsBooked = prop.nights_booked || 0;
  const totalDays = daysInMonth(month);
  // Occupancy uses nights that actually fall inside the statement month.
  // A guest who checks in Mar 2 and out Apr 2 contributes 1 April night,
  // not 31. (nightsBooked keeps the accounting-total for revenue math.)
  const occupiedNights = (reservations || []).reduce(
    (sum, r) => sum + nightsInMonth(r.check_in, r.check_out, month), 0,
  );
  const occupancy = totalDays > 0 ? Math.round((occupiedNights / totalDays) * 100) : 0;
  const adr = nightsBooked > 0 ? prop.rental_revenue / nightsBooked : 0;
  const [yr, moStr] = month.split('-');
  const mo = monthName(month);
  const cleans = cleaningEvents?.length || numStays;

  // Guest Rating: month-scoped only. Historical averages are misleading on a
  // monthly statement (we don't want a January review padding April's numbers).
  const monthStart = `${month}-01T00:00:00Z`;
  const monthEndIso = new Date(Date.UTC(parseInt(yr), parseInt(moStr), 1)).toISOString();
  const monthReviews = (allReviews || []).filter(r => {
    const t = r.review_created_at;
    return t >= monthStart && t < monthEndIso;
  });
  const monthRatedReviews = monthReviews.filter(r => r.overall_rating != null);
  const rating = monthRatedReviews.length > 0
    ? {
        value: monthRatedReviews.reduce((s, r) => s + (r.overall_rating ?? 0), 0) / monthRatedReviews.length,
        count: monthRatedReviews.length,
      }
    : null;

  // Review snippets: only show reviews from THIS month. 1 review renders
  // long-form; multiple renders as stacked short quotes ("Guest Reviews").
  // Dedupe by normalized review text -- the same review can land in the
  // DB twice when it was fetched from both the Guesty API (source=guesty-api)
  // and the manual CSV upload (source=csv-fallback) with different
  // synthetic IDs. The visible content is identical, so collapse them.
  const reviewPool = monthReviews.filter(r => r.public_review && r.public_review.trim().length > 15);
  const seenReviewText = new Set<string>();
  const uniqueReviewPool = reviewPool.filter(r => {
    const key = (r.public_review || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
    if (seenReviewText.has(key)) return false;
    seenReviewText.add(key);
    return true;
  });
  const selectedReviews = pickReviews(
    uniqueReviewPool.map(r => ({ guest: titleCase(r.guest_name) || 'Guest', review: r.public_review! })),
  );

  // Upcoming bookings from Supabase (guesty_reservations). Populated by either
  // /api/sync-guesty (API path) or /api/ingest-guesty-csv (manual fallback).
  //
  // Owner stays are filtered out: a booking on the Direct/Manual channel
  // whose guest name contains the owner's last name is an owner blocking
  // their own property, not a real rental. Those shouldn't appear in the
  // "On the horizon" display.
  const ownerLast = (PROPERTIES[prop.property_id]?.owner_last || '').toLowerCase();
  const looksLikeOwnerStay = (r: {
    guest_name?: string | null;
    channel?: string | null;
    guesty_channel_id?: string | null;
  }): boolean => {
    if (!ownerLast) return false;
    const ch = (r.guesty_channel_id || r.channel || '').toLowerCase();
    const isDirect = ch.includes('manual') || ch === 'direct';
    if (!isDirect) return false;
    const guest = (r.guest_name || '').toLowerCase();
    // match as a whole-word-ish token so "Bailey" hits "Paul Bailey"
    // but not something like "Baileys Inc" by accident.
    return new RegExp(`\\b${ownerLast}\\b`, 'i').test(guest);
  };

  type UpcomingItem = { guest: string; checkIn: string; nights: number; platform: string };
  // Dedupe: API-source and CSV-source can both land rows for the same
  // reservation. Key on (check_in, guest lowercased) so duplicates collapse.
  const upcomingSeen = new Set<string>();
  const upcoming: UpcomingItem[] = (upcomingDb || [])
    .filter(r => !looksLikeOwnerStay(r))
    .filter(r => {
      const key = `${r.check_in}|${(r.guest_name || '').trim().toLowerCase()}`;
      if (upcomingSeen.has(key)) return false;
      upcomingSeen.add(key);
      return true;
    })
    .slice(0, 4)
    .map(r => ({
      guest: titleCase(r.guest_name) || 'Guest',
      checkIn: r.check_in,
      nights: r.nights ?? 0,
      platform: r.guesty_channel_id || r.channel || 'Direct',
    }));

  // Reservation rows -- enriched from guesty_reservations if the ingest
  // stored a placeholder guest_name or platform.
  const rows = (reservations || []).map(r => {
    const d1 = new Date(r.check_in + 'T00:00:00'), d2 = new Date(r.check_out + 'T00:00:00');
    const nts = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    const lookup = r.confirmation_code ? guestyByCode.get(r.confirmation_code) : undefined;
    const displayName = (looksLikeConfirmationCode(r.guest_name) || !r.guest_name)
      ? (lookup?.guest_name || r.guest_name || 'Guest')
      : r.guest_name;
    const displayPlatform = (!r.platform || r.platform.toLowerCase() === 'unknown')
      ? (lookup?.guesty_channel_id || lookup?.channel || r.platform || 'Direct')
      : r.platform;
    return { ...r, guest_name: displayName, platform: displayPlatform, nts, perNt: nts > 0 ? Math.round((r.adjusted_revenue || r.rental_income) / nts) : 0 };
  });

  // Channel mix (uses enriched platform values from rows)
  const chRev: Record<string, number> = {};
  rows.forEach(r => { const c = chLabel(r.platform); chRev[c] = (chRev[c] || 0) + (r.adjusted_revenue || r.rental_income || 0); });
  const totRev = Object.values(chRev).reduce((a, b) => a + b, 0);
  const mix = Object.entries(chRev).map(([c, v]) => ({ ch: c, pct: totRev > 0 ? (v / totRev) * 100 : 0 })).sort((a, b) => b.pct - a.pct);

  const chColors: Record<string, string> = { Airbnb: '#ff5a5f', VRBO: '#245abc', Booking: '#003580', Direct: '#4a6b3a' };

  // Donut arcs
  let offset = 25;
  const arcs = mix.map(m => { const a = { ...m, da: `${m.pct} ${100 - m.pct}`, off: offset }; offset -= m.pct; return a; });

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
        {/* Floating download chip -- screen only, hidden when printing. */}
        <DownloadPdfChip id={id} month={month} />
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
                  <div className="mini-value">{occupiedNights}<span className="u"> / {totalDays}</span></div>
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
                          <div className="guest">{titleCase(r.guest_name)}</div>
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
                    <div className="insight-sub">{rating.count} review{rating.count === 1 ? '' : 's'} this month</div>
                  </>
                ) : (
                  <>
                    <div className="insight-value">&mdash;</div>
                    <div className="insight-sub">No reviews this month</div>
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
                <div className="insight-sub">{occupiedNights} of {totalDays} nights</div>
              </div>
            </section>

            {/* ── BOTTOM: Upcoming + Review/Note ── */}
            <div className="bottom-two">
              <section>
                <div className="sec-head">
                  <span className="sec-num">03</span>
                  <h2 className="sec-title">On the horizon</h2>
                  <span className="sec-meta">Upcoming reservations</span>
                </div>
                <div className="upcoming-list">
                  {upcoming.length > 0 ? upcoming.map((b, i) => {
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
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', padding: '6px 0' }}>No upcoming bookings on file</div>
                  )}
                </div>
              </section>

              {selectedReviews.length > 0 && (
                <section className="note">
                  <div className="note-kicker">
                    {selectedReviews.length === 1 ? 'Guest Review' : 'Guest Reviews'}
                  </div>
                  <div className="note-body">
                    {selectedReviews.length === 1 ? (
                      <p>&ldquo;{selectedReviews[0].snippet}&rdquo;</p>
                    ) : (
                      selectedReviews.map((r, i) => (
                        <p key={i} className="note-quote">
                          &ldquo;{r.snippet}&rdquo;
                          <span className="note-quote-attr"> &mdash; {r.guest}</span>
                        </p>
                      ))
                    )}
                  </div>
                  {selectedReviews.length === 1 && (
                    <div className="note-sig">
                      <div className="avatar">{selectedReviews[0].guest.charAt(0)}</div>
                      <div>
                        <div className="note-sig-name">{selectedReviews[0].guest}</div>
                        <div className="note-sig-title">5-star guest</div>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* ── FOOTER ── */}
            <footer className="footer">
              <div>Rising Tide &middot; Gloucester, MA</div>
              <div className="center">&ldquo;We care for your home as if it were our own.&rdquo;</div>
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
.note-quote { margin:0 0 8px !important; padding-left:10px; border-left:2px solid var(--rule); font-size:11.5px; line-height:1.45; }
.note-quote:last-child { margin-bottom:0 !important; }
.note-quote-attr { color:var(--ink-4); font-size:10px; font-style:italic; font-family:var(--sans); letter-spacing:.02em; }
.note-sig { margin-top:6px; display:flex; align-items:center; gap:8px; padding-top:6px; border-top:1px dotted var(--rule); }
.note-sig .avatar { width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,var(--tide),var(--tide-deep)); color:var(--paper); display:flex; align-items:center; justify-content:center; font-family:var(--serif); font-size:11px; font-weight:500; }
.note-sig-name { font-family:var(--serif); font-size:12px; font-weight:500; }
.note-sig-title { font-size:9px; color:var(--ink-3); }

/* FOOTER */
.footer { margin-top:auto; padding-top:12px; border-top:1px solid var(--ink); display:grid; grid-template-columns:1fr auto 1fr; gap:16px; align-items:center; font-size:9px; color:var(--ink-3); text-transform:uppercase; letter-spacing:.15em; }
.footer .center { text-align:center; font-family:var(--serif); font-style:italic; font-size:12px; color:var(--ink); text-transform:none; letter-spacing:0; }
.footer .right { text-align:right; }

/* Floating download chip (screen only) */
.download-chip {
  position:fixed; top:20px; right:20px; z-index:20;
  display:inline-flex; align-items:center; gap:8px;
  background:var(--ink); color:var(--paper);
  padding:9px 14px;
  font-family:var(--sans); font-size:11px; font-weight:600;
  letter-spacing:.14em; text-transform:uppercase;
  text-decoration:none;
  box-shadow:0 10px 24px -8px rgba(30,46,52,.3);
  transition:transform .15s, box-shadow .15s;
}
.download-chip:hover { transform:translateY(-1px); box-shadow:0 14px 30px -8px rgba(30,46,52,.35); }

/* PRINT — compact the layout so dense statements (many reservations or
   cleaning events) still land on one page. Adjustments only trigger in
   print/PDF output; the on-screen editorial feel stays unchanged. */
@media print {
  body { background:white; }
  .canvas { margin:0; max-width:none; padding:0; }
  .sheet {
    box-shadow:none; border:none; width:100%; min-height:auto;
    padding:.3in .35in .22in; /* tightened from .35in .4in */
  }
  .download-chip { display:none; }
  @page { size:letter; margin:0; }

  /* Masthead + header: drop the vertical airiness */
  .masthead { padding-bottom:8px; }
  .header-row { padding:12px 0 10px; }
  .display { font-size:42px; } /* was 50px */

  /* Addressee + hero: tighter verticals */
  .addressee { padding:10px 0; }
  .hero { padding:12px 0 10px; }
  .payout-amount { font-size:46px; } /* was 54px */

  /* Section heads: tighter */
  .sec-head { padding:10px 0 6px; }

  /* Reservations + cleaning tables: compact rows so ~12 rows still fit */
  .res-table thead th { padding:5px; }
  .res-table tbody td { padding:5px 5px; font-size:11px; }
  .res-table tbody td.num { font-size:12px; }
  .guest { font-size:12px; }
  .stay-dates { font-size:11px; }

  /* Financials: tighter row padding */
  .fin-table td { padding:5px 0 4px; font-size:11px; }
  .fin-table td.amt { font-size:12px; }
  .fin-table tr.total td { padding:6px 0 4px; font-size:12px; }
  .fin-table tr.total td.amt { font-size:14px; }

  /* Insights + bottom: small reclaim */
  .insights .insight { padding:9px 12px; }
  .insight-value { font-size:17px; }
  .bottom-two { padding:12px 0 8px; }
  .upcoming-item { padding:4px 0; }
  .note { padding:10px 12px; }
  .note-body { font-size:11px; line-height:1.4; }

  /* Keep tables from splitting rows across pages if by chance two pages render */
  .res-table tr, .upcoming-item, .fin-table tr { page-break-inside:avoid; }
}
`;
