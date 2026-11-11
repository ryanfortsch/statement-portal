/**
 * Cleaning reviews, the rules (2026-11-07; weekly email 2026-11-10). Pure: no
 * imports from the app, so a test, the Stepper (a client component) and the
 * server all read the same thresholds and the same text.
 *
 * The inspector gives the clean they walked behind 1 to 5 stars at the end
 * of the walk. FLAG_MAX or fewer also asks what was off and for photos.
 * Nothing goes to the crew from the walk. Every Friday the week's ratings
 * become ONE email to the crew (Dotti, 2026-11-10: batch it, send it on
 * Friday, by email), drafted by the cron and sent only on the operator's
 * Approve (cleaning-review-report.ts).
 *
 * The email is composed here, deterministically, in the crew's language and
 * in English: the template is ours, the inspector's reasons inside it are
 * rendered by the same model pass the schedule's special-instructions line
 * gets (cleaner-note.ts), falling back to the words as typed. One language
 * per message (Dotti, 2026-09-26): a Portuguese reader gets the Portuguese,
 * an English one the English. No sign-off name: it is from Rising Tide, not
 * from a person, and it never names the inspector.
 */

/** A clean at or below this many stars asks what was off, and its reason
 *  and photos print in the weekly email. */
export const CLEANING_FLAG_MAX = 4;

export const CLEANING_STARS = [1, 2, 3, 4, 5] as const;
export type CleaningStars = (typeof CLEANING_STARS)[number];

export type NoticeStatus = 'none' | 'pending' | 'approving' | 'sent' | 'handled';

/** Mark handled's reasons on the weekly card: what the operator did instead. */
export const CLEANING_HANDLED_REASONS = ['Spoke with the crew', 'Skip this week'] as const;

/** Whether a rating is flagged: it carries a reason and photos. */
export function needsCleaningNotice(stars: number): boolean {
  return Number.isInteger(stars) && stars >= 1 && stars <= CLEANING_FLAG_MAX;
}

/** 1..5, or null for anything else (an old client, a tampered form). */
export function parseStars(value: unknown): CleaningStars | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as CleaningStars) : null;
}

/** "★★★☆☆" for a list; the Stepper and the cards draw their own. */
export function starsGlyphs(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

const PT_DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateParts(ymd: string): { dow: number; d: number; m: number } | null {
  const s = String(ymd ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return { dow: d.getUTCDay(), d: d.getUTCDate(), m: d.getUTCMonth() };
}

/** "qui, 6/11": the day as the crew writes it. */
export function ptDay(ymd: string): string {
  const p = dateParts(ymd);
  return p ? `${PT_DAYS[p.dow]}, ${p.d}/${p.m + 1}` : ymd;
}

/** "Thu, Nov 6". */
export function enDay(ymd: string): string {
  const p = dateParts(ymd);
  return p ? `${EN_DAYS[p.dow]}, ${EN_MONTHS[p.m]} ${p.d}` : ymd;
}

/** "6/11": a day as the crew writes it, without the weekday. */
export function ptShort(ymd: string): string {
  const p = dateParts(ymd);
  return p ? `${p.d}/${p.m + 1}` : ymd;
}

/** "Nov 6". */
export function enShort(ymd: string): string {
  const p = dateParts(ymd);
  return p ? `${EN_MONTHS[p.m]} ${p.d}` : ymd;
}

/** One rated clean, as the weekly email prints it. */
export type WeeklyClean = {
  /** The home's internal name: "21 Horton". Never translated. */
  home: string;
  /** Eastern calendar day of the walk, YYYY-MM-DD. */
  walkDate: string;
  stars: number;
  /** The reason in each language; empty when none was typed. */
  reasonPt: string;
  reasonEn: string;
  photoUrls: readonly string[];
};

export type WeeklyEmailInput = {
  /** The first and last walk days the email covers, YYYY-MM-DD. */
  firstWalk: string;
  weekEnd: string;
  cleans: readonly WeeklyClean[];
};

export type WeeklyEmail = { subjectPt: string; subjectEn: string; pt: string; en: string };

function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(cap) ? cap : `${cap}.`;
}

/** Walk order, then the home, so the email reads as the week went. */
function byWalk(a: WeeklyClean, b: WeeklyClean): number {
  return a.walkDate === b.walkDate ? a.home.localeCompare(b.home) : a.walkDate < b.walkDate ? -1 : 1;
}

/** The week's average to one decimal, the way each reader writes it. */
export function weeklyAverage(cleans: readonly Pick<WeeklyClean, 'stars'>[]): number | null {
  if (cleans.length === 0) return null;
  return Math.round((cleans.reduce((s, c) => s + c.stars, 0) / cleans.length) * 10) / 10;
}

/**
 * The week in both languages. One line per clean (the stars, the home, the
 * day); a clean with a note adds it and its photos under its line (at four
 * or fewer the note is what was off). The average and the count lead, so the grade reads first.
 */
export function composeWeeklyEmail(input: WeeklyEmailInput): WeeklyEmail {
  const cleans = [...input.cleans].sort(byWalk);
  const avg = weeklyAverage(cleans);
  const n = cleans.length;
  const range = (f: (d: string) => string, to: string) =>
    input.firstWalk === input.weekEnd ? f(input.weekEnd) : `${f(input.firstWalk)} ${to} ${f(input.weekEnd)}`;

  const block = (c: WeeklyClean, lang: 'pt' | 'en'): string => {
    const head = `${starsGlyphs(c.stars)}  ${c.home} · ${lang === 'pt' ? ptDay(c.walkDate) : enDay(c.walkDate)}`;
    // A note and photos print whenever the inspector wrote one, at any
    // rating: a five-star clean can carry a heads-up too (2026-11-10).
    const photos = c.photoUrls.filter(Boolean);
    const said = (lang === 'pt' ? c.reasonPt : c.reasonEn).trim();
    if (!said && photos.length === 0) return head;
    const lines = [
      head,
      sentence(lang === 'pt' ? c.reasonPt : c.reasonEn),
      photos.length ? `${lang === 'pt' ? 'Fotos' : 'Photos'}: ${photos.join(' ')}` : '',
    ].filter(Boolean);
    // A clean with a note stands apart, so its note reads with its home.
    return `\n${lines.join('\n')}\n`;
  };
  const tidy = (t: string) => t.replace(/\n{3,}/g, '\n\n').trim();

  const rangePt = range(ptShort, 'a');
  const rangeEn = range(enShort, 'to');
  const avgPt = avg == null ? '' : `Média ${avg.toFixed(1).replace('.', ',')} de 5 em ${n} ${n === 1 ? 'limpeza' : 'limpezas'}.`;
  const avgEn = avg == null ? '' : `Average ${avg.toFixed(1)} of 5 across ${n} ${n === 1 ? 'clean' : 'cleans'}.`;

  const pt = tidy([
    `Oi! Como foram as limpezas de ${rangePt}:`,
    '',
    avgPt,
    '',
    cleans.map((c) => block(c, 'pt')).join('\n'),
    '',
    'Obrigada!',
  ].join('\n'));
  const en = tidy([
    `Hi! How the cleans went, ${rangeEn}:`,
    '',
    avgEn,
    '',
    cleans.map((c) => block(c, 'en')).join('\n'),
    '',
    'Thank you!',
  ].join('\n'));
  return {
    subjectPt: `Avaliação das limpezas · ${rangePt}`,
    subjectEn: `Cleaning review · ${rangeEn}`,
    pt,
    en,
  };
}

/** The last walk day a report drafted on `today` covers: the day before.
 *  Friday's email covers through Thursday, so a Friday walk is next week's. */
export function reportWeekEnd(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The one row shape every reader uses. */
export type CleaningReviewRow = {
  id: string;
  inspection_id: string;
  property_id: string;
  inspector_email: string;
  inspector_name: string;
  walk_date: string;
  stars: number;
  reason: string | null;
  photo_urls: string[];
  notice_status: NoticeStatus;
  notice_pt: string | null;
  notice_en: string | null;
  notice_translated: boolean;
  claimed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  handled_reason: string | null;
  sent_at: string | null;
  sent_log: unknown;
  last_error: string | null;
  /** The weekly email this rating rode in; null until Friday's draft. */
  report_id?: string | null;
  /** That email's status, when the reader joined it. */
  report_status?: ReportStatus | null;
  created_at: string;
  updated_at: string;
};

export type CleaningSummary = {
  /** Walks rated in the window. */
  rated: number;
  /** Average stars, null with none. */
  avg: number | null;
  /** Rated at or below the flag line. */
  flagged: number;
};

/** The stat strip's numbers over a set of rows. */
export function summarizeCleaningReviews(rows: ReadonlyArray<Pick<CleaningReviewRow, 'stars' | 'walk_date'>>, sinceYmd?: string): CleaningSummary {
  const inWindow = sinceYmd ? rows.filter((r) => r.walk_date >= sinceYmd) : rows.slice();
  const rated = inWindow.length;
  const sum = inWindow.reduce((s, r) => s + r.stars, 0);
  return {
    rated,
    avg: rated ? Math.round((sum / rated) * 10) / 10 : null,
    flagged: inWindow.filter((r) => needsCleaningNotice(r.stars)).length,
  };
}

export type ReportStatus = 'pending' | 'approving' | 'sent' | 'handled';

/** The one word a rated walk prints for where it stands. A rating not yet in
 *  a report rides in Friday's email; once drafted, the report says the rest.
 *  A per-walk text from before the weekly email keeps its own word. */
export function noticeWord(status: NoticeStatus, crew = 'Crew', report?: ReportStatus | null): string {
  if (status === 'sent') return `${crew} texted`;
  switch (report) {
    case 'sent':
      return `${crew} emailed`;
    case 'handled':
      return 'Not sent';
    case 'pending':
    case 'approving':
      return 'Waiting on approval';
    default:
      return "In Friday's email";
  }
}

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** The email's text as plain HTML: escaped, line breaks kept, photo links
 *  clickable as 1, 2, 3 (a line of raw storage URLs reads as noise), the stars in the signal color. Nothing else is styled, so the
 *  operator's edit reads in the inbox exactly as it read on the card. */
export function weeklyEmailHtml(text: string): string {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => HTML_ESC[c]);
  const lines = text.split('\n').map((line) => {
    let out = esc(line).replace(/https?:\/\/[^\s<]+/g, (u, i, all) => {
      const n = (all.slice(0, i).match(/https?:\/\//g) ?? []).length + 1;
      return `<a href="${u}" style="color:#1f5e6b">${n}</a>`;
    });
    out = out.replace(/^([★☆]{5})/, '<span style="color:#c85a3a;letter-spacing:1px">$1</span>');
    return out;
  });
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1e2e34">${lines.join('<br>')}</div>`;
}

/** One clean on the weekly card. */
export type CleaningReportClean = {
  id: string;
  propertyName: string;
  inspectorName: string;
  walkDate: string;
  stars: number;
  reason: string;
  photoUrls: string[];
};

/** What the Team inbox card carries: one week's email. Serializable. */
export type CleaningReviewCardData = {
  id: string;
  status: 'pending' | 'approving';
  /** An approve that started more than five minutes ago and never finished. */
  stuck: boolean;
  firstWalk: string;
  weekEnd: string;
  average: number | null;
  cleans: CleaningReportClean[];
  /** The email in the To reader's language, and its English check (only
   *  when that is Portuguese). */
  language: 'pt' | 'en';
  subject: string;
  text: string;
  english: string;
  edited: boolean;
  createdAt: string;
  ageMinutes: number;
  lastError: string | null;
  /** Who it would reach, "Name <address>", so the operator sees where. */
  recipients: string[];
  /** Enabled crew on the schedule list with no email on file. */
  missingEmail: string[];
  /** Who rides on copy, by first name (the cleaning_review duty). */
  copy: string[];
};

export const STUCK_CLAIM_MS = 5 * 60_000;
