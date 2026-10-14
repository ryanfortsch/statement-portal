/**
 * The month-close handoff, the pure half.
 *
 * Three days before the monthly statement close the operations manager
 * sends clean field data: repair costs, card charges by home, and cleaning
 * issues. Statements are closed in the first business days of the following
 * month, so a month's handoff is due HANDOFF_LEAD_DAYS before the first of
 * the next month (October's on October 29). This module owns that rule, the
 * item vocabulary, and the summaries every surface renders: the staff page,
 * the owner's queue on a statement card, the morning digest and the home
 * feed. Nothing here reads a database; close-handoff-db.ts does.
 *
 * Dependency-free so the test runner and a cron can load it.
 */

export type HandoffKind = 'repair' | 'card_charge' | 'cleaning_issue';
export type HandoffStatus = 'open' | 'sent' | 'filed' | 'dismissed';

export type HandoffItem = {
  id: string;
  month: string;
  property_id: string;
  kind: HandoffKind;
  description: string;
  vendor: string | null;
  amount: number | null;
  charge_date: string | null;
  file_path: string | null;
  status: HandoffStatus;
  created_by: string;
  created_at: string;
  sent_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  receipt_id: string | null;
};

export type HandoffKindMeta = {
  id: HandoffKind;
  label: string;
  hint: string;
  /** Carries an amount and files into the statement as a receipt. */
  money: boolean;
  /** The receipt category the owner's File step defaults to. */
  receiptCategory: 'repairs' | 'supplies' | null;
};

export const HANDOFF_KINDS: ReadonlyArray<HandoffKindMeta> = [
  {
    id: 'repair',
    label: 'Repair cost',
    hint: 'A vendor or handyman bill for this home: who, how much, the date, and the receipt.',
    money: true,
    receiptCategory: 'repairs',
  },
  {
    id: 'card_charge',
    label: 'Card charge',
    hint: 'Something bought on the company card for this home: supplies, a part, a replacement.',
    money: true,
    receiptCategory: 'supplies',
  },
  {
    id: 'cleaning_issue',
    label: 'Cleaning issue',
    hint: 'A turnover that was missed, extra, or billed wrong, so the close can check the cleaning line.',
    money: false,
    receiptCategory: null,
  },
];

export function kindMeta(kind: HandoffKind): HandoffKindMeta {
  return HANDOFF_KINDS.find((k) => k.id === kind) ?? HANDOFF_KINDS[0];
}

export function isHandoffKind(s: unknown): s is HandoffKind {
  return typeof s === 'string' && HANDOFF_KINDS.some((k) => k.id === s);
}

export const HANDOFF_STATUS_LABEL: Record<HandoffStatus, string> = {
  open: 'Not sent',
  sent: 'Sent',
  filed: 'Filed',
  dismissed: 'Set aside',
};

/** Days before the first of the following month that the handoff is due. */
export const HANDOFF_LEAD_DAYS = 3;
/** Days before the due date that the digest and the home feed start nagging. */
export const HANDOFF_NAG_DAYS = 7;
/** Day of the following month through which the previous month still shows on the page. */
export const HANDOFF_CLOSE_WINDOW_DAY = 10;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s) && Number(s.slice(5, 7)) >= 1 && Number(s.slice(5, 7)) <= 12;
}

export function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 'October 2026'. */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${MONTHS[m - 1] ?? month} ${month.slice(0, 4)}`;
}

/** 'October'. */
export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * When a month's handoff is due: HANDOFF_LEAD_DAYS before the first of the
 * following month, because that is when the close begins.
 */
export function handoffDueDate(month: string): string {
  return shiftDay(`${nextMonth(month)}-01`, -HANDOFF_LEAD_DAYS);
}

/** 'Thu, Oct 29'. */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS_SHORT[d.getUTCDay()]}, ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** 'due Thu, Oct 29' / 'due tomorrow' / 'due today' / '2 days past due'. */
export function dueWording(month: string, today: string): string {
  const due = handoffDueDate(month);
  const n = daysBetween(today, due);
  if (n > 1) return `due ${fmtDay(due)}`;
  if (n === 1) return 'due tomorrow';
  if (n === 0) return 'due today';
  if (n === -1) return '1 day past due';
  return `${-n} days past due`;
}

/**
 * The months the page offers: the current month, and the previous one while
 * its close is still running (through the HANDOFF_CLOSE_WINDOW_DAY of the
 * next month), oldest first.
 */
export function handoffMonths(today: string): string[] {
  const cur = today.slice(0, 7);
  return Number(today.slice(8, 10)) <= HANDOFF_CLOSE_WINDOW_DAY ? [prevMonth(cur), cur] : [cur];
}

/**
 * True while the digest and the home feed should mention a month: from
 * HANDOFF_NAG_DAYS before its due date until the month leaves the page.
 */
export function inNagWindow(month: string, today: string): boolean {
  if (!handoffMonths(today).includes(month)) return false;
  return daysBetween(today, handoffDueDate(month)) <= HANDOFF_NAG_DAYS;
}

export type HandoffSummary = {
  open: number;
  sent: number;
  filed: number;
  dismissed: number;
  /** open + sent: what still waits on someone. */
  pending: number;
  /** Dollars on pending money items. */
  pendingAmount: number;
};

export function summarize(items: ReadonlyArray<HandoffItem>): HandoffSummary {
  const s: HandoffSummary = { open: 0, sent: 0, filed: 0, dismissed: 0, pending: 0, pendingAmount: 0 };
  for (const i of items) {
    s[i.status] += 1;
    if (i.status === 'open' || i.status === 'sent') {
      s.pending += 1;
      if (i.amount) s.pendingAmount += i.amount;
    }
  }
  s.pendingAmount = Math.round(s.pendingAmount * 100) / 100;
  return s;
}

/** Items grouped by property, each group newest first, groups in first-seen order. */
export function groupByProperty(items: ReadonlyArray<HandoffItem>): Map<string, HandoffItem[]> {
  const out = new Map<string, HandoffItem[]>();
  for (const i of items) {
    const list = out.get(i.property_id) ?? [];
    list.push(i);
    out.set(i.property_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return out;
}

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 'delaney@risingtidestr.com' -> 'Delaney'. */
export function firstNameFromEmail(email: string | null | undefined): string {
  if (!email) return 'someone';
  const local = email.split('@')[0] ?? '';
  const first = local.split(/[._-]/)[0] ?? local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'someone';
}
