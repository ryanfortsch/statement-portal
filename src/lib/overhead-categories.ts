/**
 * Rising Tide overhead categorization.
 *
 * Turns raw corporate-account transactions into clean business-overhead
 * categories for the Cost Analysis tab. Two sources, two formats:
 *
 *   - Corporate card (*3878): one row = one charge. Has Chase's own
 *     Category column. Negative Amount = a charge (a cost).
 *   - Operating account (*5130): a checking account. Mostly INTERNAL
 *     TRANSFERS (owner-sweep credits in, transfers out to property
 *     accounts, and the monthly payoff of the *3878 card). The real
 *     overhead is a small set of vendor ACH/checks (rent, accounting,
 *     bank fees). Negative Amount = a debit.
 *
 * Two hard rules keep the number honest:
 *   1. DROP personal/gray spend (per Dotti: "hide personal"). Easiest
 *      reliable signal is Chase's Category: "Gas" and "Food & Drink"
 *      are personal here (Starbucks, Richdale, Gulf, etc.).
 *   2. On the operating account, DROP every internal transfer and the
 *      card payoff -- otherwise we'd double-count the card. Only a
 *      whitelist of known overhead vendors is kept; unknown debits are
 *      excluded (correctness over completeness on the noisy account).
 *
 * Vendor knowledge mirrors what the financial-model session already
 * calibrated in forecast-model.ts (software stack, Phillips insurance,
 * MS Consultants accounting, 85 Eastern rent, Meta ads, etc.).
 *
 * categorize() returns a bucket label, or null to DROP the transaction.
 */

export type OverheadAccount = 'card' | 'operating';

export type OverheadCategory =
  | 'Software'
  | 'Marketing'
  | 'Listing platforms'
  | 'Pass-through'
  | 'Guest supplies'
  | 'Repairs & upkeep'
  | 'Insurance'
  | 'Health benefits'
  | 'Rent & office'
  | 'Professional'
  | 'Payroll'
  | 'Contractors'
  | 'Card payment'
  | 'Travel'
  | 'Bank fees'
  | 'Other';

type Rule = { category: OverheadCategory; matches: string[] };

// Vendor substring rules (upper-cased). Order matters only in that the
// first match wins; lists are kept disjoint in practice. Expanded after
// inspecting the 2-yr card "Other" bucket (GEICO insurance, SQSP, Apple,
// Lovable, Tempus Fugit law, Delta/Enterprise travel, Paone/Dash repairs).
const VENDOR_RULES: Rule[] = [
  { category: 'Software', matches: ['GUESTY', 'PRICELABS', 'PRICE LABS', 'INTUIT', 'QUICKBOOKS', 'QBOOKS', 'ADOBE', 'AIRDNA', 'OPENAI', 'ANTHROPIC', 'CLAUDE', 'ZOOM', 'DROPBOX', 'DOCUSIGN', 'QUO', 'OPENPHONE', 'NOTION', 'SLACK', 'SQUARESPACE', 'SQSP', 'GODADDY', 'VERCEL', 'SUPABASE', 'CANVA', 'GOOGLE *', 'GSUITE', 'MICROSOFT', 'GITHUB', 'APPLE.COM', 'LOVABLE', 'RUNWAY', 'CURSOR', 'AWS', 'AMAZON WEB', '1PASSWORD', 'TAILSCALE', 'RESEND', 'POND5', 'LUTIFY'] },
  { category: 'Marketing', matches: ['FACEBK', 'FACEBOOK', 'META PL', 'META ', 'INSTAGRAM', 'EAGLE TRIBUNE', 'MAILCHIMP', 'GOOGLE ADS', 'YELP', 'VISTAPRINT', 'SEASIDE GRAPHICS'] },
  // VRBO/HomeAway/Expedia bill the channel commission to the card, and that
  // same commission is already netted out of rental revenue before it reaches
  // a statement. The money lands in the account and leaves again. Counting it
  // as overhead charges Rising Tide twice for one fee.
  //
  // Furnished Finder is NOT in here on purpose: it is a flat listing
  // subscription RT actually pays, and nothing nets it back.
  { category: 'Pass-through', matches: ['VRBO', 'HOMEAWAY', 'EXPEDIA'] },
  { category: 'Listing platforms', matches: ['FURNISHED FINDER', 'FURNISHEDFINDER'] },
  { category: 'Guest supplies', matches: ['AMAZON', 'AMZN', 'FIX LINENS', 'FIXLINENS', 'WALMART', 'TARGET', 'COSTCO', 'BED BATH', 'WAYFAIR', 'HOMEGOODS', 'IKEA', 'BJS', "BJ'S", 'CRATE&', 'CRATE &', 'CB2', 'POTTERY BARN', 'POTTERYBARN', 'WILLIAMS SONOMA', 'JOSSMAIN', 'JOSS & MAIN', 'WEBSTAURANT', 'AMENITIES', 'HOME DECOR GROUP', 'MARSHALLS'] },
  { category: 'Repairs & upkeep', matches: ['HOME DEPOT', 'HOMEDEPOT', 'LOWES', "LOWE'S", 'ACE HARDWARE', 'HARDWARE', 'TRUE VALUE', 'SHERWIN', 'FERGUSON', 'ROCKY', 'GRAINGER', 'PAONE', 'DASH DRAINS', 'BUILDING CENTER', 'MECHANICAL', 'DROMETER', 'PLUMBING', 'ELECTRIC', 'WALLACEHOME', 'WALLACE HOME'] },
  { category: 'Insurance', matches: ['PHILLIPS', 'INSURANCE', 'INSUR', 'GEICO', 'PROGRESSIVE', 'STATE FARM', 'LIBERTY MUT', 'TRAVELERS', 'HARTFORD'] },
  { category: 'Health benefits', matches: ['COMMONWEALTH HEA', 'BLUE CROSS', 'BLUECROSS', 'BCBS', 'HARVARD PILGRIM', 'TUFTS HEALTH', 'UNITEDHEALTH', 'AETNA', 'CIGNA'] },
  { category: 'Rent & office', matches: ['85EASTERN', 'EASTERN LANDLORD', 'EASTERNLANDLORD', 'LANDLORD', 'STAPLES', 'OFFICE DEPOT', 'DUMPSTER', 'WASTE MGMT', 'WASTE MANAGEMENT', 'REPUBLIC SERVICES'] },
  { category: 'Professional', matches: ['MSCONSULTANTS', 'MS CONSULTANTS', 'MH PARTNERS', 'MHPARTNERS', 'SUPPORTING STRATEGIES', 'LEGALZOOM', 'ATTORNEY', 'LAW OFFICE', 'LAW LLC', 'TEMPUS FUGIT', 'CPA', 'ACCOUNTING'] },
  // 1099 field/creative contractors paid direct from the operating account by
  // Zelle, bill-pay or the Chase "Basic Online Payroll" rail. Must sit BEFORE
  // the Payroll rule: "Basic Online Payroll Payment ... to #######4113" is
  // Cooper, not a Gusto run, and would otherwise land in Payroll.
  { category: 'Contractors', matches: ['DELANEY', 'COOPER', 'BASIC ONLINE PAYROLL', 'MAGGIE BUTLER', 'NICOLE WHITTEN', 'MARK BELL', 'OWEN BRILL', 'MORGAN DENHART', 'IAN DROMETER', 'LUKE WALLACE', 'SANDY MAID', 'ONYX INFRASTRUCTURE', 'TOMER', 'MORRIS HOME SERVICES'] },
  { category: 'Payroll', matches: ['GUSTO', 'ADP', 'PAYCHEX', 'PAYROLL'] },
  { category: 'Travel', matches: ['DELTA AIR', 'JETBLUE', 'UNITED AIR', 'AMERICAN AIR', 'SOUTHWEST AIR', 'ENTERPRISE RENT', 'HERTZ', 'AVIS', 'BUDGET RENT', 'NATIONAL CAR', 'UBER', 'LYFT', 'AMTRAK'] },
  { category: 'Bank fees', matches: ['STOP PAYMENT', 'SERVICE CHARGE', 'OVERDRAFT', 'WIRE FEE', 'RETURNED ITEM', 'NSF', 'MONTHLY SERVICE FEE'] },
];

// Chase Category values (corporate card) that are personal/gray and get
// dropped per the "hide personal" decision.
const PERSONAL_CHASE_CATEGORIES = new Set(['Gas', 'Food & Drink', 'Entertainment', 'Health & Wellness', 'Personal']);

// Explicitly-personal vendors to drop regardless of Chase category
// (streaming, tuition, etc. -- the "Netflix mess" Ryan flagged).
const PERSONAL_VENDORS = ['NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY PLUS', 'DISNEY+', 'HBO MAX', 'PEACOCK', 'PARAMOUNT+', 'SNHU', 'AUDIBLE'];

// Operating-account internal-transfer / non-expense signals. Any debit
// whose description hits one of these is NOT an expense (it's moving money
// between Rising Tide accounts or paying the card).
const TRANSFER_SIGNALS = [
  'ONLINE TRANSFER', 'TRANSACTION#', 'PAYMENT TO CHASE CARD', 'FROM FIDELITY',
  'TO CHK', 'FROM CHK', 'AUTOPAY', 'CHASE CREDIT CRD', 'INTERNAL TRANSFER',
];

function matchVendor(descUpper: string): OverheadCategory | null {
  for (const r of VENDOR_RULES) {
    if (r.matches.some(m => descUpper.includes(m))) return r.category;
  }
  return null;
}

/**
 * Categorize one transaction. Returns the bucket, or null to drop it
 * (personal, internal transfer, credit/income, or -- on the operating
 * account -- an unrecognized debit).
 *
 * @param amount  signed amount as it appears in the CSV (negative = cost).
 * @param chaseCategory  the card's Category column (operating accounts: '').
 * @param type  the bank Type column (operating: ACCT_XFER, ACH_DEBIT, FEE_TRANSACTION...).
 */
export function categorizeOverhead(args: {
  account: OverheadAccount;
  description: string;
  amount: number;
  chaseCategory?: string;
  type?: string;
}): OverheadCategory | null {
  const { account, description, amount, chaseCategory, type } = args;

  // Costs are negative. Credits / income / refunds (>= 0) are never overhead.
  if (amount >= 0) return null;

  const descUpper = (description || '').toUpperCase();

  // Explicitly personal vendors are dropped on either account.
  if (PERSONAL_VENDORS.some(v => descUpper.includes(v))) return null;

  if (account === 'card') {
    // Drop personal per Chase's own category.
    if (chaseCategory && PERSONAL_CHASE_CATEGORIES.has(chaseCategory)) return null;
    // Card payments/credits to the issuer aren't charges (already excluded by amount >= 0).
    const vendor = matchVendor(descUpper);
    if (vendor) return vendor;
    // Unknown card vendor that isn't flagged personal: keep as Other so we
    // don't silently lose real business spend.
    return 'Other';
  }

  // account === 'operating'
  const t = (type || '').toUpperCase();

  // Card payoffs are kept, as a PROXY for card spend in months where we have
  // no card-level export. They are not real vendor charges and they must
  // never be added on top of card-account rows for the same month, so both
  // readers run them through `dropSupersededCardProxy` first. See
  // CARD_PROXY_CATEGORY below.
  if (
    t === 'LOAN_PMT' ||
    descUpper.includes('PAYMENT TO CHASE CARD') ||
    descUpper.includes('CHASE CREDIT CRD')
  ) {
    return CARD_PROXY_CATEGORY;
  }

  // Drop every internal transfer / non-vendor movement.
  if (t === 'ACCT_XFER') return null;
  // A bounced deposit is a wash, not a cost: the credit that created it was
  // already dropped by the amount >= 0 rule above, so booking the reversal
  // as an expense invents money that never left. These rows read
  // "DEPOSITED ITEM RETURNED ... Stop Payment", which used to match the
  // 'STOP PAYMENT' bank-fee rule and post $1,315.60 of phantom expense
  // across the two that exist. The real stop-payment FEE is a separate
  // FEE_TRANSACTION row and still lands in Bank fees.
  if (t === 'DEPOSIT_RETURN' || descUpper.includes('DEPOSITED ITEM RETURNED')) return null;
  if (TRANSFER_SIGNALS.some(s => descUpper.includes(s))) return null;
  // Personal debit-card spend on the operating account (Starbucks etc.).
  if (descUpper.includes('STARBUCKS') || descUpper.includes('DUNKIN') || /\bGAS\b/.test(descUpper)) return null;
  // Whitelist only: the operating account is mostly noise, so we keep only
  // recognized overhead vendors. Unknown debits are excluded (flagged in
  // the ingest summary so they can be added if they're real).
  return matchVendor(descUpper);
}

/**
 * The operating account's Chase-card payoff rows, kept as a stand-in for
 * card spend in months with no card-level export.
 *
 * Card payments are a CASH-FLOW proxy, not a P&L one: they lag the charges
 * by roughly a month, they lump (August 2026 alone paid $43,665 to clear a
 * carried balance), and they settle personal charges the categorizer drops
 * from the card side. Treat a month sourced this way as an order of
 * magnitude, not a ledger. Where a real card export exists, it wins.
 */
export const CARD_PROXY_CATEGORY = 'Card payment' as const;

/**
 * Ledger view (Cost Analysis): drop card-payoff proxy rows for any month
 * that has real card-account detail, so the two are never summed.
 *
 * This is the lenient rule, and it is right for a ledger: a month with
 * partial card detail still shows the charges it actually has, and a payoff
 * on top of them would double-count.
 *
 * The Forecast needs a stricter rule, because it reports a month as one
 * complete ACT figure rather than as a list of charges. It uses
 * cardCompleteMonths() + resolveCardSpendSource() below.
 */
export function dropSupersededCardProxy<
  T extends { month?: string | null; account?: string | null; category?: string | null },
>(rows: T[]): T[] {
  const monthsWithCardDetail = new Set(
    rows.filter((r) => r.account === 'card' && r.month).map((r) => r.month as string),
  );
  return rows.filter(
    (r) => !(r.category === CARD_PROXY_CATEGORY && r.month && monthsWithCardDetail.has(r.month)),
  );
}

/**
 * Months whose card export runs all the way to month end.
 *
 * A month holding only the first few days of card detail is NOT covered.
 * June 2026 forced this: the card export stopped on 2026-06-06, so June
 * held six days of charges. The lenient rule above read that as "this month
 * has card detail", suppressed the payoff proxy, and reported six days of
 * spend as a full month of ACT.
 *
 * @param cardMaxTxnDate latest `txn_date` on any account='card' row as
 *                       YYYY-MM-DD, or null when there is no card data.
 */
export function cardCompleteMonths<
  T extends { month?: string | null; account?: string | null },
>(rows: T[], cardMaxTxnDate: string | null): Set<string> {
  const out = new Set<string>();
  if (!cardMaxTxnDate) return out;
  for (const r of rows) {
    if (r.account !== 'card' || !r.month) continue;
    const [y, m] = r.month.split('-').map(Number);
    if (!y || !m) continue;
    // Day 0 of the NEXT month is the last calendar day of this one.
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (cardMaxTxnDate >= monthEnd) out.add(r.month);
  }
  return out;
}

/**
 * Forecast view: pick exactly ONE source of card spend per month.
 *
 * Months with complete card detail keep their card rows and lose the payoff
 * proxy. Every other month loses its partial card rows and keeps the proxy:
 * a whole-month payoff estimates a month's card spend better than a handful
 * of days of charges does.
 */
export function resolveCardSpendSource<
  T extends { month?: string | null; account?: string | null; category?: string | null },
>(rows: T[], complete: Set<string>): T[] {
  return rows.filter((r) => {
    if (!r.month) return true;
    const covered = complete.has(r.month);
    if (r.category === CARD_PROXY_CATEGORY) return !covered;
    if (r.account === 'card') return covered;
    return true;
  });
}

export const OVERHEAD_CATEGORIES: OverheadCategory[] = [
  'Software', 'Marketing', 'Listing platforms', 'Guest supplies',
  'Repairs & upkeep', 'Insurance', 'Health benefits', 'Rent & office',
  'Professional', 'Payroll', 'Contractors', 'Card payment', 'Pass-through',
  'Travel', 'Bank fees', 'Other',
];

/* --------------------------------------------------------------------- */
/* Vendor display-grouping for the dashboard drill-down                   */
/* --------------------------------------------------------------------- */

// Collapses the noisy Chase description into one clean merchant name so the
// drill-down groups variants together (AMAZON MKTPL + AMZN MKTP -> "Amazon",
// the two ways Anthropic bills -> "Anthropic"). Names are chosen to read well
// in the UI; order doesn't matter since matches are disjoint in practice.
const CANONICAL_VENDORS: { name: string; match: string[] }[] = [
  { name: 'Amazon', match: ['AMAZON', 'AMZN'] },
  { name: 'Gusto (payroll)', match: ['GUSTO'] },
  { name: 'Guesty', match: ['GUESTY'] },
  { name: 'PriceLabs', match: ['PRICELABS', 'PRICE LABS'] },
  { name: 'AirDNA', match: ['AIRDNA'] },
  { name: 'Adobe', match: ['ADOBE'] },
  { name: 'Squarespace', match: ['SQSP', 'SQUARESPACE'] },
  { name: 'QuickBooks (Intuit)', match: ['INTUIT', 'QUICKBOOKS', 'QBOOKS'] },
  { name: 'OpenAI', match: ['OPENAI'] },
  { name: 'Anthropic', match: ['ANTHROPIC', 'CLAUDE'] },
  { name: 'Cursor', match: ['CURSOR'] },
  { name: 'Lovable', match: ['LOVABLE'] },
  { name: 'Runway', match: ['RUNWAY'] },
  { name: 'GitHub', match: ['GITHUB'] },
  { name: 'Vercel', match: ['VERCEL'] },
  { name: 'Google', match: ['GOOGLE', 'GSUITE'] },
  { name: 'Apple', match: ['APPLE'] },
  { name: 'Microsoft', match: ['MICROSOFT'] },
  { name: 'Quo (OpenPhone)', match: ['QUO', 'OPENPHONE'] },
  { name: 'Meta / Facebook ads', match: ['FACEBK', 'FACEBOOK', 'META PL', 'META ', 'INSTAGRAM'] },
  { name: 'Mailchimp', match: ['MAILCHIMP'] },
  { name: 'VRBO', match: ['VRBO', 'HOMEAWAY'] },
  { name: 'Furnished Finder', match: ['FURNISHED FINDER', 'FURNISHEDFINDER'] },
  { name: 'GEICO (auto)', match: ['GEICO'] },
  { name: 'Phillips Insurance', match: ['PHILLIPS'] },
  { name: 'Arbella Insurance', match: ['ARBELLA'] },
  { name: 'Commonwealth Health', match: ['COMMONWEALTH HEA'] },
  { name: 'MS Consultants (accounting)', match: ['MSCONSULTANTS', 'MS CONSULTANTS'] },
  { name: 'MH Partners', match: ['MH PARTNERS', 'MHPARTNERS'] },
  { name: 'Supporting Strategies', match: ['SUPPORTING STRATEGIES'] },
  { name: 'Tempus Fugit Law', match: ['TEMPUS FUGIT'] },
  { name: 'Fix Linens', match: ['FIX LINENS', 'FIXLINENS'] },
  { name: 'Home Depot', match: ['HOME DEPOT', 'HOMEDEPOT'] },
  { name: "Rocky's Ace Hardware", match: ["ROCKY'S ACE", 'ROCKYS ACE', 'ROCKY'] },
  { name: 'Paone Mechanical', match: ['PAONE'] },
  { name: 'Dash Drains', match: ['DASH DRAINS'] },
  { name: 'Delta Air Lines', match: ['DELTA AIR'] },
  { name: 'Enterprise Rent-A-Car', match: ['ENTERPRISE RENT'] },
  { name: 'Target', match: ['TARGET'] },
  { name: 'Walmart', match: ['WALMART'] },
  { name: 'Staples', match: ['STAPLES'] },
  { name: 'Joss & Main', match: ['JOSSMAIN', 'JOSS & MAIN'] },
  { name: 'Pottery Barn', match: ['POTTERYBARN', 'POTTERY BARN'] },
  { name: 'WebstaurantStore', match: ['WEBSTAURANT'] },
  { name: 'V H Amenities', match: ['V H AMENITIES', 'AMENITIES'] },
  { name: 'Home Decor Group', match: ['HOME DECOR GROUP'] },
  { name: 'Marshalls', match: ['MARSHALLS'] },
  { name: 'Vistaprint', match: ['VISTAPRINT'] },
  { name: 'Seaside Graphics', match: ['SEASIDE GRAPHICS'] },
  { name: 'Amtrak', match: ['AMTRAK'] },
  { name: 'Wallace Home Services', match: ['WALLACEHOME', 'WALLACE HOME'] },
  { name: '1Password', match: ['1PASSWORD'] },
  { name: 'Tailscale', match: ['TAILSCALE'] },
  { name: 'Resend', match: ['RESEND'] },
  { name: 'Pond5', match: ['POND5'] },
];

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Turn a raw bank description into a clean, groupable merchant name for the
 * drill-down. Known merchants map to a curated label; everything else gets a
 * best-effort cleanup (ACH originator name, stripped processor prefixes, no
 * trailing store/transaction numbers).
 */
export function canonicalVendor(description: string): string {
  const s = (description || '').toUpperCase().trim();
  if (!s) return 'Unknown';
  for (const v of CANONICAL_VENDORS) {
    if (v.match.some(m => s.includes(m))) return v.name;
  }
  // ACH lines carry the real payee after "ORIG CO NAME:".
  const orig = s.match(/ORIG CO NAME:\s*([A-Z0-9 &'.]+?)\s{2,}/);
  if (orig) return titleCase(orig[1].trim());
  let t = s;
  for (const p of ['TST* ', 'SQ *', 'SP ', 'PY *', 'PAYPAL *', 'WWW.', 'CKE*', 'DD *', 'IN *']) {
    if (t.startsWith(p)) t = t.slice(p.length);
  }
  t = t.split(/\*| {2,}/)[0];
  t = t.replace(/\s+#?\d[\d\-.]*$/, '').trim();
  return titleCase(t.slice(0, 28)) || 'Unknown';
}
