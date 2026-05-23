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
  | 'Guest supplies'
  | 'Repairs & upkeep'
  | 'Insurance'
  | 'Health benefits'
  | 'Rent & office'
  | 'Professional'
  | 'Payroll'
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
  { category: 'Listing platforms', matches: ['VRBO', 'HOMEAWAY', 'FURNISHED FINDER', 'FURNISHEDFINDER', 'EXPEDIA'] },
  { category: 'Guest supplies', matches: ['AMAZON', 'AMZN', 'FIX LINENS', 'FIXLINENS', 'WALMART', 'TARGET', 'COSTCO', 'BED BATH', 'WAYFAIR', 'HOMEGOODS', 'IKEA', 'BJS', "BJ'S", 'CRATE&', 'CRATE &', 'CB2', 'POTTERY BARN', 'POTTERYBARN', 'WILLIAMS SONOMA', 'JOSSMAIN', 'JOSS & MAIN', 'WEBSTAURANT', 'AMENITIES', 'HOME DECOR GROUP', 'MARSHALLS'] },
  { category: 'Repairs & upkeep', matches: ['HOME DEPOT', 'HOMEDEPOT', 'LOWES', "LOWE'S", 'ACE HARDWARE', 'HARDWARE', 'TRUE VALUE', 'SHERWIN', 'FERGUSON', 'ROCKY', 'GRAINGER', 'PAONE', 'DASH DRAINS', 'BUILDING CENTER', 'MECHANICAL', 'DROMETER', 'PLUMBING', 'ELECTRIC', 'WALLACEHOME', 'WALLACE HOME'] },
  { category: 'Insurance', matches: ['PHILLIPS', 'INSURANCE', 'INSUR', 'GEICO', 'PROGRESSIVE', 'STATE FARM', 'LIBERTY MUT', 'TRAVELERS', 'HARTFORD'] },
  { category: 'Health benefits', matches: ['COMMONWEALTH HEA', 'BLUE CROSS', 'BLUECROSS', 'BCBS', 'HARVARD PILGRIM', 'TUFTS HEALTH', 'UNITEDHEALTH', 'AETNA', 'CIGNA'] },
  { category: 'Rent & office', matches: ['85EASTERN', 'EASTERN LANDLORD', 'EASTERNLANDLORD', 'LANDLORD', 'STAPLES', 'OFFICE DEPOT', 'DUMPSTER', 'WASTE MGMT', 'WASTE MANAGEMENT', 'REPUBLIC SERVICES'] },
  { category: 'Professional', matches: ['MSCONSULTANTS', 'MS CONSULTANTS', 'MH PARTNERS', 'MHPARTNERS', 'SUPPORTING STRATEGIES', 'LEGALZOOM', 'ATTORNEY', 'LAW OFFICE', 'LAW LLC', 'TEMPUS FUGIT', 'CPA', 'ACCOUNTING'] },
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
  // Drop every internal transfer / card payoff / non-vendor movement.
  const t = (type || '').toUpperCase();
  if (t === 'ACCT_XFER' || t === 'LOAN_PMT') return null;
  if (TRANSFER_SIGNALS.some(s => descUpper.includes(s))) return null;
  // Personal debit-card spend on the operating account (Starbucks etc.).
  if (descUpper.includes('STARBUCKS') || descUpper.includes('DUNKIN') || /\bGAS\b/.test(descUpper)) return null;
  // Whitelist only: the operating account is mostly noise, so we keep only
  // recognized overhead vendors. Unknown debits are excluded (flagged in
  // the ingest summary so they can be added if they're real).
  return matchVendor(descUpper);
}

export const OVERHEAD_CATEGORIES: OverheadCategory[] = [
  'Software', 'Marketing', 'Listing platforms', 'Guest supplies',
  'Repairs & upkeep', 'Insurance', 'Health benefits', 'Rent & office',
  'Professional', 'Payroll', 'Travel', 'Bank fees', 'Other',
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
