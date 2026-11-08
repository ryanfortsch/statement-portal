/**
 * Cleaning reviews, the rules (2026-11-07). Pure: no imports from the app, so
 * a test, the Stepper (a client component) and the server writer all read the
 * same thresholds and the same text.
 *
 * The inspector gives the clean they walked behind 1 to 5 stars at the end
 * of the walk. Five stars is stored and nothing more. FLAG_MAX or fewer also
 * asks what was off and for photos, and files one note to the crew as a
 * pending card on the Team inbox. Only Approve sends it (cleaning-reviews.ts).
 *
 * The note is composed here, deterministically, in the crew's language and in
 * English: the template is ours, the operator's reason inside it is rendered
 * by the same model pass the schedule's special-instructions line gets
 * (cleaner-note.ts), falling back to the words as typed. One language per
 * text (Dotti, 2026-09-26): the Portuguese goes to a Portuguese recipient,
 * the English to an English one, never both. No sign-off name: a crew text
 * is from Rising Tide, not from a person.
 */

/** A clean at or below this many stars files a note for the crew. */
export const CLEANING_FLAG_MAX = 4;

export const CLEANING_STARS = [1, 2, 3, 4, 5] as const;
export type CleaningStars = (typeof CLEANING_STARS)[number];

export type NoticeStatus = 'none' | 'pending' | 'approving' | 'sent' | 'handled';

/** Mark handled's reasons on the card: what the operator did instead. */
export const CLEANING_HANDLED_REASONS = ['Spoke with the crew', 'Not the crew', 'Rated by mistake'] as const;

/** Whether a rating files a note to the crew. */
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

export type NoticeInput = {
  /** The home's internal name: "21 Horton". Never translated. */
  home: string;
  /** Eastern calendar day of the walk, YYYY-MM-DD. */
  walkDate: string;
  stars: number;
  /** The reason in each language; empty when the inspector typed nothing. */
  reasonPt: string;
  reasonEn: string;
  photoUrls: readonly string[];
};

function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(cap) ? cap : `${cap}.`;
}

/**
 * The note in both languages. The structure is fixed so the crew always reads
 * the same shape: which home, which day, how many stars, what was off, the
 * photos. Nothing in it names the inspector.
 */
export function composeCleaningNotice(input: NoticeInput): { pt: string; en: string } {
  const stars = Math.max(1, Math.min(5, Math.round(input.stars)));
  const photos = input.photoUrls.filter(Boolean);
  const pt = [
    `Oi! Sobre a limpeza da ${input.home} (${ptDay(input.walkDate)}): avaliamos ${stars} de 5.`,
    sentence(input.reasonPt),
    photos.length ? `Fotos: ${photos.join(' ')}` : '',
    'Obrigada!',
  ]
    .filter(Boolean)
    .join(' ');
  const en = [
    `Hi! About the clean at ${input.home} (${enDay(input.walkDate)}): we rated it ${stars} of 5.`,
    sentence(input.reasonEn),
    photos.length ? `Photos: ${photos.join(' ')}` : '',
    'Thank you!',
  ]
    .filter(Boolean)
    .join(' ');
  return { pt, en };
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

/** The one word a row prints for where its note stands. */
export function noticeWord(status: NoticeStatus, crew = 'Crew'): string | null {
  switch (status) {
    case 'pending':
    case 'approving':
      return 'Waiting on approval';
    case 'sent':
      return `${crew} texted`;
    case 'handled':
      return 'Handled';
    default:
      return null;
  }
}

/** What the Team inbox card carries. Serializable: it crosses to the client. */
export type CleaningReviewCardData = {
  id: string;
  status: 'pending' | 'approving';
  /** An approve that started more than five minutes ago and never finished. */
  stuck: boolean;
  inspectorName: string;
  propertyId: string;
  propertyName: string;
  walkDate: string;
  stars: number;
  reason: string;
  photoUrls: string[];
  pt: string;
  en: string;
  translated: boolean;
  createdAt: string;
  ageMinutes: number;
  lastError: string | null;
  /** The schedule recipients this would text, by name, so the operator sees who. */
  recipients: string[];
};

export const STUCK_CLAIM_MS = 5 * 60_000;
