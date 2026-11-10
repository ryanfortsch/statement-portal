/**
 * The Tuesday brief as one printable HTML document (weekly-brief.ts has the
 * model). Every page is a `.sheet` at US Letter; weekly-brief-pdf.ts prints
 * the document straight from this string and shrinks any sheet that runs
 * long so each one lands on its own page.
 *
 * Pure: a string in, a string out, every value escaped. White paper, not
 * the statement's warm tone, because this one is printed at home.
 */
import {
  longDay,
  monthDay,
  shortDay,
  starWords,
  type BriefDay,
  type CheckIn,
  type FeedbackItem,
  type FeedbackPage,
  type HomePage,
  type WeeklyBrief,
} from './weekly-brief.ts';
import { SCORECARD_DUE, type ScorecardTile } from './ops-scorecard.ts';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { font-family: 'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1e2e34; font-size: 11.5px; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 816px; padding: 44px 54px 40px; break-after: page; page-break-after: always; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
.serif { font-family: 'Fraunces', Georgia, serif; }
.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.mast { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #1e2e34; padding-bottom: 10px; margin-bottom: 22px; font-size: 9px; letter-spacing: .22em; text-transform: uppercase; color: #5b6a70; }
h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 300; font-size: 34px; line-height: 1.05; letter-spacing: -0.02em; margin: 0; }
.sub { margin-top: 5px; font-size: 12px; color: #5b6a70; }
.section { margin-top: 24px; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid #1e2e34; padding-top: 9px; margin-bottom: 10px; }
.section-title { font-size: 10px; letter-spacing: .2em; text-transform: uppercase; font-weight: 700; }
.section-note { font-size: 10.5px; color: #7a878c; font-style: italic; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.tile { border: 1px solid #d9dcdc; padding: 12px 14px 11px; }
.tile-label { font-size: 9px; letter-spacing: .18em; text-transform: uppercase; color: #5b6a70; font-weight: 600; }
.tile-value { font-family: 'Fraunces', Georgia, serif; font-size: 26px; font-weight: 400; margin-top: 4px; line-height: 1.1; }
.tile-goal { font-size: 10.5px; color: #5b6a70; margin-top: 2px; }
.tile-detail { font-size: 10.5px; color: #7a878c; margin-top: 5px; }
.state { display: inline-block; margin-top: 7px; font-size: 8.5px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; }
.state-met { color: #2f6f4f; }
.state-off { color: #c85a3a; }
.state-unknown, .state-idle { color: #7a878c; }
.day { display: grid; grid-template-columns: 92px 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px solid #ecedec; }
.day-name { font-size: 11px; font-weight: 600; }
.day-count { font-size: 9.5px; color: #7a878c; margin-top: 1px; }
.ci { padding: 1px 0; }
.ci-home { font-weight: 600; }
.ci-rest { color: #44555b; }
.ci-turn { font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: #c85a3a; margin-left: 6px; }
.none { color: #9aa4a7; font-style: italic; }
.index { column-count: 2; column-gap: 28px; }
.ix { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; border-bottom: 1px dotted #d9dcdc; break-inside: avoid; }
.ix-counts { color: #5b6a70; white-space: nowrap; }
.ix-high { color: #c85a3a; font-weight: 600; }
.ix-group { font-size: 8.5px; letter-spacing: .18em; text-transform: uppercase; font-weight: 700; color: #5b6a70; margin: 12px 0 4px; }
.ix-group:first-child { margin-top: 0; }
.quiet { margin-top: 12px; font-size: 10.5px; color: #7a878c; }
.headline { font-family: 'Fraunces', Georgia, serif; font-size: 14.5px; line-height: 1.45; margin-top: 12px; color: #2b3c42; }
.facts { margin-top: 8px; font-size: 10.5px; color: #5b6a70; }
.row { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; padding: 5px 0; border-bottom: 1px solid #ecedec; break-inside: avoid; }
.row-n { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; color: #7a878c; padding-top: 2px; }
.row-title { font-size: 12.5px; font-weight: 500; }
.row-detail { font-size: 11px; color: #44555b; margin-top: 1px; }
.row-meta { font-size: 9.5px; color: #7a878c; margin-top: 2px; letter-spacing: .02em; }
.row-tags { text-align: right; white-space: nowrap; padding-top: 2px; }
.tag { font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: #7a878c; }
.tag-high { color: #c85a3a; }
.tag-low { color: #9aa4a7; }
.more { padding-top: 8px; font-size: 10.5px; color: #7a878c; font-style: italic; }
.bring { padding: 8px 0; font-size: 11.5px; }
.note { padding: 5px 0; border-bottom: 1px solid #ecedec; break-inside: avoid; }
.note-title { font-weight: 600; }
.note-body { color: #44555b; font-size: 11px; }
.note-date { color: #9aa4a7; font-size: 9.5px; }
.tally { margin-top: 8px; font-size: 10.5px; color: #5b6a70; }
.fb { padding: 8px 0 9px; border-bottom: 1px solid #ecedec; break-inside: avoid; }
.fb-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.fb-home { font-size: 12.5px; font-weight: 600; }
.fb-who { color: #44555b; }
.fb-stars { font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; white-space: nowrap; color: #7a878c; }
.fb-stars-low { color: #c85a3a; }
.fb-meta { font-size: 9.5px; color: #7a878c; margin-top: 1px; letter-spacing: .02em; }
.fb-text { font-family: 'Fraunces', Georgia, serif; font-size: 12px; line-height: 1.45; color: #2b3c42; margin-top: 4px; }
.fb-label { font-size: 8.5px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; color: #5b6a70; margin-top: 6px; }
.fb-private { font-size: 11px; color: #44555b; margin-top: 1px; }
.foot { margin-top: 22px; font-size: 9px; letter-spacing: .2em; text-transform: uppercase; color: #9aa4a7; }
`;

const STATE_WORDS: Record<ScorecardTile['state'], string> = {
  met: 'On goal',
  off: 'Not yet',
  unknown: 'Could not read',
  idle: 'Nothing to measure',
};

function tileHtml(t: ScorecardTile): string {
  return `<div class="tile">
    <div class="tile-label">${esc(t.label)}</div>
    <div class="tile-value">${esc(t.value)}</div>
    <div class="tile-goal">${esc(t.goal)}</div>
    ${t.detail ? `<div class="tile-detail">${esc(t.detail)}</div>` : ''}
    <div class="state state-${esc(t.state)}">${esc(STATE_WORDS[t.state])}</div>
  </div>`;
}

/** "Hammond guest · 3 nights to Fri · 4 guests · Airbnb". */
export function checkInLine(c: CheckIn): string {
  const bits: string[] = [];
  if (c.guest) bits.push(c.guest);
  if (c.nights > 0) bits.push(`${c.nights} night${c.nights === 1 ? '' : 's'} to ${weekday(c.checkOut)}`);
  if (c.guests) bits.push(`${c.guests} guest${c.guests === 1 ? '' : 's'}`);
  if (c.channel) bits.push(c.channel);
  return bits.join(' · ');
}

function dayHtml(d: BriefDay): string {
  const n = d.checkIns.length;
  const list = n
    ? d.checkIns
        .map(
          (c) => `<div class="ci"><span class="ci-home">${esc(c.home)}</span>${checkInLine(c) ? ` <span class="ci-rest">· ${esc(checkInLine(c))}</span>` : ''}${c.sameDayTurn ? '<span class="ci-turn">Same-day turn</span>' : ''}</div>`,
        )
        .join('')
    : '<div class="none">No check-ins</div>';
  return `<div class="day">
    <div><div class="day-name">${esc(shortDay(d.date))}</div>${n ? `<div class="day-count">${n} check-in${n === 1 ? '' : 's'}</div>` : ''}</div>
    <div>${list}</div>
  </div>`;
}

function pageOne(b: WeeklyBrief): string {
  const total = b.days.reduce((n, d) => n + d.checkIns.length, 0);
  const tiles = b.scorecard && b.scorecard.length
    ? `<div class="tiles">${b.scorecard.map(tileHtml).join('')}</div>`
    : '<div class="none">The goals could not be read this morning.</div>';
  const fb = b.feedback;
  const below = fb.belowFive.length + fb.moreBelowFive;
  const feedbackIx = `<div class="ix"><span>Guest feedback</span><span class="ix-counts">${
    fb.unreadable ? 'could not read'
    : below ? `<span class="ix-high">${below} below five</span>`
    : `${fb.total} review${fb.total === 1 ? '' : 's'}`
  } · p.2</span></div>`;
  const ix = (p: HomePage, i: number) =>
    `<div class="ix"><span>${esc(p.home.name)}</span><span class="ix-counts">${p.openCount} open${p.highCount ? ` · <span class="ix-high">${p.highCount} high</span>` : ''}${p.notes.length ? ` · ${p.notes.length} flagged` : ''} · p.${i + FIRST_HOME_PAGE}</span></div>`;
  const arriving = b.pages.slice(0, b.arrivingPages).map((p, i) => ix(p, i)).join('');
  const rest = b.pages.slice(b.arrivingPages).map((p, i) => ix(p, i + b.arrivingPages)).join('');
  const index = `<div class="index">${feedbackIx}</div>${
    arriving ? `<div class="ix-group">Check-ins this week</div><div class="index">${arriving}</div>` : ''
  }${rest ? `<div class="ix-group">${arriving ? 'The rest of the homes' : 'The homes'}</div><div class="index">${rest}</div>` : ''}${
    b.pages.length ? '' : '<div class="none">No open work at any home.</div>'
  }`;
  return `<section class="sheet">
    <div class="mast"><span>Rising Tide · Helm weekly</span><span>${esc(longDay(b.today))}</span></div>
    <h1>The week of ${esc(monthDay(b.window.from))}</h1>
    <div class="sub">${esc(shortDay(b.window.from))} through ${esc(shortDay(b.window.to))}</div>

    <div class="section">
      <div class="section-head"><span class="section-title">Operations goals</span><span class="section-note">Delaney's three, measured this morning · due ${esc(monthDay(SCORECARD_DUE))}, ${esc(SCORECARD_DUE.slice(0, 4))}</span></div>
      ${tiles}
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">Check-ins</span><span class="section-note">${total} this week</span></div>
      ${b.days.map(dayHtml).join('')}
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">Homes inside</span><span class="section-note">one page each, work in priority order</span></div>
      ${index}
      ${b.quietHomes.length ? `<div class="quiet">Nothing open: ${esc(b.quietHomes.join(', '))}.</div>` : ''}
    </div>
  </section>`;
}

function feedbackItemHtml(i: FeedbackItem): string {
  const who = [i.guest, i.channel].filter(Boolean).join(' · ');
  const meta = [`landed ${i.landed}`, ...i.lowCategories, i.slip].filter(Boolean).join(' · ');
  const low = i.rating !== null && i.rating < 5;
  return `<div class="fb">
    <div class="fb-head">
      <div><span class="fb-home">${esc(i.home)}</span>${who ? ` <span class="fb-who">· ${esc(who)}</span>` : ''}</div>
      <div class="fb-stars${low ? ' fb-stars-low' : ''}">${i.rating === null ? 'No rating' : esc(starWords(i.rating))}</div>
    </div>
    <div class="fb-meta">${esc(meta)}</div>
    ${i.publicText ? `<div class="fb-text">${esc(i.publicText)}</div>` : ''}
    ${i.privateText ? `<div class="fb-label">${esc(i.privateLabel)}</div><div class="fb-private">${esc(i.privateText)}</div>` : ''}
  </div>`;
}

function feedbackHtml(f: FeedbackPage, today: string): string {
  const tally = f.unreadable
    ? 'The reviews could not be read this morning. The Reviews tab has them.'
    : f.total
      ? `${f.total} review${f.total === 1 ? '' : 's'} landed · ${f.fiveStar} at five stars${f.avg !== null ? ` · average ${f.avg.toFixed(2)}` : ''}`
      : 'No rated review landed this week.';
  const below = f.unreadable
    ? ''
    : `<div class="section">
        <div class="section-head"><span class="section-title">Below five stars</span><span class="section-note">lowest first</span></div>
        ${f.belowFive.length ? f.belowFive.map(feedbackItemHtml).join('') : '<div class="none">No review below five stars this week.</div>'}
        ${f.moreBelowFive ? `<div class="more">${f.moreBelowFive} more on the Reviews tab.</div>` : ''}
      </div>`;
  const notes = f.notes.length || f.moreNotes
    ? `<div class="section">
        <div class="section-head"><span class="section-title">Five stars, with a note to us</span><span class="section-note">a private note or a category below five</span></div>
        ${f.notes.map(feedbackItemHtml).join('')}
        ${f.moreNotes ? `<div class="more">${f.moreNotes} more on the Reviews tab.</div>` : ''}
      </div>`
    : '';
  return `<section class="sheet">
    <div class="mast"><span>Rising Tide · Helm weekly · ${esc(shortDay(today))}</span><span>Page 2</span></div>
    <h1>What guests told us</h1>
    <div class="sub">Reviews that landed ${esc(shortDay(f.from))} through ${esc(shortDay(f.to))}</div>
    <div class="tally">${esc(tally)}</div>
    ${below}
    ${notes}
  </section>`;
}

/** Page one is the week, page two the guests' feedback; the homes follow. */
export const FIRST_HOME_PAGE = 3;

function homeHtml(p: HomePage, pageNumber: number, today: string): string {
  const facts: string[] = [`${p.openCount} open`];
  if (p.highCount) facts.push(`${p.highCount} high`);
  if (p.checkIns.length) {
    facts.push(
      `check-in${p.checkIns.length === 1 ? '' : 's'} ${p.checkIns
        .map((c) => {
          const day = c.date === today ? 'today' : weekday(c.date);
          return c.guest ? `${day} (${c.guest})` : day;
        })
        .join(', ')}`,
    );
  } else {
    facts.push('no check-in this week');
  }

  const rows = p.rows
    .map(
      (r) => `<div class="row">
      <div class="row-n">${r.number}</div>
      <div>
        <div class="row-title">${esc(r.title)}</div>
        ${r.detail ? `<div class="row-detail">${esc(r.detail)}</div>` : ''}
        <div class="row-meta">${esc([r.laneLabel, r.meta].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="row-tags">${r.priority !== 'normal' ? `<div class="tag tag-${r.priority}">${r.priority === 'high' ? 'High' : 'Low'}</div>` : ''}</div>
    </div>`,
    )
    .join('');

  const work = p.rows.length
    ? `<div class="section">
        <div class="section-head"><span class="section-title">Work, in priority order</span><span class="section-note">high first, then overdue, then this week, then oldest</span></div>
        ${rows}
        ${p.moreRows ? `<div class="more">${p.moreRows} more, lower in the order, on the Work board.</div>` : ''}
      </div>`
    : '';
  const bring = p.bring.length
    ? `<div class="section">
        <div class="section-head"><span class="section-title">Bring</span><span class="section-note">${p.bring.length} supply item${p.bring.length === 1 ? '' : 's'}</span></div>
        <div class="bring">${esc(p.bring.join(', '))}</div>
      </div>`
    : '';
  const notes = p.notes.length
    ? `<div class="section">
        <div class="section-head"><span class="section-title">Flagged at the house</span><span class="section-note">open notes</span></div>
        ${p.notes
          .map(
            (n) => `<div class="note"><span class="note-title">${esc(n.title)}</span> <span class="note-date">· ${esc(n.opened)}</span>${n.body ? `<div class="note-body">${esc(n.body)}</div>` : ''}</div>`,
          )
          .join('')}
        ${p.moreNotes ? `<div class="more">${p.moreNotes} more on the property page.</div>` : ''}
      </div>`
    : '';

  const past = p.pastAppointments.length
    ? `<div class="section">
        <div class="section-head"><span class="section-title">Past dates, to close out</span><span class="section-note">the day has gone; mark it done or rebook on the Work board</span></div>
        ${p.pastAppointments.map((a) => `<div class="note"><span class="note-title">${esc(a.title)}</span> <span class="note-date">· ${esc(a.date)}</span></div>`).join('')}
      </div>`
    : '';

  const sub = [p.home.address, p.home.owner_last].filter((s) => s && s.trim()).join(' · ');
  return `<section class="sheet">
    <div class="mast"><span>Rising Tide · Helm weekly · ${esc(shortDay(today))}</span><span>Page ${pageNumber}</span></div>
    <h1>${esc(p.home.name)}</h1>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
    ${p.headline ? `<div class="headline">${esc(p.headline)}</div>` : ''}
    <div class="facts">${esc(facts.join(' · '))}</div>
    ${notes}
    ${work}
    ${bring}
    ${past}
  </section>`;
}

/** "Thu". */
function weekday(iso: string): string {
  return shortDay(iso).split(',')[0];
}

export function weeklyBriefHtml(b: WeeklyBrief): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(`Helm weekly ${b.today}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
<style>${STYLE}</style>
</head>
<body>
${pageOne(b)}
${feedbackHtml(b.feedback, b.today)}
${b.pages.map((p, i) => homeHtml(p, i + FIRST_HOME_PAGE, b.today)).join('\n')}
</body>
</html>`;
}
