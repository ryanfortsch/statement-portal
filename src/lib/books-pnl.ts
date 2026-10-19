/**
 * The cash-basis profit and loss for one LLC and one year, built from its
 * ledger_transactions. /books/<entity>/pnl renders it and
 * /api/books/pnl-export sends it to the CPA as a spreadsheet.
 *
 * Cash basis: a transaction counts in the month of its txn_date (the
 * posting date on a bank row, the transaction date on a card row), at the
 * signed amount the bank shows.
 *
 * A row's category is the operator's (category_key) when there is one,
 * else the categorizer's proposal (ai_category_key). Until every row is
 * reviewed the report is a draft, and it says how many rows are still on a
 * proposal and how many have no category at all.
 *
 * What is in net income and what is not:
 *   - income, cogs, expense, other_income, other_expense accounts are.
 *   - equity (owner draws and contributions, intercompany transfers, card
 *     payoffs, the Florida house on Goose of Astoria) and liability (sales
 *     tax owed, guest prepayments, a loan's principal) are balance-sheet
 *     movements. They are listed under "Not in net income", never added.
 *   - pass-through accounts (Rising Tide's owner trust money) are listed
 *     there too: that money is the owners', not Rising Tide's.
 *   - a row with no category, 'uncategorized', 'suspense', or a key that is
 *     not on this entity's chart is Uncategorized income when money came in
 *     and Uncategorized expense when it went out, the way QuickBooks files
 *     it. It IS in net income, so an unfiled transfer between two of the
 *     entity's own accounts nets to zero once both sides are uploaded, and
 *     the count says how much is left to file.
 *
 * Money is summed in integer cents. Bookkeeping only: nothing here reads
 * or writes an owner statement.
 */

import { CHART_OF_ACCOUNTS, LLC_ENTITIES, coaAccountFor, type CoaAccount, type CoaType } from './books.ts';

export type PnlTxn = {
  txn_date: string;
  amount: number | string;
  category_key: string | null;
  ai_category_key: string | null;
  reviewed: boolean;
};

export type PnlSectionId = 'income' | 'cogs' | 'expense' | 'other_income' | 'other_expense';

export type PnlLine = {
  key: string;
  name: string;
  depth: number;
  /** 'account' carries the account's own postings; 'total' its whole subtree. */
  kind: 'account' | 'total';
  /** A parent with nothing posted to it directly: a heading, no numbers. */
  heading: boolean;
  uncategorized: boolean;
  /** Cents per month, January first, in the section's direction (an expense is positive). */
  months: number[];
  total: number;
};

export type PnlSection = {
  id: PnlSectionId;
  title: string;
  lines: PnlLine[];
  months: number[];
  total: number;
};

export type PnlOutsideRow = {
  key: string;
  name: string;
  type: CoaType;
  pass_through: boolean;
  /** Cents in and out, both positive. */
  money_in: number;
  money_out: number;
  count: number;
};

export type PnlSubtotal = { months: number[]; total: number };

export type PnlReport = {
  entity_id: string;
  entity_name: string;
  year: number;
  sections: PnlSection[];
  gross_profit: PnlSubtotal;
  net_operating_income: PnlSubtotal;
  net_other_income: PnlSubtotal;
  net_income: PnlSubtotal;
  outside: PnlOutsideRow[];
  counts: {
    transactions: number;
    /** The operator has confirmed a category. */
    reviewed: number;
    /** Still on the categorizer's proposal, which the P&L uses meanwhile. */
    on_proposal: number;
    /** No category the P&L can file: counted as Uncategorized income or expense. */
    uncategorized: number;
  };
  /** Keys the categorizer or an old row used that are not on this entity's chart. */
  off_chart_keys: string[];
  /** Every row reviewed and none uncategorized. */
  final: boolean;
  /** The last month with any transaction, 1-12, or 0 when there are none. */
  last_month: number;
};

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SECTION_TITLES: Record<PnlSectionId, string> = {
  income: 'Income',
  cogs: 'Cost of Goods Sold',
  expense: 'Expenses',
  other_income: 'Other Income',
  other_expense: 'Other Expenses',
};
const SECTION_ORDER: PnlSectionId[] = ['income', 'cogs', 'expense', 'other_income', 'other_expense'];
/** Sections whose money normally comes in: their lines read as the signed amount. */
const INFLOW: Record<PnlSectionId, boolean> = { income: true, cogs: false, expense: false, other_income: true, other_expense: false };

/** Keys that file nothing: the row counts as uncategorized. */
const UNFILED_KEYS = new Set(['uncategorized', 'suspense']);

export const UNCATEGORIZED_INCOME_KEY = 'uncategorized_income';
export const UNCATEGORIZED_EXPENSE_KEY = 'uncategorized_expense';

export function toCents(amount: number | string): number {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** The year's first day and the first day after it, for the ledger query. */
export function yearBounds(year: number): { start: string; endExclusive: string } {
  return { start: `${year}-01-01`, endExclusive: `${year + 1}-01-01` };
}

/** A ?year= value, else the given default. 2000-2100 only. */
export function parsePnlYear(raw: string | string[] | undefined, fallback: number): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = v && /^\d{4}$/.test(v) ? Number(v) : NaN;
  return n >= 2000 && n <= 2100 ? n : fallback;
}

export type TxnStatus = 'reviewed' | 'proposal' | 'uncategorized';

/**
 * How the P&L files one row: the account it lands in (undefined when it
 * files nothing), the key it used, and where the row stands in review.
 */
export function classifyTxn(entityId: string, t: Pick<PnlTxn, 'category_key' | 'ai_category_key' | 'reviewed'>): {
  account: CoaAccount | undefined;
  key: string | null;
  status: TxnStatus;
  offChart: boolean;
} {
  const confirmed = (t.category_key || '').trim() || null;
  const key = confirmed ?? ((t.ai_category_key || '').trim() || null);
  const account = key && !UNFILED_KEYS.has(key) ? coaAccountFor(entityId, key) : undefined;
  const offChart = !!key && !UNFILED_KEYS.has(key) && !account;
  const status: TxnStatus = !account ? 'uncategorized' : confirmed ? 'reviewed' : 'proposal';
  return { account, key, status, offChart };
}

/** In net income, or one of the balance-sheet and owner-trust movements listed beside it. */
export function inNetIncome(account: CoaAccount): boolean {
  return !account.pass_through && account.type !== 'equity' && account.type !== 'liability';
}

const zeros = () => Array.from({ length: 12 }, () => 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const subtotal = (months: number[]): PnlSubtotal => ({ months, total: sum(months) });

export function buildPnl(entityId: string, year: number, txns: PnlTxn[]): PnlReport {
  const entity = LLC_ENTITIES[entityId];
  if (!entity) throw new Error(`Unknown entity: ${entityId}`);
  const { start, endExclusive } = yearBounds(year);

  // Signed cents per account key per month, plus the two uncategorized lines.
  const own = new Map<string, number[]>();
  const bump = (key: string, month: number, cents: number) => {
    const m = own.get(key) ?? zeros();
    m[month] += cents;
    own.set(key, m);
  };
  const outside = new Map<string, PnlOutsideRow>();
  const offChart = new Set<string>();
  const counts = { transactions: 0, reviewed: 0, on_proposal: 0, uncategorized: 0 };
  let lastMonth = 0;

  for (const t of txns) {
    if (!(t.txn_date >= start && t.txn_date < endExclusive)) continue;
    const month = Number(t.txn_date.slice(5, 7)) - 1;
    const cents = toCents(t.amount);
    const c = classifyTxn(entityId, t);
    counts.transactions += 1;
    lastMonth = Math.max(lastMonth, month + 1);
    if (c.offChart && c.key) offChart.add(c.key);
    if (c.status === 'reviewed') counts.reviewed += 1;
    else if (c.status === 'proposal') counts.on_proposal += 1;
    else counts.uncategorized += 1;

    if (!c.account) {
      bump(cents >= 0 ? UNCATEGORIZED_INCOME_KEY : UNCATEGORIZED_EXPENSE_KEY, month, cents);
    } else if (inNetIncome(c.account)) {
      bump(c.account.key, month, cents);
    } else {
      const row = outside.get(c.account.key) ?? {
        key: c.account.key,
        name: c.account.name,
        type: c.account.type,
        pass_through: !!c.account.pass_through,
        money_in: 0,
        money_out: 0,
        count: 0,
      };
      if (cents >= 0) row.money_in += cents;
      else row.money_out -= cents;
      row.count += 1;
      outside.set(c.account.key, row);
    }
  }

  const chart = CHART_OF_ACCOUNTS
    .filter((a) => (a.scope === 'shared' || a.scope === entityId) && inNetIncome(a) && !UNFILED_KEYS.has(a.key))
    .sort((a, b) => a.sort - b.sort);
  const byKey = new Map(chart.map((a) => [a.key, a]));

  const sections: PnlSection[] = SECTION_ORDER.map((id) => {
    const sign = INFLOW[id] ? 1 : -1;
    const inSection = chart.filter((a) => a.type === id);
    // A child files under its parent only when the parent is in the same section.
    const parentOf = (a: CoaAccount) => {
      const p = a.parent_key ? byKey.get(a.parent_key) : undefined;
      return p && p.type === id ? p : undefined;
    };
    const childrenOf = (key: string) => inSection.filter((a) => parentOf(a)?.key === key);
    const ownMonths = (key: string) => (own.get(key) ?? zeros()).map((v) => v * sign);
    const subtree = (a: CoaAccount): number[] => childrenOf(a.key).reduce((acc, ch) => add(acc, subtree(ch)), ownMonths(a.key));
    const active = (a: CoaAccount): boolean => own.has(a.key) || childrenOf(a.key).some(active);

    const lines: PnlLine[] = [];
    const emit = (a: CoaAccount, depth: number) => {
      const kids = childrenOf(a.key).filter(active);
      const mine = ownMonths(a.key);
      if (kids.length === 0) {
        lines.push({ key: a.key, name: a.name, depth, kind: 'account', heading: false, uncategorized: false, months: mine, total: sum(mine) });
        return;
      }
      const heading = !own.has(a.key);
      lines.push({ key: a.key, name: a.name, depth, kind: 'account', heading, uncategorized: false, months: mine, total: sum(mine) });
      for (const k of kids) emit(k, depth + 1);
      const all = subtree(a);
      lines.push({ key: a.key, name: `Total ${a.name}`, depth, kind: 'total', heading: false, uncategorized: false, months: all, total: sum(all) });
    };
    for (const a of inSection) if (!parentOf(a) && active(a)) emit(a, 0);

    const unfiled = id === 'income' ? UNCATEGORIZED_INCOME_KEY : id === 'expense' ? UNCATEGORIZED_EXPENSE_KEY : null;
    if (unfiled && own.has(unfiled)) {
      const m = ownMonths(unfiled);
      lines.push({
        key: unfiled,
        name: id === 'income' ? 'Uncategorized Income' : 'Uncategorized Expense',
        depth: 0, kind: 'account', heading: false, uncategorized: true, months: m, total: sum(m),
      });
    }

    const months = lines.filter((l) => l.kind === 'account').reduce((acc, l) => add(acc, l.months), zeros());
    return { id, title: SECTION_TITLES[id], lines, months, total: sum(months) };
  });

  const s = Object.fromEntries(sections.map((x) => [x.id, x.months])) as Record<PnlSectionId, number[]>;
  const gross = sub(s.income, s.cogs);
  const noi = sub(gross, s.expense);
  const other = sub(s.other_income, s.other_expense);

  return {
    entity_id: entityId,
    entity_name: entity.name,
    year,
    sections,
    gross_profit: subtotal(gross),
    net_operating_income: subtotal(noi),
    net_other_income: subtotal(other),
    net_income: subtotal(add(noi, other)),
    outside: [...outside.values()].sort((a, b) => (coaAccountFor(entityId, a.key)?.sort ?? 0) - (coaAccountFor(entityId, b.key)?.sort ?? 0)),
    counts,
    off_chart_keys: [...offChart].sort(),
    final: counts.transactions > 0 && counts.on_proposal === 0 && counts.uncategorized === 0,
    last_month: lastMonth,
  };
}

// ── The spreadsheet the CPA gets ─────────────────────────────────────────

export type Cell = string | number | null;

const dollars = (cents: number) => cents / 100;

/** One line of review status, for the report's header and the export. */
export function pnlStatusLine(r: PnlReport): string {
  const c = r.counts;
  if (c.transactions === 0) return `No transactions on file for ${r.year}.`;
  if (r.final) return `Final: all ${c.transactions} transactions reviewed.`;
  const parts: string[] = [];
  if (c.on_proposal > 0) parts.push(`${c.on_proposal} on the categorizer's proposal, not yet reviewed`);
  if (c.uncategorized > 0) parts.push(`${c.uncategorized} uncategorized`);
  return `Draft: ${parts.join('; ')}. ${c.transactions} transactions in all.`;
}

/**
 * The P&L as rows of cells: a title block, the month grid with a Total
 * column, and the "Not in net income" block. Amounts are dollars (numbers,
 * not strings) so the spreadsheet can sum them.
 */
export function pnlSheetRows(r: PnlReport): Cell[][] {
  const blank = (): Cell[] => [];
  const money = (months: number[], total: number): Cell[] => [...months.map(dollars), dollars(total)];
  const rows: Cell[][] = [
    [r.entity_name],
    [`Profit and Loss, January to December ${r.year}, cash basis`],
    [pnlStatusLine(r)],
    blank(),
    ['', ...MONTH_NAMES.map((m) => `${m} ${r.year}`), 'Total'],
  ];
  const indent = (depth: number, name: string) => `${'    '.repeat(depth + 1)}${name}`;
  const byId = Object.fromEntries(r.sections.map((x) => [x.id, x])) as Record<PnlSectionId, PnlSection>;
  const section = (id: PnlSectionId, always: boolean) => {
    const sec = byId[id];
    if (!always && sec.lines.length === 0) return false;
    rows.push([sec.title]);
    for (const l of sec.lines) {
      rows.push(l.heading ? [indent(l.depth, l.name)] : [indent(l.depth, l.name), ...money(l.months, l.total)]);
    }
    rows.push([`Total ${sec.title}`, ...money(sec.months, sec.total)]);
    return true;
  };

  section('income', true);
  if (section('cogs', false)) rows.push(['Gross Profit', ...money(r.gross_profit.months, r.gross_profit.total)]);
  section('expense', true);
  const hasOther = byId.other_income.lines.length > 0 || byId.other_expense.lines.length > 0;
  if (hasOther) {
    rows.push(['Net Operating Income', ...money(r.net_operating_income.months, r.net_operating_income.total)]);
    section('other_income', false);
    section('other_expense', false);
    rows.push(['Net Other Income', ...money(r.net_other_income.months, r.net_other_income.total)]);
  }
  rows.push(['Net Income', ...money(r.net_income.months, r.net_income.total)]);

  if (r.outside.length > 0) {
    rows.push(blank());
    rows.push(['Not in net income: balance sheet and owner trust movements for the year']);
    rows.push(['Account', 'Kind', 'Money in', 'Money out', 'Net', 'Transactions']);
    for (const o of r.outside) {
      const kind = o.pass_through ? 'Owner trust (pass-through)' : o.type === 'liability' ? 'Liability' : 'Equity';
      // The count is text so a spreadsheet's money format never reads it as dollars.
      rows.push([o.name, kind, dollars(o.money_in), dollars(o.money_out), dollars(o.money_in - o.money_out), String(o.count)]);
    }
  }
  return rows;
}

export type DetailTxn = PnlTxn & { description: string; account_label: string | null };

/** Every transaction of the year with how the P&L filed it, oldest first. */
export function transactionSheetRows(entityId: string, year: number, txns: DetailTxn[]): Cell[][] {
  const { start, endExclusive } = yearBounds(year);
  const rows: Cell[][] = [['Date', 'Account', 'Description', 'Amount', 'Category', 'Status', 'In net income']];
  const inYear = txns
    .filter((t) => t.txn_date >= start && t.txn_date < endExclusive)
    .sort((a, b) => a.txn_date.localeCompare(b.txn_date));
  for (const t of inYear) {
    const c = classifyTxn(entityId, t);
    const category = c.account ? c.account.name : toCents(t.amount) >= 0 ? 'Uncategorized Income' : 'Uncategorized Expense';
    const status = c.status === 'reviewed' ? 'Reviewed' : c.status === 'proposal' ? 'Proposed, not reviewed' : 'Uncategorized';
    const counted = !c.account || inNetIncome(c.account);
    rows.push([t.txn_date, t.account_label, t.description, dollars(toCents(t.amount)), category, status, counted ? 'Yes' : 'No']);
  }
  return rows;
}

/** RFC 4180 CSV: a cell with a comma, quote or newline is quoted. */
export function rowsToCsv(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** The download's file name: "Goose-of-Astoria-LLC-PL-2026". */
export function pnlFileBase(r: Pick<PnlReport, 'entity_name' | 'year'>): string {
  return `${r.entity_name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-PL-${r.year}`;
}
