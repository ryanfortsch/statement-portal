/**
 * An LLC's P&L, end to end, on synthetic Chase exports (no customer data):
 * a bank CSV and a card CSV are parsed, turned into ledger rows, inserted
 * into an in-memory ledger with the same ON CONFLICT (dedupe_hash) DO
 * NOTHING the ingest route uses, categorized the way the categorize and
 * review routes write, and reported as the P&L and the workbook the CPA
 * gets, which is read back.
 *
 * Then the rules that keep the report honest: equity, liability and owner
 * trust money never enter net income; a row with no category is counted
 * and still in net income; a key that is not on the chart is uncategorized;
 * and the migration seeds exactly the chart the app files against.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as XLSX from 'xlsx';
import {
  computeDedupeHash,
  ledgerRowsFromParsed,
  parseChaseBankCsv,
  parseChaseCreditCardCsv,
} from '../chase-csv.ts';
import { CHART_OF_ACCOUNTS, LLC_ACCOUNTS, LLC_ENTITIES, coaAccountFor } from '../books.ts';
import {
  buildPnl,
  classifyTxn,
  inNetIncome,
  parsePnlYear,
  pnlFileBase,
  pnlSheetRows,
  pnlStatusLine,
  rowsToCsv,
  toCents,
  transactionSheetRows,
  type DetailTxn,
  type PnlReport,
} from '../books-pnl.ts';
import { PNL_SHEET, TRANSACTIONS_SHEET, pnlWorkbook } from '../books-pnl-xlsx.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

// ── Synthetic Chase exports, in Chase's own column shapes ────────────────

const BANK_CSV = [
  'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
  'CREDIT,03/02/2026,"DEPOSIT, UNKNOWN SOURCE",50.00,ACH_CREDIT,4000.00,,',
  'DEBIT,02/20/2026,COMM OF MASS EFT MA DOR PAY TEST,-280.80,ACH_DEBIT,3950.00,,',
  'DEBIT,02/03/2026,ONLINE TRANSFER TO PARTNER TEST,-1000.00,ACCT_XFER,4230.80,,',
  'DEBIT,02/01/2026,Payment to Chase card ending in 0000 02/01,-350.00,LOAN_PMT,5230.80,,',
  'DEBIT,01/10/2026,TEST ELECTRIC CO UTIL PMT,-180.25,ACH_DEBIT,5580.80,,',
  'CREDIT,01/05/2026,TEST BOOKING PLATFORM PAYOUT,2400.00,ACH_CREDIT,5761.05,,',
  '',
].join('\r\n');

const CARD_CSV = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '02/10/2026,02/11/2026,TEST STREAMING SVC,Entertainment,Sale,-15.99,',
  '02/01/2026,02/01/2026,Payment Thank You-Mobile,,Payment,350.00,',
  '01/25/2026,01/26/2026,TEST HARDWARE STORE,Home,Return,30.00,',
  '01/22/2026,01/23/2026,TEST TOLL AUTHORITY,Travel,Sale,-5.00,',
  '01/22/2026,01/23/2026,TEST TOLL AUTHORITY,Travel,Sale,-5.00,',
  '01/20/2026,01/21/2026,TEST HARDWARE STORE,Home,Sale,-120.00,',
  '12/31/2025,01/02/2026,TEST HARDWARE STORE,Home,Sale,-64.00,',
].join('\r\n');

// What the categorizer would propose (and what a reviewer confirms), by
// description. 'transfer' is the word the prompt uses that is not a key.
const PROPOSALS: Record<string, [string, 'high' | 'medium' | 'low']> = {
  'DEPOSIT, UNKNOWN SOURCE': ['uncategorized', 'low'],
  'COMM OF MASS EFT MA DOR PAY TEST': ['sales_tax_payable', 'high'],
  'ONLINE TRANSFER TO PARTNER TEST': ['owner_draw', 'medium'],
  'Payment to Chase card ending in 0000 02/01': ['intercompany_due', 'high'],
  'TEST ELECTRIC CO UTIL PMT': ['utilities_electricity', 'high'],
  'TEST BOOKING PLATFORM PAYOUT': ['rental_income', 'high'],
  'TEST STREAMING SVC': ['transfer', 'medium'],
  'Payment Thank You-Mobile': ['intercompany_due', 'high'],
  'TEST HARDWARE STORE': ['repairs_maintenance', 'high'],
  'TEST TOLL AUTHORITY': ['parking_tolls_oe', 'high'],
};

type LedgerRow = ReturnType<typeof ledgerRowsFromParsed>[number] & {
  category_key: string | null;
  ai_category_key: string | null;
  ai_confidence: string | null;
  reviewed: boolean;
};

/** The ledger table: dedupe_hash is unique and a conflict inserts nothing. */
class Ledger {
  rows = new Map<string, LedgerRow>();
  upsertIgnoringDuplicates(rows: ReturnType<typeof ledgerRowsFromParsed>): number {
    let inserted = 0;
    for (const r of rows) {
      if (this.rows.has(r.dedupe_hash)) continue;
      this.rows.set(r.dedupe_hash, { ...r, category_key: null, ai_category_key: null, ai_confidence: null, reviewed: false });
      inserted += 1;
    }
    return inserted;
  }
  /** /api/books/categorize: a proposal, and an off-chart key lands as uncategorized. */
  categorize() {
    for (const r of this.rows.values()) {
      if (r.ai_category_key || r.category_key) continue;
      const [key, confidence] = PROPOSALS[r.description];
      const onChart = !!coaAccountFor(r.entity_id, key);
      r.ai_category_key = onChart ? key : 'uncategorized';
      r.ai_confidence = onChart ? confidence : 'low';
    }
  }
  /** /api/books/review accept_high_confidence. */
  acceptHighConfidence() {
    for (const r of this.rows.values()) {
      if (!r.reviewed && r.ai_confidence === 'high' && r.ai_category_key && !r.category_key && coaAccountFor(r.entity_id, r.ai_category_key)) {
        r.category_key = r.ai_category_key;
        r.reviewed = true;
      }
    }
  }
  /** /api/books/review confirm, with the operator's own category. */
  confirm(description: string, key: string) {
    assert.ok(coaAccountFor('goose_astoria', key), `${key} is on the chart`);
    for (const r of this.rows.values()) {
      if (r.description === description) { r.category_key = key; r.reviewed = true; }
    }
  }
  txns(labels: Record<string, string>): DetailTxn[] {
    return [...this.rows.values()].map((r) => ({
      txn_date: r.txn_date,
      amount: r.amount,
      category_key: r.category_key,
      ai_category_key: r.ai_category_key,
      reviewed: r.reviewed,
      description: r.description,
      account_label: labels[r.account_id] ?? null,
    }));
  }
}

const BANK = { id: 'acct-bank', entity_id: 'goose_astoria' };
const CARD = { id: 'acct-card', entity_id: 'goose_astoria' };
const LABELS = { [BANK.id]: 'Business Complete CHK x6966', [CARD.id]: 'A. OBrien Credit Card x4972' };

const line = (r: PnlReport, section: string, key: string, kind: 'account' | 'total' = 'account') =>
  r.sections.find((s) => s.id === section)?.lines.find((l) => l.key === key && l.kind === kind);

describe('Goose of Astoria, from two Chase exports to the CPA workbook', () => {
  const ledger = new Ledger();
  const bank = parseChaseBankCsv(BANK_CSV);
  const card = parseChaseCreditCardCsv(CARD_CSV);

  test('the exports parse in Chase\'s sign convention: money in positive, out negative', () => {
    assert.equal(bank.length, 6);
    assert.equal(card.length, 7);
    assert.equal(bank.find((t) => t.description.startsWith('DEPOSIT'))?.description, 'DEPOSIT, UNKNOWN SOURCE');
    assert.equal(card.find((t) => t.raw_type === 'Return')?.amount, 30);
    assert.equal(card.find((t) => t.raw_type === 'Payment')?.amount, 350);
  });

  test('upload inserts every row once, two identical tolls stay two, and a re-upload adds nothing', () => {
    assert.equal(ledger.upsertIgnoringDuplicates(ledgerRowsFromParsed(BANK, bank)), 6);
    assert.equal(ledger.upsertIgnoringDuplicates(ledgerRowsFromParsed(CARD, card)), 7);
    assert.equal([...ledger.rows.values()].filter((r) => r.description === 'TEST TOLL AUTHORITY').length, 2);
    // The same files again, and a January-only export that overlaps them.
    assert.equal(ledger.upsertIgnoringDuplicates(ledgerRowsFromParsed(BANK, parseChaseBankCsv(BANK_CSV))), 0);
    assert.equal(ledger.upsertIgnoringDuplicates(ledgerRowsFromParsed(CARD, parseChaseCreditCardCsv(CARD_CSV))), 0);
    const january = CARD_CSV.split('\r\n').filter((l, i) => i === 0 || l.startsWith('01/')).join('\r\n');
    assert.equal(ledger.upsertIgnoringDuplicates(ledgerRowsFromParsed(CARD, parseChaseCreditCardCsv(january))), 0);
  });

  test('the first of a repeated row keeps the plain hash, so the numbering changes nothing that was already unique', () => {
    const args = { entity_id: 'goose_astoria', account_id: CARD.id, txn_date: '2026-01-22', amount: -5, description: 'TEST TOLL AUTHORITY' };
    assert.equal(computeDedupeHash(args), computeDedupeHash({ ...args, occurrence: 1 }));
    assert.notEqual(computeDedupeHash(args), computeDedupeHash({ ...args, occurrence: 2 }));
    const rows = ledgerRowsFromParsed(CARD, card).filter((r) => r.description === 'TEST TOLL AUTHORITY');
    assert.deepEqual(rows.map((r) => r.dedupe_hash), [computeDedupeHash(args), computeDedupeHash({ ...args, occurrence: 2 })]);
  });

  test('before review, the P&L files on the proposals and says it is a draft', () => {
    ledger.categorize();
    const r = buildPnl('goose_astoria', 2026, ledger.txns(LABELS));
    assert.equal(r.counts.transactions, 12, 'the 2025 card row is not in 2026');
    assert.equal(r.counts.reviewed, 0);
    assert.equal(r.counts.uncategorized, 2, 'the unknown deposit, and the off-chart "transfer"');
    assert.equal(r.counts.on_proposal, 10);
    assert.equal(r.final, false);
    assert.match(pnlStatusLine(r), /^Draft: 10 on the categorizer's proposal, not yet reviewed; 2 uncategorized\./);
  });

  test('after review: income, expenses by parent and child, other expenses, net income', () => {
    ledger.acceptHighConfidence();
    ledger.confirm('ONLINE TRANSFER TO PARTNER TEST', 'owner_draw');
    const r = buildPnl('goose_astoria', 2026, ledger.txns(LABELS));
    assert.equal(r.counts.on_proposal, 0);
    assert.equal(r.counts.reviewed, 10);
    assert.equal(r.counts.uncategorized, 2);

    assert.equal(line(r, 'income', 'rental_income')?.total, 240000);
    assert.equal(line(r, 'income', 'rental_income')?.months[0], 240000);
    assert.equal(line(r, 'income', 'uncategorized_income')?.months[2], 5000, 'the March deposit nobody has filed');
    assert.equal(line(r, 'income', 'uncategorized_income')?.uncategorized, true);

    // Electricity files under Utilities: a heading, the child, then the total.
    assert.equal(line(r, 'expense', 'utilities')?.heading, true);
    assert.equal(line(r, 'expense', 'utilities_electricity')?.total, 18025);
    assert.equal(line(r, 'expense', 'utilities', 'total')?.total, 18025);
    assert.equal(line(r, 'expense', 'repairs_maintenance')?.months[0], 9000, 'the $30 return nets the $120 purchase');
    assert.equal(line(r, 'expense', 'uncategorized_expense')?.months[1], 1599);
    assert.equal(line(r, 'other_expense', 'parking_tolls_oe')?.total, 1000, 'both $5 tolls');
    assert.equal(line(r, 'other_expense', 'vehicle_expenses', 'total')?.total, 1000);

    const exp = r.sections.find((s) => s.id === 'expense')!;
    assert.equal(exp.total, 18025 + 9000 + 1599);
    // 2400 + 50 - 180.25 - 90 - 15.99 - 10
    assert.equal(r.net_income.total, 215376);
    assert.equal(r.net_income.months[0], 240000 - 18025 - 9000 - 1000);
    assert.equal(r.net_income.months[1], -1599);
    assert.equal(r.net_income.months[2], 5000);
    assert.equal(r.last_month, 3);
    assert.deepEqual(r.off_chart_keys, [], 'the categorize step already turned "transfer" into uncategorized');
  });

  test('net income is exactly the signed sum of the rows it counts', () => {
    const txns = ledger.txns(LABELS);
    const r = buildPnl('goose_astoria', 2026, txns);
    const counted = txns
      .filter((t) => t.txn_date.startsWith('2026-'))
      .filter((t) => { const c = classifyTxn('goose_astoria', t); return !c.account || inNetIncome(c.account); })
      .reduce((a, t) => a + toCents(t.amount), 0);
    assert.equal(r.net_income.total, counted);
  });

  test('the card payoff, the partner draw and the sales tax remittance are listed, not counted', () => {
    const r = buildPnl('goose_astoria', 2026, ledger.txns(LABELS));
    const o = Object.fromEntries(r.outside.map((x) => [x.key, x]));
    assert.deepEqual([o.intercompany_due.money_in, o.intercompany_due.money_out, o.intercompany_due.count], [35000, 35000, 2]);
    assert.deepEqual([o.owner_draw.money_out, o.owner_draw.type], [100000, 'equity']);
    assert.deepEqual([o.sales_tax_payable.money_out, o.sales_tax_payable.type], [28080, 'liability']);
    for (const s of r.sections) for (const l of s.lines) {
      assert.ok(!['intercompany_due', 'owner_draw', 'sales_tax_payable'].includes(l.key), `${l.key} is not a P&L line`);
    }
  });

  test('once the last two are filed it is final', () => {
    ledger.confirm('DEPOSIT, UNKNOWN SOURCE', 'owner_contribution');
    ledger.confirm('TEST STREAMING SVC', 'software_apps');
    const r = buildPnl('goose_astoria', 2026, ledger.txns(LABELS));
    assert.equal(r.final, true);
    assert.equal(pnlStatusLine(r), 'Final: all 12 transactions reviewed.');
    assert.equal(line(r, 'income', 'uncategorized_income'), undefined);
    assert.equal(r.net_income.total, 240000 - 18025 - 9000 - 1599 - 1000);
  });

  test('the sheet rows: title block, month header, every section, net income in dollars', () => {
    const r = buildPnl('goose_astoria', 2026, ledger.txns(LABELS));
    const rows = pnlSheetRows(r);
    assert.equal(rows[0][0], 'Goose of Astoria LLC');
    assert.match(String(rows[1][0]), /cash basis/);
    assert.deepEqual(rows[4], ['', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Total']);
    const labels = rows.map((x) => String(x[0] ?? '').trim());
    for (const want of ['Income', 'Total Income', 'Expenses', 'Utilities', 'Electricity', 'Total Utilities', 'Total Expenses', 'Net Operating Income', 'Other Expenses', 'Net Other Income', 'Net Income']) {
      assert.ok(labels.includes(want), `the sheet has "${want}"`);
    }
    const net = rows.find((x) => x[0] === 'Net Income')!;
    assert.equal(net.length, 14);
    assert.equal(net[13], 2103.76);
    assert.equal(net[1], 2119.75);
    // A heading carries no numbers; nothing from the balance sheet sits in the grid.
    assert.deepEqual(rows.find((x) => String(x[0]).trim() === 'Utilities'), ['    Utilities']);
    assert.ok(labels.includes('Not in net income: balance sheet and owner trust movements for the year'));
  });

  test('the workbook the CPA downloads reads back with the same numbers and every transaction', () => {
    const txns = ledger.txns(LABELS);
    const r = buildPnl('goose_astoria', 2026, txns);
    const wb = XLSX.read(pnlWorkbook(r, txns), { type: 'array' });
    assert.deepEqual(wb.SheetNames, [PNL_SHEET, TRANSACTIONS_SHEET]);
    const grid = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[PNL_SHEET], { header: 1, blankrows: true });
    const net = grid.find((x) => x[0] === 'Net Income')!;
    assert.equal(net[13], 2103.76);
    const detail = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets[TRANSACTIONS_SHEET]);
    assert.equal(detail.length, 12);
    const payoff = detail.find((d) => d.Description === 'Payment Thank You-Mobile')!;
    assert.deepEqual([payoff.Account, payoff.Amount, payoff.Category, payoff['In net income']], ['A. OBrien Credit Card x4972', 350, 'Intercompany Due To/From', 'No']);
    const tolls = detail.filter((d) => d.Description === 'TEST TOLL AUTHORITY');
    assert.equal(tolls.length, 2);
    assert.equal(tolls[0].Status, 'Reviewed');
    assert.equal(pnlFileBase(r), 'Goose-of-Astoria-LLC-PL-2026');
  });

  test('the CSV quotes what needs quoting and keeps the cents', () => {
    const txns = ledger.txns(LABELS);
    const csv = rowsToCsv(transactionSheetRows('goose_astoria', 2026, txns));
    assert.ok(csv.includes('"DEPOSIT, UNKNOWN SOURCE",50,'), 'a description with a comma is quoted');
    assert.ok(csv.includes(',-180.25,'));
    assert.ok(csv.endsWith('\r\n'));
    assert.equal(rowsToCsv([['say "hi"', null, 1.5]]), '"say ""hi""",,1.50\r\n');
  });
});

describe('the rules that keep each LLC\'s P&L honest', () => {
  const t = (txn_date: string, amount: number, key: string | null, reviewed = true) =>
    ({ txn_date, amount, category_key: reviewed ? key : null, ai_category_key: key, reviewed });

  test('Rising Tide: owner trust money is listed, never counted; its own fees are income', () => {
    const r = buildPnl('rising_tide', 2026, [
      t('2026-04-01', 9000, 'accommodation_fares'),
      t('2026-04-05', -6000, 'property_owner_payouts'),
      t('2026-04-05', -2000, 'str_management_fees'),
      t('2026-04-05', 2000, 'property_management_income'),
      t('2026-04-09', -49, 'software_apps'),
    ]);
    assert.equal(r.net_income.total, 200000 - 4900);
    const o = Object.fromEntries(r.outside.map((x) => [x.key, x]));
    assert.equal(o.accommodation_fares.pass_through, true);
    assert.equal(o.property_owner_payouts.money_out, 600000);
    assert.equal(o.str_management_fees.money_out, 200000);
    assert.ok(pnlSheetRows(r).some((x) => x[1] === 'Owner trust (pass-through)'));
  });

  test('Goose of Calderwood: a personal expense filed as a distribution leaves the P&L; the mortgage interest and the heat loan do what they should', () => {
    const r = buildPnl('goose_calderwood', 2026, [
      t('2026-07-10', 3200, 'str_income'),
      t('2026-07-15', -1500, 'mortgage_interest_65_calderwood'),
      t('2026-07-16', -400, 'owner_draw'),
      t('2026-07-20', -250, 'heat_loan'),
    ]);
    assert.equal(line(r, 'income', 'str_income')?.total, 320000);
    assert.equal(line(r, 'expense', 'interest_paid')?.heading, true);
    assert.equal(line(r, 'expense', 'interest_paid', 'total')?.total, 150000);
    assert.equal(r.net_income.total, 170000);
    assert.deepEqual(r.outside.map((x) => [x.key, x.type]), [['owner_draw', 'equity'], ['heat_loan', 'liability']]);
  });

  test('another entity\'s key, a made-up key, suspense and no key are all uncategorized and all counted', () => {
    const r = buildPnl('goose_astoria', 2026, [
      t('2026-05-01', -10, 'str_income'), // Calderwood's
      t('2026-05-02', -20, 'transfer'),
      t('2026-05-03', -30, 'suspense'),
      t('2026-05-04', 40, null),
    ]);
    assert.equal(r.counts.uncategorized, 4);
    assert.deepEqual(r.off_chart_keys, ['str_income', 'transfer']);
    assert.equal(line(r, 'expense', 'uncategorized_expense')?.total, 6000);
    assert.equal(line(r, 'income', 'uncategorized_income')?.total, 4000);
    assert.equal(r.net_income.total, -2000);
  });

  test('the operator\'s category wins over the proposal, and an unreviewed proposal still files', () => {
    const c = classifyTxn('goose_astoria', { category_key: 'repairs_maintenance', ai_category_key: 'supplies', reviewed: true });
    assert.equal(c.account?.key, 'repairs_maintenance');
    assert.equal(c.status, 'reviewed');
    const p = classifyTxn('goose_astoria', { category_key: null, ai_category_key: 'supplies', reviewed: false });
    assert.deepEqual([p.account?.key, p.status], ['supplies', 'proposal']);
  });

  test('only the year asked for, and money is summed in cents', () => {
    const r = buildPnl('goose_astoria', 2026, [
      t('2025-12-31', -999, 'supplies'),
      t('2026-01-01', -0.1, 'supplies'),
      t('2026-01-01', -0.2, 'supplies'),
      t('2026-12-31', '-0.05' as unknown as number, 'supplies'),
      t('2027-01-01', -999, 'supplies'),
    ]);
    assert.equal(r.counts.transactions, 3);
    assert.equal(line(r, 'expense', 'supplies')?.total, 35);
    assert.equal(line(r, 'expense', 'supplies')?.months[11], 5);
    assert.equal(r.last_month, 12);
  });

  test('every chart account is either in net income or a listed movement, by its type', () => {
    for (const a of CHART_OF_ACCOUNTS) {
      const expected = !a.pass_through && a.type !== 'equity' && a.type !== 'liability';
      assert.equal(inNetIncome(a), expected, a.key);
    }
    for (const key of ['sales_tax_payable', 'customer_prepayments', 'heat_loan']) {
      assert.equal(CHART_OF_ACCOUNTS.find((a) => a.key === key)?.type, 'liability', `${key} is a liability, never an expense`);
    }
    assert.equal(new Set(CHART_OF_ACCOUNTS.map((a) => a.key)).size, CHART_OF_ACCOUNTS.length, 'keys are unique');
  });

  test('an empty year is a report with nothing in it, not an error', () => {
    const r = buildPnl('goose_calderwood', 2026, []);
    assert.equal(r.net_income.total, 0);
    assert.equal(r.final, false);
    assert.equal(pnlStatusLine(r), 'No transactions on file for 2026.');
    assert.throws(() => buildPnl('nobody', 2026, []));
  });

  test('?year= takes four digits in range and nothing else', () => {
    assert.equal(parsePnlYear('2025', 2026), 2025);
    assert.equal(parsePnlYear(['2024'], 2026), 2024);
    for (const bad of [undefined, '', '26', '2026x', '1999', '3000']) assert.equal(parsePnlYear(bad, 2026), 2026);
  });
});

// ── The migration seeds what the app files against ───────────────────────

const MIGRATION = 'supabase/migrations/20261019190000_books_ledger_for_pnl.sql';

/** The value tuples of one `insert into public.<table> (...) values ... on conflict` block. */
function seedTuples(sql: string, table: string): (string | number | boolean | null)[][] {
  const at = sql.indexOf(`insert into public.${table} (`);
  assert.ok(at >= 0, `${table} is seeded`);
  const block = sql.slice(sql.indexOf('values', at) + 6, sql.indexOf('on conflict', at));
  return block.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('(')).map((l) => {
    const inner = l.replace(/^\(/, '').replace(/\),?$/, '');
    const out: (string | number | boolean | null)[] = [];
    let i = 0;
    while (i < inner.length) {
      while (inner[i] === ' ' || inner[i] === ',') i++;
      if (inner[i] === "'") {
        let s = '';
        i++;
        for (; i < inner.length; i++) {
          if (inner[i] === "'" && inner[i + 1] === "'") { s += "'"; i++; } else if (inner[i] === "'") { i++; break; } else s += inner[i];
        }
        out.push(s);
      } else {
        const end = inner.indexOf(',', i) === -1 ? inner.length : inner.indexOf(',', i);
        const tok = inner.slice(i, end).trim();
        out.push(tok === 'null' ? null : tok === 'true' ? true : tok === 'false' ? false : Number(tok));
        i = end;
      }
    }
    return out;
  });
}

describe('the books migration', () => {
  const sql = read(MIGRATION);

  test('seeds exactly the chart of accounts in books.ts', () => {
    const seeded = seedTuples(sql, 'chart_of_accounts').map(([entity_id, key, parent_key, name, type, tax_hint, pass_through, sort]) =>
      JSON.stringify([entity_id ?? 'shared', key, parent_key, name, type, tax_hint, pass_through, sort]));
    const lib = CHART_OF_ACCOUNTS.map((a) =>
      JSON.stringify([a.scope, a.key, a.parent_key ?? null, a.name, a.type, a.tax_hint ?? null, !!a.pass_through, a.sort]));
    assert.deepEqual([...seeded].sort(), [...lib].sort());
  });

  test('seeds every bank and card account and every entity in books.ts', () => {
    const accts = seedTuples(sql, 'llc_accounts').map((r) => JSON.stringify(r));
    const lib = LLC_ACCOUNTS.map((a) => JSON.stringify([a.entity_id, a.kind, a.institution, a.last4, a.label, a.property_id ?? null]));
    assert.deepEqual([...accts].sort(), [...lib].sort());
    assert.deepEqual(seedTuples(sql, 'llc_entities').map((r) => r[0]).sort(), Object.keys(LLC_ENTITIES).sort());
    for (const id of ['goose_astoria', 'goose_calderwood']) {
      assert.ok(LLC_ACCOUNTS.some((a) => a.entity_id === id && a.kind === 'bank'), `${id} has a bank account to upload into`);
      assert.ok(LLC_ACCOUNTS.some((a) => a.entity_id === id && a.kind === 'credit_card'), `${id} has a card to upload into`);
    }
  });

  test('the type check admits every type the chart uses, and lands after the upsert fixes the liability rows', () => {
    const check = sql.match(/add constraint chart_of_accounts_type_check\s+check \(type in \(([^)]*)\)\)/);
    assert.ok(check, 'chart_of_accounts.type has a check');
    assert.ok(sql.indexOf('chart_of_accounts_type_check') > sql.indexOf('insert into public.chart_of_accounts'), 'the check follows the chart upsert');
    const allowed = new Set(check[1].split(',').map((s) => s.trim().replace(/'/g, '')));
    for (const a of CHART_OF_ACCOUNTS) assert.ok(allowed.has(a.type), `${a.key}: ${a.type}`);
  });

  test('every table it creates is locked to the service role', () => {
    const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(tables, ['llc_entities', 'llc_accounts', 'llc_property_links', 'chart_of_accounts', 'ledger_transactions']);
    for (const t of tables) {
      assert.ok(sql.includes(`alter table public.${t} enable row level security;`), `${t} has RLS`);
    }
    const revoke = sql.slice(sql.indexOf('revoke all on'), sql.indexOf('from anon, authenticated;'));
    for (const t of tables) assert.ok(revoke.includes(`public.${t}`), `${t} is revoked from anon`);
    assert.ok(/dedupe_hash\s+text unique/.test(sql), 'the ingest upsert needs dedupe_hash unique');
  });

  test('the root schema file is marked superseded so nobody runs it', () => {
    assert.match(read('supabase-schema-books.sql'), /^-- SUPERSEDED /);
    assert.ok(read('supabase-schema-books.sql').split('\n').slice(0, 6).join('\n').includes('20261019190000_books_ledger_for_pnl.sql'));
  });

  test('it sorts after every other migration that seeds the chart, so a replay ends on this chart', () => {
    // The root file's seed (and its copy as a migration) deletes and
    // re-inserts chart_of_accounts with the liability rows as other_expense.
    const dir = new URL('../../../supabase/migrations/', import.meta.url);
    const mine = MIGRATION.split('/').pop()!;
    const seeders = readdirSync(dir).filter((f) => f.endsWith('.sql') && f !== mine && /insert into\s+(public\.)?chart_of_accounts/i.test(readFileSync(new URL(f, dir), 'utf8')));
    for (const f of seeders) assert.ok(f < mine, `${f} seeds the chart after ${mine}`);
  });

  test('re-running it changes nothing: every constraint is dropped by name before it is added', () => {
    for (const m of sql.matchAll(/add constraint (\w+)/g)) {
      assert.ok(sql.includes(`drop constraint if exists ${m[1]}`), `${m[1]} is dropped first`);
    }
    assert.ok(!/^\s*delete from/im.test(sql), 'no delete: the chart is upserted');
  });
});

describe('the routes use these rules (source guards)', () => {
  test('upload builds its rows with ledgerRowsFromParsed', () => {
    const src = read('src/app/api/books/ingest/route.ts');
    assert.ok(src.includes('ledgerRowsFromParsed(acct, parsed)'));
    assert.ok(src.includes("onConflict: 'dedupe_hash', ignoreDuplicates: true"));
  });

  test('categorize never stores a key that is not on the chart', () => {
    const src = read('src/app/api/books/categorize/route.ts');
    assert.ok(src.includes("ai_category_key: onChart ? r.category_key : 'uncategorized'"));
  });

  test('the page and the export read one loader, which pages past 1000 rows', () => {
    assert.ok(read('src/app/books/[entity_id]/pnl/page.tsx').includes('await loadPnl(entity_id, year)'));
    assert.ok(read('src/app/api/books/pnl-export/route.ts').includes('await loadPnl(entityId, year)'));
    const db = read('src/lib/books-pnl-db.ts');
    assert.ok(db.includes('selectAllPaged<LedgerRow>'));
    assert.ok(/\.order\('txn_date'[^)]*\)\s*\.order\('id'/.test(db), 'a stable sort under the paging');
  });

  test('both sit behind the owner gate', () => {
    const access = read('src/lib/helm-access.ts');
    assert.ok(access.includes("'/books',"));
    assert.ok(access.includes("'/api/books',"));
  });
});
