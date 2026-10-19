/**
 * An LLC's year-end balance sheet, end to end, on synthetic Chase exports
 * (no customer data): a bank CSV with Chase's running Balance column and a
 * card CSV are parsed and turned into ledger rows the way upload stores
 * them, filed, given opening figures and two year-end journal entries, and
 * reported as the sheet and the workbook the CPA gets, which is read back.
 *
 * Then the rules that keep it honest: it balances for any ledger at all;
 * its net income is the P&L's; earlier years become retained earnings;
 * each bank account is checked against Chase's own balance; Rising Tide's
 * trust cash matches what it owes owners; the forms read money and dates
 * strictly; and the migration and the routes hold the guards.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { ledgerRowsFromParsed, parseChaseBankCsv, parseChaseCreditCardCsv } from '../chase-csv.ts';
import { CHART_OF_ACCOUNTS, accountsForEntity } from '../books.ts';
import { buildPnl, journalLines, pnlStatusLine, rowsToCsv, transactionSheetRows, type JournalEntry, type PnlTxn } from '../books-pnl.ts';
import {
  DEFAULT_OPENING_DATE,
  TRUST_KEY,
  balanceSheetYears,
  bsDateLabel,
  bsFileBase,
  bsSheetRows,
  bsStatusLine,
  buildBalanceSheet,
  chaseBalanceFromRaw,
  chaseDayBalances,
  isIsoDate,
  journalAccountsFor,
  openingLinesFor,
  parseMoneyInput,
  validateJournalEntry,
  type BalanceSheet,
  type BsAccountRow,
  type BsInput,
  type BsOpening,
  type BsTxn,
} from '../books-balance-sheet.ts';
import { BS_SHEET, JOURNAL_SHEET, OPENING_SHEET, balanceSheetWorkbook } from '../books-balance-sheet-xlsx.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

/** The cents on one line of the sheet, by id and kind. */
function lineOf(bs: BalanceSheet, id: string, kind: 'account' | 'total' = 'account') {
  for (const s of bs.sections) for (const g of s.groups) for (const l of g.lines) if (l.id === id && l.kind === kind) return l;
  return undefined;
}
const groupOf = (bs: BalanceSheet, id: string) => bs.sections.flatMap((s) => s.groups).find((g) => g.id === id);

// ── Synthetic Chase exports, in Chase's own column shapes ────────────────
// Newest first, as Chase exports them. The Balance column is the running
// balance after each row; the account opened 2026 with $10,000.00.

const BANK_CSV = [
  'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
  'DEBIT,03/01/2026,TEST TOWN TAX COLLECTOR,-1000.00,ACH_DEBIT,7400.00,,',
  'DEBIT,03/01/2026,TEST EASTERN BANK HEAT LOAN,-250.00,ACH_DEBIT,8400.00,,',
  'DEBIT,02/20/2026,ONLINE TRANSFER TO PARTNER TEST,-400.00,ACCT_XFER,8650.00,,',
  'DEBIT,02/15/2026,TEST MORTGAGE SERVICER PMT,-2000.00,ACH_DEBIT,9050.00,,',
  'DEBIT,01/20/2026,Payment to Chase card ending in 9999 01/20,-150.00,LOAN_PMT,11050.00,,',
  'DEBIT,01/15/2026,TEST MORTGAGE SERVICER PMT,-2000.00,ACH_DEBIT,11200.00,,',
  'CREDIT,01/05/2026,TEST BOOKING PLATFORM PAYOUT,3200.00,ACH_CREDIT,13200.00,,',
  '',
].join('\r\n');

const CARD_CSV = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '02/02/2026,02/03/2026,TEST HARDWARE STORE,Home,Sale,-45.00,',
  '01/20/2026,01/20/2026,Payment Thank You-Mobile,,Payment,150.00,',
  '01/10/2026,01/11/2026,TEST HARDWARE STORE,Home,Sale,-80.00,',
  '',
].join('\r\n');

const FILED: Record<string, string> = {
  'TEST TOWN TAX COLLECTOR': 'property_taxes',
  'TEST EASTERN BANK HEAT LOAN': 'heat_loan',
  'ONLINE TRANSFER TO PARTNER TEST': 'owner_draw',
  'TEST MORTGAGE SERVICER PMT': 'mortgage_65_calderwood',
  'Payment to Chase card ending in 9999 01/20': 'intercompany_due',
  'TEST BOOKING PLATFORM PAYOUT': 'str_income',
  'TEST HARDWARE STORE': 'repairs_maintenance',
  'Payment Thank You-Mobile': 'intercompany_due',
};

const BANK: BsAccountRow = { id: 'acct-bank', kind: 'bank', label: 'Business Complete CHK', last4: '0000', property_id: null };
const CARD: BsAccountRow = { id: 'acct-card', kind: 'credit_card', label: 'Test Credit Card', last4: '9999', property_id: null };

/** Ledger rows exactly as upload stores them, then filed and reviewed the way review writes. */
function calderwoodLedger(): BsTxn[] {
  const stored = [
    ...ledgerRowsFromParsed({ id: BANK.id, entity_id: 'goose_calderwood' }, parseChaseBankCsv(BANK_CSV)),
    ...ledgerRowsFromParsed({ id: CARD.id, entity_id: 'goose_calderwood' }, parseChaseCreditCardCsv(CARD_CSV)),
  ];
  return stored.map((r) => ({
    txn_date: r.txn_date,
    amount: r.amount,
    category_key: FILED[r.description] ?? null,
    ai_category_key: FILED[r.description] ?? null,
    reviewed: true,
    account_id: r.account_id,
    chase_balance: chaseBalanceFromRaw(r.raw),
  }));
}

const CALDERWOOD_OPENINGS: BsOpening[] = [
  { account_id: BANK.id, category_key: null, amount: '10000.00' },
  { account_id: CARD.id, category_key: null, amount: 150 },
  { account_id: null, category_key: 'mortgage_65_calderwood', amount: 400000 },
  { account_id: null, category_key: 'heat_loan', amount: 6000 },
  { account_id: null, category_key: 'land', amount: 200000 },
  { account_id: null, category_key: 'buildings_improvements', amount: 500000 },
  { account_id: null, category_key: 'accumulated_depreciation', amount: 50000 },
];

const CALDERWOOD_JOURNAL: JournalEntry[] = [
  { entry_date: '2026-12-31', debit_key: 'mortgage_interest_65_calderwood', credit_key: 'mortgage_65_calderwood', amount: 2600, memo: '2026 interest per the 1098 (test)' },
  { entry_date: '2026-12-31', debit_key: 'heat_loan', credit_key: 'owner_contribution', amount: '1000.00', memo: 'Heat loan paid personally (test)' },
];

function calderwood(overrides: Partial<BsInput> = {}): BalanceSheet {
  return buildBalanceSheet({
    entityId: 'goose_calderwood',
    year: 2026,
    openingDate: '2025-12-31',
    accounts: [BANK, CARD],
    openings: CALDERWOOD_OPENINGS,
    txns: calderwoodLedger(),
    journal: CALDERWOOD_JOURNAL,
    ...overrides,
  });
}

describe('Goose of Calderwood, from two Chase exports to the CPA workbook', () => {
  test('upload keeps Chase\'s Balance cell where the sheet reads it; card rows have none', () => {
    const rows = calderwoodLedger();
    assert.equal(rows.filter((r) => r.account_id === BANK.id).every((r) => r.chase_balance != null), true);
    assert.equal(rows.filter((r) => r.account_id === CARD.id).every((r) => r.chase_balance == null), true);
    assert.equal(chaseBalanceFromRaw({ row: { Balance: '7400.00' } }), '7400.00');
    for (const bad of [null, 'x', {}, { row: null }, { row: {} }]) assert.equal(chaseBalanceFromRaw(bad), null);
  });

  test('cash is the opening plus the year\'s rows, and it matches Chase', () => {
    const bs = calderwood();
    assert.equal(lineOf(bs, `acct:${BANK.id}`)?.current, 740000);
    assert.equal(lineOf(bs, `acct:${BANK.id}`)?.prior, 1000000);
    const check = bs.bank_checks.find((c) => c.account_id === BANK.id);
    assert.deepEqual([check?.status, check?.date, check?.helm, check?.chase], ['match', '2026-03-01', 740000, 740000]);
    assert.deepEqual(bs.opening_hints, [{ account_id: BANK.id, name: 'Business Complete CHK x0000', date: '2026-01-05', chase_before: 1000000 }]);
  });

  test('the card is a liability: purchases raise it, the payoff lowers it, and the payoff\'s two sides cancel', () => {
    const bs = calderwood();
    assert.equal(lineOf(bs, `acct:${CARD.id}`)?.current, 12500);
    assert.equal(groupOf(bs, 'cards')?.current, 12500);
    assert.equal(lineOf(bs, 'coa:intercompany_due'), undefined, 'a payoff with both sides uploaded nets to nothing');
  });

  test('the mortgage takes the payments and gets the 1098 interest back; the heat loan takes a partner\'s payment', () => {
    const bs = calderwood();
    assert.equal(lineOf(bs, 'coa:mortgage_65_calderwood')?.current, 40000000 - 400000 + 260000);
    assert.equal(lineOf(bs, 'coa:heat_loan')?.current, 600000 - 25000 - 100000);
    assert.equal(bs.total_liabilities.current, 12500 + 39860000 + 475000);
  });

  test('fixed assets at cost, less accumulated depreciation, named once', () => {
    const bs = calderwood();
    const fixed = groupOf(bs, 'fixed_assets')!;
    assert.deepEqual(fixed.lines.map((l) => [l.name, l.depth, l.current]), [
      ['Land', 0, 20000000],
      ['Buildings & Improvements', 0, 50000000],
      ['Accumulated Depreciation', 0, -5000000],
    ]);
    assert.equal(fixed.current, 65000000);
    assert.equal(bs.total_assets.current, 740000 + 65000000);
  });

  test('equity: opening balance equity is the opening\'s difference; net income is the P&L\'s, journal entries included', () => {
    const bs = calderwood();
    assert.equal(lineOf(bs, 'obe')?.current, (1000000 + 20000000 + 50000000 - 5000000) - (15000 + 40000000 + 600000));
    assert.equal(lineOf(bs, 'coa:owner_contribution')?.current, 100000);
    assert.equal(lineOf(bs, 'coa:owner_draw')?.current, -40000);
    assert.equal(lineOf(bs, 'ni')?.current, 320000 - 100000 - 12500 - 260000);
    assert.equal(bs.pnl.net_income.total, lineOf(bs, 'ni')?.current);
    assert.equal(bs.pnl.journal_entries, 2);
    assert.equal(bs.balanced, true);
    assert.equal(bs.total_assets.current, bs.total_liabilities_and_equity.current);
    assert.equal(bs.total_assets.prior, bs.total_liabilities_and_equity.prior);
  });

  test('the equity rollforward is the CPA\'s capital account for the year', () => {
    const e = calderwood().equity!;
    assert.deepEqual(e, {
      beginning: 25385000,
      contributions: 100000,
      distributions: -40000,
      net_income: -52500,
      other: 0,
      ending: 25385000 + 100000 - 40000 - 52500,
    });
  });

  test('every figure entered and every row reviewed: final', () => {
    const bs = calderwood();
    assert.deepEqual(bs.missing_openings, []);
    assert.equal(bs.final, true);
    assert.equal(bsStatusLine(bs), 'Final: every transaction since Dec 31, 2025 reviewed, and every account has an opening balance.');
  });

  test('a wrong opening shows against Chase, and a missing one is named', () => {
    const bs = calderwood({ openings: CALDERWOOD_OPENINGS.filter((o) => o.account_id !== CARD.id && o.category_key !== 'heat_loan').map((o) => (o.account_id === BANK.id ? { ...o, amount: 9900 } : o)) });
    const check = bs.bank_checks.find((c) => c.account_id === BANK.id)!;
    assert.deepEqual([check.status, check.helm! - check.chase!], ['mismatch', -10000]);
    assert.deepEqual(bs.missing_openings.map((m) => [m.name, m.why]), [['Test Credit Card x9999', 'no_opening'], ['Heat Loan', 'postings']]);
    assert.equal(bs.final, false);
    assert.equal(bsStatusLine(bs), 'Draft: 2 balances with no opening figure.');
    assert.equal(bs.balanced, true, 'a wrong figure moves opening balance equity, never the balance');
  });

  test('rows still on a proposal or uncategorized keep it a draft', () => {
    const txns = calderwoodLedger().map((t, i) => (i === 0 ? { ...t, category_key: null, reviewed: false } : i === 1 ? { ...t, category_key: null, ai_category_key: null, reviewed: false } : t));
    const bs = calderwood({ txns });
    assert.deepEqual([bs.counts.on_proposal, bs.counts.uncategorized], [1, 1]);
    assert.equal(bsStatusLine(bs), "Draft: 1 transaction on the categorizer's proposal; 1 uncategorized.");
    assert.equal(bs.balanced, true);
  });

  test('the sheet rows: title block, two dated columns, every section, the rollforward and the checks', () => {
    const rows = bsSheetRows(calderwood());
    assert.deepEqual(rows.slice(0, 2), [['Goose of Calderwood LLC'], ['Balance Sheet, Dec 31, 2026, cash basis']]);
    assert.deepEqual(rows[5], ['', 'Dec 31, 2025', 'Dec 31, 2026']);
    const find = (label: string) => rows.find((r) => r[0] === label);
    assert.deepEqual(find('Total Assets'), ['Total Assets', 660000, 657400]);
    assert.deepEqual(find('Total Liabilities'), ['Total Liabilities', 406150, 403475]);
    assert.deepEqual(find('Total Liabilities and Equity'), ['Total Liabilities and Equity', 660000, 657400]);
    assert.deepEqual(find('    Contributions'), ['    Contributions', 1000]);
    assert.ok(rows.some((r) => r[0] === 'Business Complete CHK x0000' && r[5] === 'Matches Chase'));
    assert.match(rowsToCsv(rows), /^Goose of Calderwood LLC\r\n"Balance Sheet, Dec 31, 2026, cash basis"\r\n/);
  });

  test('the workbook the CPA downloads reads back: the sheet, the openings and the year\'s entries', () => {
    const bs = calderwood();
    const lines = openingLinesFor('goose_calderwood', [BANK, CARD]);
    const wb = XLSX.read(balanceSheetWorkbook(bs, lines, CALDERWOOD_OPENINGS, CALDERWOOD_JOURNAL), { type: 'array' });
    assert.deepEqual(wb.SheetNames, [BS_SHEET, OPENING_SHEET, JOURNAL_SHEET]);
    const sheet = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[BS_SHEET], { header: 1 });
    assert.deepEqual(sheet.find((r) => r[0] === 'Total Assets'), ['Total Assets', 660000, 657400]);
    const openings = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[OPENING_SHEET], { header: 1 });
    assert.deepEqual(openings.find((r) => r[1] === 'Accumulated Depreciation'), ['Fixed assets', 'Accumulated Depreciation', 'Depreciation taken so far, as a positive number', 50000]);
    const journal = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[JOURNAL_SHEET], { header: 1 });
    assert.deepEqual(journal[1], ['2026-12-31', 'Mortgage Interest, 65 Calderwood', 'Mortgage, 65 Calderwood', 2600, '2026 interest per the 1098 (test)']);
    assert.equal(bsFileBase(bs), 'Goose-of-Calderwood-LLC-Balance-Sheet-2026');
  });
});

describe('the rules that keep each LLC\'s balance sheet honest', () => {
  const t = (txn_date: string, amount: number, key: string | null, account_id: string | null = BANK.id): BsTxn =>
    ({ txn_date, amount, category_key: key, ai_category_key: key, reviewed: true, account_id });
  const sheet = (txns: BsTxn[], extra: Partial<BsInput> = {}) =>
    buildBalanceSheet({ entityId: 'goose_astoria', year: 2026, openingDate: '2025-12-31', accounts: [BANK, CARD], openings: [], txns, journal: [], ...extra });

  test('it balances for any ledger at all, and its net income is always the P&L\'s', () => {
    let seed = 20261019;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const keys = [...accountsForEntity('goose_astoria').map((a) => a.key), null, 'str_income', 'made_up', 'suspense'];
    const accts = [BANK.id, CARD.id, null, 'someone-elses'];
    for (let run = 0; run < 25; run++) {
      const txns: BsTxn[] = [];
      for (let i = 0; i < 60; i++) {
        const d = `${2025 + Math.floor(rand() * 3)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
        txns.push(t(d, Math.round((rand() - 0.5) * 200000) / 100, keys[Math.floor(rand() * keys.length)], accts[Math.floor(rand() * accts.length)]));
      }
      const pick = () => journalAccountsFor('goose_astoria')[Math.floor(rand() * journalAccountsFor('goose_astoria').length)].key;
      const journal: JournalEntry[] = Array.from({ length: 5 }, (_, i) => ({ entry_date: `2026-0${1 + i}-15`, debit_key: pick(), credit_key: pick(), amount: Math.round(rand() * 100000) / 100, memo: 'x' }));
      const openings: BsOpening[] = [
        { account_id: BANK.id, category_key: null, amount: Math.round(rand() * 1e6) / 100 },
        { account_id: CARD.id, category_key: null, amount: Math.round(rand() * 1e5) / 100 },
        { account_id: null, category_key: 'mortgage_3_locust', amount: 250000 },
        { account_id: null, category_key: 'accumulated_depreciation', amount: 1234.56 },
        { account_id: null, category_key: 'retained_earnings', amount: 777 },
      ];
      for (const year of [2026, 2027]) {
        const bs = sheet(txns, { year, journal, openings });
        assert.equal(bs.balanced, true, `run ${run} ${year}`);
        assert.equal(bs.total_assets.current - bs.total_liabilities.current, bs.total_equity.current);
        assert.equal(bs.pnl.net_income.total, lineOf(bs, 'ni')?.current, `run ${run} ${year}: net income is the P&L's`);
        if (bs.equity) assert.equal(bs.equity.beginning + bs.equity.contributions + bs.equity.distributions + bs.equity.net_income + bs.equity.other, bs.equity.ending);
      }
    }
  });

  test('earlier years since the books opened are retained earnings; the column\'s own year is net income', () => {
    const bs = sheet([t('2026-03-01', 1000, 'rental_income'), t('2027-03-01', 500, 'rental_income')], { year: 2027 });
    assert.deepEqual([lineOf(bs, 're')?.prior, lineOf(bs, 'ni')?.prior], [0, 100000]);
    assert.deepEqual([lineOf(bs, 're')?.current, lineOf(bs, 'ni')?.current], [100000, 50000]);
    assert.deepEqual(bs.dates, { prior: '2026-12-31', current: '2027-12-31' });
    assert.equal(bs.equity?.net_income, 50000);
    assert.equal(bs.equity?.other, 0, 'last year\'s income moving into retained earnings is not a movement');
  });

  test('only rows after the opening date and through December 31 count', () => {
    const bs = sheet([t('2025-12-31', 999, 'rental_income'), t('2026-01-01', 10, 'rental_income'), t('2027-01-01', 999, 'rental_income')], {
      journal: [{ entry_date: '2025-12-31', debit_key: 'supplies', credit_key: 'owner_contribution', amount: 5, memo: 'before' }],
    });
    assert.equal(lineOf(bs, `acct:${BANK.id}`)?.current, 1000);
    assert.equal(bs.counts.transactions, 1);
    assert.equal(bs.counts.journal_entries, 0);
  });

  test('a mid-year opening date is the earlier column, and the P&L counts only what came after it', () => {
    const bs = sheet([t('2026-03-01', 100, 'rental_income'), t('2026-09-01', 40, 'rental_income')], { openingDate: '2026-06-30' });
    assert.deepEqual(bs.dates, { prior: '2026-06-30', current: '2026-12-31' });
    assert.equal(lineOf(bs, 'ni')?.current, 4000);
    assert.equal(bs.pnl.net_income.total, 4000);
    assert.throws(() => sheet([], { openingDate: '2027-01-15' }), /after 2026-12-31/);
  });

  test('on its own opening date the sheet is one column: the openings and nothing else', () => {
    const bs = sheet([t('2026-01-02', 5, 'rental_income')], { year: 2025, openings: [{ account_id: BANK.id, category_key: null, amount: 50 }] });
    assert.deepEqual(bs.dates, { prior: null, current: '2025-12-31' });
    assert.equal(lineOf(bs, `acct:${BANK.id}`)?.current, 5000);
    assert.equal(lineOf(bs, 'obe')?.current, 5000);
    assert.equal(bs.equity, null);
    assert.deepEqual(bsSheetRows(bs)[5], ['', 'Dec 31, 2025']);
  });

  test('a capital improvement is an asset, not an expense: cash goes down, the building goes up, net income does not move', () => {
    const bs = sheet([t('2026-05-01', -20000, 'buildings_improvements')]);
    assert.equal(lineOf(bs, 'coa:buildings_improvements')?.current, 2000000);
    assert.equal(lineOf(bs, 'ni')?.current, 0);
    assert.equal(bs.pnl.outside.find((o) => o.key === 'buildings_improvements')?.type, 'asset');
  });

  test('a row with no account on file still balances, on its own cash line', () => {
    const bs = sheet([t('2026-05-01', 75, 'rental_income', null)]);
    assert.equal(lineOf(bs, 'cash_unrecorded')?.current, 7500);
    assert.equal(bs.balanced, true);
  });

  test('Rising Tide: trust cash and what is owed to owners move together; the fee is the company\'s income', () => {
    const trust: BsAccountRow = { id: 'trust', kind: 'bank', label: 'Test Home', last4: '1111', property_id: 'test_home' };
    const operating: BsAccountRow = { id: 'op', kind: 'bank', label: 'Operating', last4: '2222', property_id: null };
    const bs = buildBalanceSheet({
      entityId: 'rising_tide',
      year: 2026,
      openingDate: '2025-12-31',
      accounts: [trust, operating],
      openings: [
        { account_id: 'trust', category_key: null, amount: 5000 },
        { account_id: 'op', category_key: null, amount: 1000 },
        { account_id: null, category_key: TRUST_KEY, amount: 5000 },
      ],
      txns: [
        t('2026-04-01', 9000, 'accommodation_fares', 'trust'),
        t('2026-04-05', -2000, 'str_management_fees', 'trust'),
        t('2026-04-05', -6000, 'property_owner_payouts', 'trust'),
        t('2026-04-05', 2000, 'property_management_income', 'op'),
      ],
      journal: [],
    });
    assert.equal(groupOf(bs, 'trust_cash')?.current, 600000);
    assert.equal(lineOf(bs, `coa:${TRUST_KEY}`)?.current, 600000);
    assert.equal(bs.trust_gap, 0);
    assert.equal(lineOf(bs, 'ni')?.current, 200000);
    assert.equal(groupOf(bs, 'cards'), undefined, 'no card, no card group');
    assert.equal(bs.balanced, true);
  });

  test('Chase\'s day: each row\'s Balance is after it, so the leftovers are the day\'s start and end', () => {
    assert.deepEqual(chaseDayBalances([{ amount: -250, chase_balance: '8400.00' }, { amount: -1000, chase_balance: '7400.00' }]), { start: 865000, end: 740000 });
    assert.deepEqual(chaseDayBalances([{ amount: -1000, chase_balance: '7400.00' }, { amount: -250, chase_balance: '8400.00' }]), { start: 865000, end: 740000 }, 'order does not matter');
    assert.deepEqual(chaseDayBalances([{ amount: 5, chase_balance: '10.00' }]), { start: 500, end: 1000 });
    assert.deepEqual(chaseDayBalances([{ amount: 5, chase_balance: '' }]), { start: null, end: null });
    assert.deepEqual(chaseDayBalances([]), { start: null, end: null });
  });

  test('a bank day with no Balance column is not checked, and an account with no rows says so', () => {
    const bs = sheet([{ ...t('2026-02-01', 10, 'rental_income'), chase_balance: null }]);
    assert.deepEqual(bs.bank_checks.map((c) => c.status), ['no_balance']);
    const empty = sheet([]);
    assert.deepEqual(empty.bank_checks.map((c) => c.status), ['no_rows']);
    assert.equal(bsStatusLine(empty), 'Nothing on file yet: no opening balances and no transactions since Dec 31, 2025.');
  });
});

describe('the forms read strictly', () => {
  test('money: dollars and cents, commas, a sign or parentheses; blank is no figure', () => {
    const cents = (s: string) => {
      const p = parseMoneyInput(s);
      return p.ok ? p.cents : 'bad';
    };
    assert.equal(cents('$12,345.67'), 1234567);
    assert.equal(cents('12345.6'), 1234560);
    assert.equal(cents('-500'), -50000);
    assert.equal(cents('(500.25)'), -50025);
    assert.equal(cents('0'), 0);
    assert.equal(cents('   '), null);
    for (const bad of ['abc', '1.234', '12-3', '$', '1e5']) assert.equal(cents(bad), 'bad', bad);
  });

  test('dates are real calendar days', () => {
    assert.equal(isIsoDate('2025-12-31'), true);
    for (const bad of ['2025-02-30', '2025-13-01', '12/31/2025', '', null, undefined]) assert.equal(isIsoDate(bad), false);
    assert.equal(bsDateLabel('2026-01-05'), 'Jan 5, 2026');
    assert.deepEqual(balanceSheetYears(DEFAULT_OPENING_DATE, 2026), [2026, 2025]);
    assert.deepEqual(balanceSheetYears('2026-06-30', 2026), [2026]);
  });

  test('a journal entry needs a date after the opening, two different chart accounts, a positive amount and a memo', () => {
    const ok = { entry_date: '2026-12-31', debit_key: 'mortgage_interest_65_calderwood', credit_key: 'mortgage_65_calderwood', amount: '2,600.00', memo: '1098' };
    assert.deepEqual(validateJournalEntry('goose_calderwood', ok, '2025-12-31'), { ok: true, cents: 260000 });
    const err = (d: Partial<typeof ok>, opening: string | null = '2025-12-31') => {
      const v = validateJournalEntry('goose_calderwood', { ...ok, ...d }, opening);
      return v.ok ? null : v.error;
    };
    assert.match(err({ entry_date: '2025-12-31' })!, /after that/);
    assert.equal(err({ entry_date: '2025-06-01' }, null), null, 'no opening date yet: any date');
    assert.match(err({ debit_key: 'mortgage_3_locust' })!, /from the chart/, 'another entity\'s account');
    assert.match(err({ credit_key: 'suspense' })!, /from the chart/);
    assert.match(err({ credit_key: ok.debit_key })!, /different/);
    assert.match(err({ amount: '-5' })!, /positive/);
    assert.match(err({ amount: '0' })!, /positive/);
    assert.match(err({ memo: '  ' })!, /memo/);
  });

  test('the opening form asks for each bank and card account, each asset and liability, and never equity', () => {
    const trust: BsAccountRow = { id: 't', kind: 'bank', label: 'Test Home', last4: '1111', property_id: 'test_home' };
    const gone: BsAccountRow = { id: 'g', kind: 'bank', label: 'Closed', last4: '3333', property_id: null, inactive: true };
    const lines = openingLinesFor('rising_tide', [BANK, CARD, trust, gone]);
    const groups = [...new Set(lines.map((l) => l.group))];
    assert.deepEqual(groups, ['Bank accounts', 'Cash held in trust for owners', 'Credit cards', 'Fixed assets', 'Other assets', 'Loans and other liabilities']);
    assert.ok(!lines.some((l) => l.id === 'acct:g'), 'an inactive account is not asked for');
    assert.ok(!lines.some((l) => l.category_key === 'fixed_assets'), 'the heading carries no figure');
    assert.ok(lines.some((l) => l.category_key === TRUST_KEY));
    assert.ok(!lines.some((l) => l.category_key === 'mortgage_65_calderwood'), 'another entity\'s loan');
    const keys = new Set(lines.map((l) => l.category_key).filter(Boolean));
    for (const a of CHART_OF_ACCOUNTS) if (a.type === 'equity' || a.pass_through) assert.ok(!keys.has(a.key), a.key);
    assert.ok(!journalAccountsFor('rising_tide').some((a) => a.key === 'uncategorized' || a.key === 'suspense'));
  });
});

describe('the P&L reads the journal entries too', () => {
  const t = (txn_date: string, amount: number, key: string): PnlTxn => ({ txn_date, amount, category_key: key, ai_category_key: key, reviewed: true });
  const entry: JournalEntry = { entry_date: '2026-12-31', debit_key: 'mortgage_interest_65_calderwood', credit_key: 'mortgage_65_calderwood', amount: 1500, memo: 'interest per the 1098' };

  test('an entry files one line per side: interest becomes an expense, and it is not a transaction', () => {
    assert.deepEqual(journalLines(entry).map((l) => [l.category_key, l.amount]), [['mortgage_interest_65_calderwood', -1500], ['mortgage_65_calderwood', 1500]]);
    const r = buildPnl('goose_calderwood', 2026, [t('2026-02-01', -2000, 'mortgage_65_calderwood'), t('2026-02-02', 3000, 'str_income')], [entry]);
    assert.equal(r.net_income.total, 300000 - 150000);
    assert.equal(r.counts.transactions, 2);
    assert.equal(r.journal_entries, 1);
    const mortgage = r.outside.find((o) => o.key === 'mortgage_65_calderwood')!;
    assert.deepEqual([mortgage.money_in, mortgage.money_out, mortgage.count], [150000, 200000, 1]);
    assert.match(pnlStatusLine(r), /1 year-end journal entry\.$/);
  });

  test('an entry in another year is not in this one', () => {
    assert.equal(buildPnl('goose_calderwood', 2026, [], [{ ...entry, entry_date: '2027-01-01' }]).journal_entries, 0);
  });

  test('the transactions sheet lists each side of an entry after the bank rows', () => {
    const rows = transactionSheetRows('goose_calderwood', 2026, [], [entry]);
    assert.deepEqual(rows.slice(1).map((r) => [r[1], r[3], r[4], r[5], r[6]]), [
      ['Journal entry', -1500, 'Mortgage Interest, 65 Calderwood', 'Journal entry', 'Yes'],
      ['Journal entry', 1500, 'Mortgage, 65 Calderwood', 'Journal entry', 'No'],
    ]);
  });
});

// ── The migration and the routes ─────────────────────────────────────────

describe('the balance sheet migration', () => {
  const name = '20261019200000_books_balance_sheet.sql';
  const sql = read(`supabase/migrations/${name}`);

  test('runs after the ledger migrations it alters, and only adds to the chart', () => {
    for (const before of ['20261019180000_books_ledger_tables.sql', '20261019190000_books_ledger_for_pnl.sql']) {
      assert.ok(read(`supabase/migrations/${before}`).length > 0 && before < name, `${name} sorts after ${before}`);
    }
    assert.ok(sql.includes('add column if not exists opening_balance_date date'));
    assert.ok(!/delete\s+from/i.test(sql), 'nothing is deleted');
    assert.ok(sql.includes('drop constraint if exists chart_of_accounts_type_check'), 'the check is replaced by name, so a re-run does not stack it');
  });

  test('both new tables are locked to the service role', () => {
    const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(tables, ['llc_opening_balances', 'ledger_journal_entries']);
    for (const name of tables) {
      assert.ok(sql.includes(`alter table public.${name} enable row level security;`), `${name} has RLS`);
      assert.ok(sql.slice(sql.indexOf('revoke all on'), sql.indexOf('from anon, authenticated;')).includes(`public.${name}`), `${name} is revoked from anon`);
    }
  });

  test('an opening figure is one line, and a journal entry is two different sides of a positive amount', () => {
    assert.ok(sql.includes('check (num_nonnulls(account_id, category_key) = 1)'));
    assert.ok(sql.includes('amount      numeric(14,2) not null check (amount > 0)'));
    assert.ok(sql.includes('check (debit_key <> credit_key)'));
    assert.ok(/uniq_llc_opening_account[\s\S]*where account_id is not null/.test(sql));
    assert.ok(/uniq_llc_opening_category[\s\S]*where category_key is not null/.test(sql));
  });

  test('the widened type check admits every type the chart uses', () => {
    const check = sql.match(/add constraint chart_of_accounts_type_check\s+check \(type in \(([^)]*)\)\)/);
    assert.ok(check, 'the check is replaced');
    const allowed = new Set(check[1].split(',').map((s) => s.trim().replace(/'/g, '')));
    for (const a of CHART_OF_ACCOUNTS) assert.ok(allowed.has(a.type), `${a.key}: ${a.type}`);
  });
});

describe('the page, the export and the actions (source guards)', () => {
  test('the page and the export read one loader, which pages past 1000 rows on a stable sort', () => {
    assert.ok(read('src/app/books/[entity_id]/balance-sheet/page.tsx').includes('await loadBalanceSheet(entity_id, year)'));
    const route = read('src/app/api/books/balance-sheet-export/route.ts');
    assert.ok(route.includes('await loadBalanceSheet(entityId, year)'));
    assert.ok(route.includes('if (!load.openingSaved)'), 'the export refuses a preview');
    const db = read('src/lib/books-balance-sheet-db.ts');
    assert.ok(db.includes('selectAllPaged<LedgerRow>'));
    assert.ok(/\.order\('txn_date'[^)]*\)\s*\.order\('id'/.test(db));
    assert.ok(db.includes('chaseBalanceFromRaw(r.raw)'));
  });

  test('every action is owners only', () => {
    const src = read('src/app/books/[entity_id]/balance-sheet/actions.ts');
    const actions = [...src.matchAll(/export async function (\w+)\(formData: FormData\): Promise<void> \{\n\s+(.*)\n/g)];
    assert.deepEqual(actions.map((m) => m[1]), ['saveOpeningBalances', 'addJournalEntry', 'deleteJournalEntry']);
    for (const m of actions) assert.match(m[2], /await requireOwnerEmail\(\);/, `${m[1]} checks the owner first`);
  });

  test('the P&L reads the same journal entries the sheet does', () => {
    const db = read('src/lib/books-pnl-db.ts');
    assert.ok(db.includes('buildPnl(entityId, year, txns, journal)'));
    assert.ok(read('src/app/api/books/pnl-export/route.ts').includes('pnlWorkbook(load.report, load.txns, load.journal)'));
  });
});
