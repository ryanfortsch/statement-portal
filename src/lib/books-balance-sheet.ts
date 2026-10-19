/**
 * The cash-basis balance sheet for one LLC at December 31, built from the
 * same ledger as its P&L (books-pnl.ts), the opening balances the operator
 * enters for the day Helm's books begin, and the year-end journal entries.
 * /books/<entity>/balance-sheet renders it and /api/books/balance-sheet-export
 * sends it to the CPA.
 *
 * Every ledger row is one side of a double entry. The account it was
 * uploaded from is one side: a bank row moves that account's cash, a card
 * row moves what is owed on the card. The category is the other side, by
 * the P&L's own rules (classifyTxn, inNetIncome):
 *   - in net income, uncategorized included: the year's net income, which
 *     is buildPnl's; earlier years since the books opened are retained
 *     earnings.
 *   - equity: that equity account (contributions, distributions,
 *     intercompany and card payoffs, which net to zero once both sides of a
 *     transfer are uploaded).
 *   - liability: that liability (a loan's principal, sales tax owed).
 *   - asset: that asset (a capital improvement, a deposit).
 *   - Rising Tide's pass-through rows: Owner Funds Held in Trust.
 * A journal entry moves two chart accounts and no cash: the 1098's interest
 * out of a mortgage the payments were filed to, a loan a partner paid
 * personally, the CPA's depreciation.
 *
 * Opening balances are entered as a statement shows them: cash in a bank
 * account, owed on a card or a loan, an asset's cost, depreciation taken so
 * far. Opening Balance Equity is what makes the opening balance (assets less
 * liabilities), so the sheet balances by construction. What it checks is
 * each bank account against Chase's own running Balance column, and that
 * every account has an opening figure.
 *
 * Money in integer cents. Bookkeeping only: nothing here reads or writes an
 * owner statement.
 */

import { LLC_ENTITIES, accountsForEntity, coaAccountFor, type CoaAccount } from './books.ts';
import {
  buildPnl,
  classifyTxn,
  inNetIncome,
  isBalanceSheetAccount,
  journalLines,
  toCents,
  type Cell,
  type JournalEntry,
  type PnlReport,
  type PnlTxn,
} from './books-pnl.ts';

/** The day the 2025 tax return's balance sheet closes: where Helm's books open unless set otherwise. */
export const DEFAULT_OPENING_DATE = '2025-12-31';
/** The liability Rising Tide's owner trust (pass-through) money rolls into. */
export const TRUST_KEY = 'owner_funds_held_in_trust';
const FIXED_ASSETS_KEY = 'fixed_assets';
const UNFILED_KEYS = new Set(['uncategorized', 'suspense']);

export type BsAccountRow = {
  id: string;
  kind: 'bank' | 'credit_card';
  label: string | null;
  last4: string | null;
  property_id: string | null;
  inactive?: boolean;
};

/** One opening figure: a bank or card account, or a chart account. Positive as the statement shows it. */
export type BsOpening = { account_id: string | null; category_key: string | null; amount: number | string };

/** A ledger row with the account it came from and, on a bank row, Chase's running Balance after it. */
export type BsTxn = PnlTxn & { account_id: string | null; chase_balance?: number | string | null };

export type BsInput = {
  entityId: string;
  year: number;
  /** YYYY-MM-DD the opening balances are as of. The ledger counts from the day after. */
  openingDate: string;
  accounts: BsAccountRow[];
  openings: BsOpening[];
  txns: BsTxn[];
  journal: JournalEntry[];
};

export type BsLine = {
  id: string;
  name: string;
  depth: number;
  kind: 'account' | 'total';
  /** A parent with nothing of its own: a heading, no numbers. */
  heading: boolean;
  /** Cents at the earlier column, or null when the books had not opened. */
  prior: number | null;
  current: number;
};

export type BsGroup = { id: string; title: string; lines: BsLine[]; prior: number | null; current: number };
export type BsSectionId = 'assets' | 'liabilities' | 'equity';
export type BsSection = { id: BsSectionId; title: string; groups: BsGroup[]; prior: number | null; current: number };
export type BsPair = { prior: number | null; current: number };

export type BankCheckStatus = 'match' | 'mismatch' | 'unclear' | 'no_balance' | 'no_rows';
export type BankCheck = {
  account_id: string;
  name: string;
  status: BankCheckStatus;
  /** The last day with rows on file, through December 31. */
  date: string | null;
  /** Opening plus every row through that day. */
  helm: number | null;
  /** Chase's Balance at the end of that day. */
  chase: number | null;
};

/** Chase's balance just before the first row on file after the opening date: what the opening figure should be. */
export type OpeningHint = { account_id: string; name: string; date: string; chase_before: number };

export type MissingOpening = { id: string; name: string; why: 'no_opening' | 'postings' };

export type EquityRollforward = {
  beginning: number;
  contributions: number;
  distributions: number;
  net_income: number;
  other: number;
  ending: number;
};

export type BalanceSheet = {
  entity_id: string;
  entity_name: string;
  year: number;
  opening_date: string;
  /** The two column dates. prior is null when December 31 is the opening date itself. */
  dates: { prior: string | null; current: string };
  sections: BsSection[];
  total_assets: BsPair;
  total_liabilities: BsPair;
  total_equity: BsPair;
  total_liabilities_and_equity: BsPair;
  balanced: boolean;
  /** The year's P&L over the same rows: its net income is the sheet's Net Income. */
  pnl: PnlReport;
  equity: EquityRollforward | null;
  bank_checks: BankCheck[];
  opening_hints: OpeningHint[];
  missing_openings: MissingOpening[];
  /** Rising Tide: trust cash less what is owed to owners. Zero when the trust accounts hold only owners' money. */
  trust_gap: number | null;
  /** Opening figures entered (each bank or card account, asset or liability that has one). */
  openings_entered: number;
  counts: { transactions: number; on_proposal: number; uncategorized: number; journal_entries: number };
  final: boolean;
};

// ── Small helpers ─────────────────────────────────────────────────────────

export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Dec 31, 2025". */
export function bsDateLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}

/**
 * A typed money figure: "$12,345.67", "12345.67", "-500", "(500)". Blank
 * is null (no figure). Anything else is not a number.
 */
export function parseMoneyInput(raw: string | null | undefined): { ok: true; cents: number | null } | { ok: false } {
  const s = (raw ?? '').trim();
  if (s === '') return { ok: true, cents: null };
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const body = s.replace(/^\((.*)\)$/, '$1').replace(/^-/, '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(body)) return { ok: false };
  const cents = Math.round(Number(body) * 100);
  return { ok: true, cents: neg ? -cents : cents };
}

/** Chase's Balance cell as cents, or null when the column is blank or missing (card exports have none). */
export function chaseBalanceCents(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = v.replace(/[$,\s"]/g, '');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/**
 * Chase's Balance cell from a ledger row's `raw`, as ledgerRowsFromParsed
 * stores it ({ row: { Balance } }). Card rows and older uploads have none.
 */
export function chaseBalanceFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = (raw as { row?: unknown }).row;
  if (!row || typeof row !== 'object') return null;
  const b = (row as Record<string, unknown>).Balance;
  return typeof b === 'string' || typeof b === 'number' ? String(b) : null;
}

/** Multiset a - b. */
function without(a: number[], b: number[]): number[] {
  const left = [...a];
  for (const x of b) {
    const i = left.indexOf(x);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

/**
 * Chase's balance at the start and end of one day, from that day's rows.
 * Each row's Balance is the balance after it, so Balance - Amount is the
 * balance before it. In an unbroken chain every "before" but the first is
 * some row's "after", and every "after" but the last is some row's
 * "before": the one left over on each side is the day's start and end.
 * Null when the day does not chain to exactly one of each (a row without a
 * Balance, or a coincidence of amounts).
 */
export function chaseDayBalances(rows: { amount: number | string; chase_balance?: number | string | null }[]): { start: number | null; end: number | null } {
  const after: number[] = [];
  const before: number[] = [];
  for (const r of rows) {
    const b = chaseBalanceCents(r.chase_balance);
    if (b == null) return { start: null, end: null };
    after.push(b);
    before.push(b - toCents(r.amount));
  }
  if (after.length === 0) return { start: null, end: null };
  const ends = without(after, before);
  const starts = without(before, after);
  return { start: starts.length === 1 ? starts[0] : null, end: ends.length === 1 ? ends[0] : null };
}

export function accountName(a: Pick<BsAccountRow, 'label' | 'last4' | 'kind'>): string {
  const base = a.label || (a.kind === 'credit_card' ? 'Credit card' : 'Bank account');
  return a.last4 ? `${base} x${a.last4}` : base;
}

// ── What can carry an opening balance, and what a journal entry may touch ─

export type OpeningLine = {
  /** The form field and line id: acct:<uuid> or coa:<key>. */
  id: string;
  account_id: string | null;
  category_key: string | null;
  name: string;
  group: string;
  help: string;
};

/** Chart accounts that carry a balance: assets and liabilities, never pass-through. */
function balanceChart(entityId: string): CoaAccount[] {
  return accountsForEntity(entityId).filter((a) => isBalanceSheetAccount(a) && !a.pass_through && a.type !== 'equity');
}

/**
 * Every figure the opening balance form asks for: each bank and card
 * account, each asset and liability on the entity's chart. Equity is not
 * asked for: Opening Balance Equity is what is left.
 */
export function openingLinesFor(entityId: string, accounts: BsAccountRow[]): OpeningLine[] {
  const byLabel = (a: BsAccountRow, b: BsAccountRow) => accountName(a).localeCompare(accountName(b));
  const live = accounts.filter((a) => !a.inactive).sort(byLabel);
  const lines: OpeningLine[] = [];
  for (const a of live.filter((x) => x.kind === 'bank' && !x.property_id)) {
    lines.push({ id: `acct:${a.id}`, account_id: a.id, category_key: null, name: accountName(a), group: 'Bank accounts', help: 'Cash in the account' });
  }
  for (const a of live.filter((x) => x.kind === 'bank' && x.property_id)) {
    lines.push({ id: `acct:${a.id}`, account_id: a.id, category_key: null, name: accountName(a), group: 'Cash held in trust for owners', help: 'Cash in the account' });
  }
  for (const a of live.filter((x) => x.kind === 'credit_card')) {
    lines.push({ id: `acct:${a.id}`, account_id: a.id, category_key: null, name: accountName(a), group: 'Credit cards', help: 'Owed on the card' });
  }
  for (const c of balanceChart(entityId)) {
    const fixed = c.key === FIXED_ASSETS_KEY || c.parent_key === FIXED_ASSETS_KEY;
    const group = c.type === 'asset' ? (fixed ? 'Fixed assets' : 'Other assets') : 'Loans and other liabilities';
    const help = c.contra
      ? 'Depreciation taken so far, as a positive number'
      : c.key === TRUST_KEY
        ? "Owed to owners: the trust accounts' cash, less any Rising Tide money in them"
        : c.type === 'asset'
          ? 'Cost'
          : 'Owed';
    if (c.key === FIXED_ASSETS_KEY) continue; // a heading: its children carry the figures
    lines.push({ id: `coa:${c.key}`, account_id: null, category_key: c.key, name: c.name, group, help });
  }
  return lines;
}

/** Chart accounts a journal entry may debit or credit: the entity's chart, less the keys that file nothing. */
export function journalAccountsFor(entityId: string): CoaAccount[] {
  return accountsForEntity(entityId).filter((a) => !UNFILED_KEYS.has(a.key));
}

export type JournalDraft = { entry_date: string; debit_key: string; credit_key: string; amount: string; memo: string };

/** Why an entry cannot be saved, or null when it can. Returns the parsed cents on success. */
export function validateJournalEntry(
  entityId: string,
  d: JournalDraft,
  openingDate: string | null,
): { ok: true; cents: number } | { ok: false; error: string } {
  if (!isIsoDate(d.entry_date)) return { ok: false, error: 'Give the entry a date.' };
  if (openingDate && d.entry_date <= openingDate) {
    return { ok: false, error: `The books open on ${bsDateLabel(openingDate)}; date the entry after that.` };
  }
  const allowed = new Set(journalAccountsFor(entityId).map((a) => a.key));
  if (!allowed.has(d.debit_key) || !allowed.has(d.credit_key)) return { ok: false, error: 'Pick a debit and a credit account from the chart.' };
  if (d.debit_key === d.credit_key) return { ok: false, error: 'The debit and the credit must be different accounts.' };
  const amt = parseMoneyInput(d.amount);
  if (!amt.ok || amt.cents == null || amt.cents <= 0) return { ok: false, error: 'The amount must be a positive number.' };
  const memo = d.memo.trim();
  if (!memo) return { ok: false, error: 'Say what the entry is for (the memo prints for the CPA).' };
  if (memo.length > 300) return { ok: false, error: 'Keep the memo under 300 characters.' };
  return { ok: true, cents: amt.cents };
}

/**
 * Years a balance sheet exists for, newest first: from the year the books
 * open (whose December 31 is on or after the opening date) to this year.
 */
export function balanceSheetYears(openingDate: string, thisYear: number): number[] {
  const first = Number(openingDate.slice(0, 4));
  const out: number[] = [];
  for (let y = thisYear; y >= first; y--) out.push(y);
  return out;
}

// ── The sheet ─────────────────────────────────────────────────────────────

type Side = 'asset' | 'liability' | 'equity';

export function buildBalanceSheet(input: BsInput): BalanceSheet {
  const { entityId, year, openingDate } = input;
  const entity = LLC_ENTITIES[entityId];
  if (!entity) throw new Error(`Unknown entity: ${entityId}`);
  if (!isIsoDate(openingDate)) throw new Error(`Opening date is not a date: ${openingDate}`);
  const current = `${year}-12-31`;
  if (openingDate > current) throw new Error(`The books open on ${openingDate}, after ${current}`);
  const priorYearEnd = `${year - 1}-12-31`;
  const prior = openingDate < current ? (priorYearEnd > openingDate ? priorYearEnd : openingDate) : null;

  const accountsById = new Map(input.accounts.map((a) => [a.id, a]));
  const rows = input.txns.filter((t) => t.txn_date > openingDate && t.txn_date <= current);
  const journal = input.journal.filter((e) => e.entry_date > openingDate && e.entry_date <= current);

  // Which side of the sheet a line id sits on.
  const sideOf = (id: string): Side => {
    if (id === 'cash_unrecorded') return 'asset';
    if (id === 'obe' || id === 're' || id === 'ni') return 'equity';
    if (id.startsWith('acct:')) return accountsById.get(id.slice(5))?.kind === 'credit_card' ? 'liability' : 'asset';
    const c = coaAccountFor(entityId, id.slice(4));
    return c?.type === 'asset' ? 'asset' : c?.type === 'liability' ? 'liability' : 'equity';
  };

  // Opening figures, in the sheet's sign: assets and contra assets as they
  // reduce, liabilities owed, equity as capital.
  const opening = new Map<string, number>();
  const openedIds = new Set<string>();
  for (const o of input.openings) {
    const cents = toCents(o.amount);
    if (o.account_id) {
      if (!accountsById.has(o.account_id)) continue;
      openedIds.add(`acct:${o.account_id}`);
      opening.set(`acct:${o.account_id}`, (opening.get(`acct:${o.account_id}`) ?? 0) + cents);
      continue;
    }
    const c = coaAccountFor(entityId, o.category_key);
    if (!c || !isBalanceSheetAccount(c) || c.pass_through || c.key === 'opening_balance_equity') continue;
    const id = c.key === 'retained_earnings' ? 're' : `coa:${c.key}`;
    openedIds.add(id);
    opening.set(id, (opening.get(id) ?? 0) + (c.contra ? -cents : cents));
  }
  let obe = 0;
  for (const [id, cents] of opening) {
    const side = sideOf(id);
    obe += side === 'asset' ? cents : -cents;
  }

  // Where the category side of one line lands, and with what sign.
  const categoryTarget = (t: PnlTxn, thisYear: boolean): { id: string; sign: 1 | -1 } => {
    const { account } = classifyTxn(entityId, t);
    if (!account || inNetIncome(account)) return { id: thisYear ? 'ni' : 're', sign: 1 };
    if (account.pass_through) return { id: `coa:${TRUST_KEY}`, sign: 1 };
    if (account.type === 'asset') return { id: `coa:${account.key}`, sign: -1 };
    if (account.key === 'retained_earnings') return { id: 're', sign: 1 };
    if (account.key === 'opening_balance_equity') return { id: 'obe', sign: 1 };
    return { id: `coa:${account.key}`, sign: 1 };
  };

  const posted = new Set<string>();
  const positionAt = (date: string): Map<string, number> => {
    const pos = new Map<string, number>(opening);
    const add = (id: string, cents: number) => pos.set(id, (pos.get(id) ?? 0) + cents);
    add('obe', obe);
    add('re', 0);
    add('ni', 0);
    const yearStart = `${date.slice(0, 4)}-01-01`;
    for (const t of rows) {
      if (t.txn_date > date) continue;
      const m = toCents(t.amount);
      const acct = t.account_id ? accountsById.get(t.account_id) : undefined;
      if (!acct) add('cash_unrecorded', m);
      else add(`acct:${acct.id}`, acct.kind === 'credit_card' ? -m : m);
      const target = categoryTarget(t, t.txn_date >= yearStart);
      add(target.id, target.sign * m);
      posted.add(target.id);
    }
    for (const e of journal) {
      if (e.entry_date > date) continue;
      for (const l of journalLines(e)) {
        const target = categoryTarget(l, l.txn_date >= yearStart);
        add(target.id, target.sign * toCents(l.amount));
        posted.add(target.id);
      }
    }
    return pos;
  };

  const cur = positionAt(current);
  const pri = prior ? positionAt(prior) : null;
  const val = (id: string): { prior: number | null; current: number } => ({ prior: pri ? pri.get(id) ?? 0 : null, current: cur.get(id) ?? 0 });
  const nonzero = (id: string) => (cur.get(id) ?? 0) !== 0 || (pri?.get(id) ?? 0) !== 0;
  const shows = (id: string) => nonzero(id) || openedIds.has(id);

  // ── Lines ──
  const accountLine = (a: BsAccountRow): BsLine => ({ id: `acct:${a.id}`, name: accountName(a), depth: 0, kind: 'account', heading: false, ...val(`acct:${a.id}`) });
  const byName = (a: BsAccountRow, b: BsAccountRow) => accountName(a).localeCompare(accountName(b));
  const listed = (kind: BsAccountRow['kind'], trust: boolean) =>
    input.accounts
      .filter((a) => a.kind === kind && !!a.property_id === trust && (!a.inactive || shows(`acct:${a.id}`)))
      .sort(byName)
      .map(accountLine);

  /** The P&L's tree for chart lines: a parent with live children gets a heading, the children, and a total. */
  const chartLines = (chart: CoaAccount[], idOf: (c: CoaAccount) => string): BsLine[] => {
    const inGroup = new Map(chart.map((c) => [c.key, c]));
    const parentOf = (c: CoaAccount) => (c.parent_key ? inGroup.get(c.parent_key) : undefined);
    const childrenOf = (key: string) => chart.filter((c) => parentOf(c)?.key === key);
    const active = (c: CoaAccount): boolean => shows(idOf(c)) || childrenOf(c.key).some(active);
    const sumTree = (c: CoaAccount, col: 'prior' | 'current'): number =>
      childrenOf(c.key).reduce((s, k) => s + sumTree(k, col), (col === 'prior' ? pri?.get(idOf(c)) : cur.get(idOf(c))) ?? 0);
    const out: BsLine[] = [];
    const emit = (c: CoaAccount, depth: number) => {
      const kids = childrenOf(c.key).filter(active);
      const own = val(idOf(c));
      if (kids.length === 0) {
        out.push({ id: idOf(c), name: c.name, depth, kind: 'account', heading: false, ...own });
        return;
      }
      out.push({ id: idOf(c), name: c.name, depth, kind: 'account', heading: !shows(idOf(c)), ...own });
      for (const k of kids) emit(k, depth + 1);
      out.push({ id: idOf(c), name: `Total ${c.name}`, depth, kind: 'total', heading: false, prior: pri ? sumTree(c, 'prior') : null, current: sumTree(c, 'current') });
    };
    for (const c of chart) if (!parentOf(c) && active(c)) emit(c, 0);
    return out;
  };

  const chart = accountsForEntity(entityId);
  const assetsChart = chart.filter((c) => c.type === 'asset');
  const fixedChart = assetsChart.filter((c) => c.key === FIXED_ASSETS_KEY || c.parent_key === FIXED_ASSETS_KEY);
  const otherAssetsChart = assetsChart.filter((c) => !fixedChart.includes(c));
  const liabilityChart = chart.filter((c) => c.type === 'liability');
  const equityChart = chart.filter((c) => c.type === 'equity' && c.key !== 'opening_balance_equity' && c.key !== 'retained_earnings');
  const coaId = (c: CoaAccount) => `coa:${c.key}`;

  const cashLines = listed('bank', false);
  if (shows('cash_unrecorded')) cashLines.push({ id: 'cash_unrecorded', name: 'Cash, account not recorded', depth: 0, kind: 'account', heading: false, ...val('cash_unrecorded') });

  const group = (id: string, title: string, given: BsLine[], always = false): BsGroup | null => {
    if (given.length === 0 && !always) return null;
    // A group whose one root is a heading (Fixed Assets) says its name once:
    // the group's title and total stand in for the heading's.
    const [head, last] = [given[0], given[given.length - 1]];
    const oneRoot = given.length > 2 && head.heading && head.depth === 0 && last.kind === 'total' && last.id === head.id
      && given.slice(1, -1).every((l) => l.depth > 0);
    const lines = oneRoot ? given.slice(1, -1).map((l) => ({ ...l, depth: l.depth - 1 })) : given;
    const accts = lines.filter((l) => l.kind === 'account' && !l.heading);
    return {
      id,
      title,
      lines,
      prior: pri ? accts.reduce((s, l) => s + (l.prior ?? 0), 0) : null,
      current: accts.reduce((s, l) => s + l.current, 0),
    };
  };
  const section = (id: BsSectionId, title: string, groups: (BsGroup | null)[]): BsSection => {
    const gs = groups.filter((g): g is BsGroup => !!g);
    return {
      id,
      title,
      groups: gs,
      prior: pri ? gs.reduce((s, g) => s + (g.prior ?? 0), 0) : null,
      current: gs.reduce((s, g) => s + g.current, 0),
    };
  };

  const equityLines: BsLine[] = [
    { id: 'obe', name: 'Opening Balance Equity', depth: 0, kind: 'account', heading: false, ...val('obe') },
    ...chartLines(equityChart, coaId),
    { id: 're', name: 'Retained Earnings', depth: 0, kind: 'account', heading: false, ...val('re') },
    { id: 'ni', name: 'Net Income', depth: 0, kind: 'account', heading: false, ...val('ni') },
  ];

  const sections: BsSection[] = [
    section('assets', 'Assets', [
      group('cash', 'Bank accounts', cashLines, input.accounts.some((a) => a.kind === 'bank' && !a.property_id)),
      group('trust_cash', 'Cash held in trust for owners', listed('bank', true)),
      group('fixed_assets', 'Fixed assets', chartLines(fixedChart, coaId)),
      group('other_assets', 'Other assets', chartLines(otherAssetsChart, coaId)),
    ]),
    section('liabilities', 'Liabilities', [
      group('cards', 'Credit cards', listed('credit_card', false), input.accounts.some((a) => a.kind === 'credit_card')),
      group('liabilities', 'Loans and other liabilities', chartLines(liabilityChart, coaId)),
    ]),
    section('equity', 'Equity', [group('equity', 'Equity', equityLines, true)]),
  ];

  const pair = (s: BsSection): BsPair => ({ prior: s.prior, current: s.current });
  const [assets, liabilities, equity] = sections;
  const lePrior = pri ? (liabilities.prior ?? 0) + (equity.prior ?? 0) : null;
  const leCurrent = liabilities.current + equity.current;
  const balanced = assets.current === leCurrent && (!pri || assets.prior === lePrior);

  // ── The year's P&L over the same rows; its net income is the sheet's ──
  const yearStart = `${year}-01-01`;
  const pnl = buildPnl(entityId, year, rows.filter((t) => t.txn_date >= yearStart), journal.filter((e) => e.entry_date >= yearStart));

  // ── Equity for the year (the CPA's capital rollforward) ──
  let equityRoll: EquityRollforward | null = null;
  if (pri) {
    const delta = (ids: string[]) => ids.reduce((s, id) => s + (cur.get(id) ?? 0) - (pri.get(id) ?? 0), 0);
    const subtree = (key: string): string[] => [`coa:${key}`, ...equityChart.filter((c) => c.parent_key === key).flatMap((c) => subtree(c.key))];
    const beginning = equity.prior ?? 0;
    const contributions = delta(subtree('owner_contribution'));
    const distributions = delta(subtree('owner_draw'));
    const netIncome = cur.get('ni') ?? 0;
    const ending = equity.current;
    equityRoll = { beginning, contributions, distributions, net_income: netIncome, other: ending - beginning - contributions - distributions - netIncome, ending };
  }

  // ── Bank balances against Chase ──
  const openingFor = (a: BsAccountRow) => opening.get(`acct:${a.id}`) ?? 0;
  const bankChecks: BankCheck[] = [];
  const hints: OpeningHint[] = [];
  for (const a of input.accounts.filter((x) => x.kind === 'bank').sort(byName)) {
    const mine = rows.filter((t) => t.account_id === a.id);
    if (mine.length === 0) {
      if (!a.inactive) bankChecks.push({ account_id: a.id, name: accountName(a), status: 'no_rows', date: null, helm: null, chase: null });
      continue;
    }
    const dates = mine.map((t) => t.txn_date).sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const helm = openingFor(a) + mine.reduce((s, t) => s + toCents(t.amount), 0);
    const lastDay = chaseDayBalances(mine.filter((t) => t.txn_date === last));
    const hasBalances = mine.filter((t) => t.txn_date === last).every((t) => chaseBalanceCents(t.chase_balance) != null);
    const status: BankCheckStatus = !hasBalances ? 'no_balance' : lastDay.end == null ? 'unclear' : lastDay.end === helm ? 'match' : 'mismatch';
    bankChecks.push({ account_id: a.id, name: accountName(a), status, date: last, helm, chase: lastDay.end });
    const firstDay = chaseDayBalances(mine.filter((t) => t.txn_date === first));
    if (firstDay.start != null) hints.push({ account_id: a.id, name: accountName(a), date: first, chase_before: firstDay.start });
  }

  // ── Opening figures still missing ──
  const missing: MissingOpening[] = [];
  for (const a of input.accounts.filter((x) => !x.inactive).sort(byName)) {
    if (!openedIds.has(`acct:${a.id}`)) missing.push({ id: `acct:${a.id}`, name: accountName(a), why: 'no_opening' });
  }
  for (const c of balanceChart(entityId)) {
    const id = `coa:${c.key}`;
    if (posted.has(id) && !openedIds.has(id)) missing.push({ id, name: c.name, why: 'postings' });
  }

  // ── Rising Tide: the trust accounts against what is owed to owners ──
  const trustCash = input.accounts.filter((a) => a.kind === 'bank' && a.property_id).reduce((s, a) => s + (cur.get(`acct:${a.id}`) ?? 0), 0);
  const hasTrust = input.accounts.some((a) => a.kind === 'bank' && a.property_id) && !!coaAccountFor(entityId, TRUST_KEY);
  const trustGap = hasTrust ? trustCash - (cur.get(`coa:${TRUST_KEY}`) ?? 0) : null;

  // ── Review status of every row the sheet stands on ──
  const counts = { transactions: rows.length, on_proposal: 0, uncategorized: 0, journal_entries: journal.length };
  for (const t of rows) {
    const s = classifyTxn(entityId, t).status;
    if (s === 'proposal') counts.on_proposal += 1;
    else if (s === 'uncategorized') counts.uncategorized += 1;
  }

  return {
    entity_id: entityId,
    entity_name: entity.name,
    year,
    opening_date: openingDate,
    dates: { prior, current },
    sections,
    total_assets: pair(assets),
    total_liabilities: pair(liabilities),
    total_equity: pair(equity),
    total_liabilities_and_equity: { prior: lePrior, current: leCurrent },
    balanced,
    pnl,
    equity: equityRoll,
    bank_checks: bankChecks,
    opening_hints: hints,
    missing_openings: missing,
    trust_gap: trustGap,
    openings_entered: openedIds.size,
    counts,
    final: counts.on_proposal === 0 && counts.uncategorized === 0 && missing.length === 0 && (counts.transactions > 0 || opening.size > 0),
  };
}

// ── Words and the spreadsheet the CPA gets ────────────────────────────────

/** One line of where the sheet stands. */
export function bsStatusLine(bs: BalanceSheet): string {
  const c = bs.counts;
  const since = bsDateLabel(bs.opening_date);
  if (c.transactions === 0 && bs.openings_entered === 0) {
    return `Nothing on file yet: no opening balances and no transactions since ${since}.`;
  }
  if (bs.final) return `Final: every transaction since ${since} reviewed, and every account has an opening balance.`;
  const parts: string[] = [];
  if (c.on_proposal > 0) parts.push(`${c.on_proposal} ${c.on_proposal === 1 ? 'transaction' : 'transactions'} on the categorizer's proposal`);
  if (c.uncategorized > 0) parts.push(`${c.uncategorized} uncategorized`);
  const m = bs.missing_openings.length;
  if (m > 0) parts.push(`${m} ${m === 1 ? 'balance' : 'balances'} with no opening figure`);
  return `Draft: ${parts.join('; ')}.`;
}

const dollars = (cents: number | null): Cell => (cents == null ? null : cents / 100);

export function bankCheckWords(c: BankCheck): string {
  switch (c.status) {
    case 'match': return 'Matches Chase';
    case 'mismatch': return 'Does not match Chase';
    case 'unclear': return "Chase's balance for the day is unclear";
    case 'no_balance': return 'No Chase balance on file';
    case 'no_rows': return 'No rows on file';
  }
}

/**
 * The sheet as rows of cells: a title block, the two dated columns, the
 * equity rollforward and the bank checks. Amounts are dollars (numbers, not
 * strings) so the spreadsheet can sum them.
 */
export function bsSheetRows(bs: BalanceSheet): Cell[][] {
  const two = !!bs.dates.prior;
  const cols = (p: number | null, c: number): Cell[] => (two ? [dollars(p), dollars(c)] : [dollars(c)]);
  const indent = (depth: number, name: string) => `${'    '.repeat(depth)}${name}`;
  const rows: Cell[][] = [
    [bs.entity_name],
    [`Balance Sheet, ${bsDateLabel(bs.dates.current)}, cash basis`],
    [bsStatusLine(bs)],
    [`Opening balances as of ${bsDateLabel(bs.opening_date)}, then the ledger and year-end journal entries.`],
    [],
    ['', ...(two ? [bsDateLabel(bs.dates.prior!), bsDateLabel(bs.dates.current)] : [bsDateLabel(bs.dates.current)])],
  ];
  for (const s of bs.sections) {
    rows.push([s.title]);
    for (const g of s.groups) {
      const titled = s.id !== 'equity';
      if (titled) rows.push([indent(1, g.title)]);
      const base = titled ? 2 : 1;
      for (const l of g.lines) rows.push(l.heading ? [indent(base + l.depth, l.name)] : [indent(base + l.depth, l.name), ...cols(l.prior, l.current)]);
      if (titled) rows.push([indent(1, `Total ${g.title}`), ...cols(g.prior, g.current)]);
    }
    rows.push([`Total ${s.title}`, ...cols(s.prior, s.current)]);
    if (s.id === 'equity') rows.push(['Total Liabilities and Equity', ...cols(bs.total_liabilities_and_equity.prior, bs.total_liabilities_and_equity.current)]);
  }
  if (bs.equity) {
    const e = bs.equity;
    rows.push([], [`Equity for ${bs.year}`]);
    rows.push([indent(1, `Equity, ${bsDateLabel(bs.dates.prior!)}`), dollars(e.beginning)]);
    rows.push([indent(1, 'Contributions'), dollars(e.contributions)]);
    rows.push([indent(1, 'Distributions'), dollars(e.distributions)]);
    rows.push([indent(1, 'Net income'), dollars(e.net_income)]);
    if (e.other !== 0) rows.push([indent(1, 'Other equity movements (intercompany, transfers)'), dollars(e.other)]);
    rows.push([indent(1, `Equity, ${bsDateLabel(bs.dates.current)}`), dollars(e.ending)]);
  }
  if (bs.bank_checks.length > 0) {
    rows.push([], ['Bank balances against Chase'], ['Account', 'Date', 'Helm', 'Chase', 'Difference', 'Check']);
    for (const c of bs.bank_checks) {
      const diff = c.helm != null && c.chase != null ? c.helm - c.chase : null;
      rows.push([c.name, c.date, dollars(c.helm), dollars(c.chase), dollars(diff), bankCheckWords(c)]);
    }
  }
  if (bs.missing_openings.length > 0) {
    rows.push([], ['No opening balance yet']);
    for (const m of bs.missing_openings) rows.push([m.name, m.why === 'postings' ? 'Has postings since the opening date' : 'No opening figure entered']);
  }
  return rows;
}

/** The opening figures as entered, for the workbook. */
export function openingSheetRows(bs: Pick<BalanceSheet, 'opening_date'>, lines: OpeningLine[], openings: BsOpening[]): Cell[][] {
  const amountFor = (l: OpeningLine) => {
    const o = openings.find((x) => (l.account_id ? x.account_id === l.account_id : x.category_key === l.category_key));
    return o ? toCents(o.amount) / 100 : null;
  };
  const rows: Cell[][] = [[`Opening balances as of ${bsDateLabel(bs.opening_date)}`], ['Group', 'Line', 'What it is', 'Amount']];
  for (const l of lines) rows.push([l.group, l.name, l.help, amountFor(l)]);
  return rows;
}

/** The journal entries the sheet stands on, for the workbook. */
export function journalSheetRows(entityId: string, journal: JournalEntry[]): Cell[][] {
  const name = (k: string) => coaAccountFor(entityId, k)?.name ?? k;
  const rows: Cell[][] = [['Date', 'Debit', 'Credit', 'Amount', 'Memo']];
  for (const e of [...journal].sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    rows.push([e.entry_date, name(e.debit_key), name(e.credit_key), Math.abs(toCents(e.amount)) / 100, e.memo]);
  }
  return rows;
}

/** The download's file name: "Goose-of-Calderwood-LLC-Balance-Sheet-2026". */
export function bsFileBase(bs: Pick<BalanceSheet, 'entity_name' | 'year'>): string {
  return `${bs.entity_name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-Balance-Sheet-${bs.year}`;
}
