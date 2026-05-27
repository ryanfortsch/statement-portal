/**
 * Vendor-pattern intelligence for the Books AI categorizer.
 *
 * Distilled from the 2025 General Ledger audit (Rising Tide STR LLC's
 * Transaction Detail by Account export, 2026-05-27). These are the
 * patterns Supporting Strategies actually used -- judgment calls that
 * are stable enough to feed the AI as priors so it doesn't have to
 * re-derive them per request.
 *
 * The categorizer includes these hints in its system prompt as a
 * compact rule list. The AI is still authoritative -- it can override
 * a hint when the transaction context contradicts it -- but they cut
 * common confusions (Cape Ann Elite into "Cleaning" vs the property
 * pass-through, Amazon into property repair vs company supplies, etc.).
 */

export type VendorHint = {
  /** Lowercased substring matched against the bank descriptor. */
  matcher: string;
  /** Plain-English rule the AI should apply when this matcher hits. */
  rule: string;
  /** Default category_key if the rule doesn't have additional context. */
  default_category: string;
};

export const VENDOR_HINTS: VendorHint[] = [
  // ── Property pass-through (Rising Tide only) ────────────────────────
  {
    matcher: 'cape ann elite',
    rule: 'Cape Ann Elite is the cleaning vendor for all managed properties. ACH debits from Cape Ann Elite are ALWAYS pass-through Property Cleaning, NEVER the operating "Cleaning" account. Biggest 1099 candidate at $138k+ in 2025.',
    default_category: 'property_cleaning',
  },

  // ── Channel revenue / fees (Rising Tide pass-through) ──────────────
  {
    matcher: 'airbnb',
    rule: 'Airbnb ACH credits to per-property accounts are Accommodation Fares (gross). Net of Airbnb host fees, which appear as separate debit entries on the Airbnb statement.',
    default_category: 'accommodation_fares',
  },
  {
    matcher: 'vrbo',
    rule: 'VRBO inflows are Accommodation Fares; VRBO fees taken at payout are pt_host_channel_fees.',
    default_category: 'accommodation_fares',
  },
  {
    matcher: 'booking.com',
    rule: 'Booking.com is similar to VRBO -- gross to Accommodation Fares, with channel commission auto-debited the following month.',
    default_category: 'accommodation_fares',
  },

  // ── Software / SaaS — Rising Tide operating ─────────────────────────
  {
    matcher: 'guesty',
    rule: 'Guesty splits into two: round monthly amounts (e.g. $1,118.75) are the SaaS subscription -> software_apps. Variable per-booking percentage charges are the merchant/processing fee -> merchant_account_fees. Look at the amount pattern.',
    default_category: 'software_apps',
  },
  {
    matcher: 'pricelabsinc',
    rule: 'PriceLabs dynamic pricing tool -> memberships_subscriptions.',
    default_category: 'memberships_subscriptions',
  },
  {
    matcher: 'pricelabs',
    rule: 'PriceLabs dynamic pricing tool -> memberships_subscriptions.',
    default_category: 'memberships_subscriptions',
  },
  {
    matcher: 'squarespace',
    rule: 'Squarespace website hosting -> software_apps.',
    default_category: 'software_apps',
  },
  {
    matcher: 'claude.ai',
    rule: 'Anthropic Claude subscription -> software_apps.',
    default_category: 'software_apps',
  },
  {
    matcher: 'anthropic',
    rule: 'Anthropic / Claude API -> software_apps.',
    default_category: 'software_apps',
  },
  {
    matcher: 'apple',
    rule: 'Apple charges split by amount: small recurring (<$50/mo) = software_apps (iCloud/services). Large one-time ($500+) = computers_tablets (equipment).',
    default_category: 'software_apps',
  },
  {
    matcher: 'furnished finder',
    rule: 'Furnished Finder listing subscription -> memberships_subscriptions.',
    default_category: 'memberships_subscriptions',
  },
  {
    matcher: 'indeed',
    rule: 'Indeed job postings -> memberships_subscriptions (recurring) or social_media (one-off ad spend).',
    default_category: 'memberships_subscriptions',
  },

  // ── Advertising ─────────────────────────────────────────────────────
  {
    matcher: 'facebk',
    rule: 'Facebook Ads -> social_media. Descriptor often "FACEBK *TEMP HOLD".',
    default_category: 'social_media',
  },
  {
    matcher: 'facebook',
    rule: 'Facebook Ads -> social_media.',
    default_category: 'social_media',
  },
  {
    matcher: 'google *ads',
    rule: 'Google Ads -> social_media (Rising Tide bookkeeper consistently put Google Ads under Social media, not Web/Email Marketing).',
    default_category: 'social_media',
  },
  {
    matcher: 'mailchimp',
    rule: 'Mailchimp email marketing -> web_email_marketing.',
    default_category: 'web_email_marketing',
  },
  {
    matcher: 'vistaprint',
    rule: 'VistaPrint marketing collateral -> advertising_marketing (parent).',
    default_category: 'advertising_marketing',
  },
  {
    matcher: 'pond 5',
    rule: 'Pond5 stock media -> web_email_marketing.',
    default_category: 'web_email_marketing',
  },

  // ── Legal & accounting ──────────────────────────────────────────────
  {
    matcher: 'supporting strategies',
    rule: 'Supporting Strategies was the outgoing bookkeeper -> accounting_fees (under legal_accounting). Recurring monthly.',
    default_category: 'accounting_fees',
  },
  {
    matcher: 'mh partners',
    rule: 'MH Partners accounting/finance services -> legal_accounting.',
    default_category: 'legal_accounting',
  },
  {
    matcher: 'ms consultants',
    rule: 'MS Consultants does cost segregation studies. Large one-time ($4k+) usually -> repairs_maintenance (cost seg). Smaller recurring -> legal_accounting. Use context.',
    default_category: 'legal_accounting',
  },
  {
    matcher: 'tempus fugit',
    rule: 'Tempus Fugit Law -> legal_fees.',
    default_category: 'legal_fees',
  },

  // ── Insurance ───────────────────────────────────────────────────────
  {
    matcher: 'arbella',
    rule: 'Arbella Insurance -> insurance_vehicle for Rising Tide.',
    default_category: 'insurance_vehicle',
  },
  {
    matcher: 'geico',
    rule: 'Geico -> insurance_vehicle (Rising Tide). Recurring.',
    default_category: 'insurance_vehicle',
  },
  {
    matcher: 'phillips insurance',
    rule: 'Phillips Insurance is the business/property insurer -> insurance_business or insurance_property based on the policy named in the memo.',
    default_category: 'insurance_business',
  },

  // ── Payroll / payments ──────────────────────────────────────────────
  {
    matcher: 'gusto',
    rule: 'Gusto payroll service fee -> payroll_service_fee.',
    default_category: 'payroll_service_fee',
  },

  // ── Travel ──────────────────────────────────────────────────────────
  {
    matcher: 'delta',
    rule: 'Delta Airlines -> travel_airfare.',
    default_category: 'travel_airfare',
  },
  {
    matcher: 'american airlines',
    rule: 'American Airlines -> travel_airfare.',
    default_category: 'travel_airfare',
  },
  {
    matcher: 'enterprise rent',
    rule: 'Enterprise Rent-A-Car -> travel_vehicle_rental.',
    default_category: 'travel_vehicle_rental',
  },
  {
    matcher: 'shell',
    rule: 'Shell, gas stations (Gulf, Exxon, Circle K, Mobil) -> travel_vehicle_gas if work travel, vehicle_gas_fuel if personal-vehicle use. Default to travel_vehicle_gas for Rising Tide; vehicle_gas_fuel for Goose entities.',
    default_category: 'travel_vehicle_gas',
  },

  // ── Supplies & vendors that vary by context ─────────────────────────
  {
    matcher: 'amazon',
    rule: 'Amazon CONTEXT-DEPENDENT by which bank account: purchases on Rising Tide Main (5130) or A. OBrien CC (3878) -> supplies_materials (company supplies). Purchases on a per-property account (KITTREDGE 1323, McWethy 8221, etc.) -> property_repair_maintenance (pass-through, charged to the owner). The account context in the prompt distinguishes them.',
    default_category: 'supplies_materials',
  },
  {
    matcher: 'fix linens',
    rule: 'Fix Linens (descriptor "SP FIX LINENS") -> supplies_materials. Biggest non-CapeAnn vendor at ~$30k/yr.',
    default_category: 'supplies_materials',
  },
  {
    matcher: 'home depot',
    rule: 'Home Depot -> repairs_maintenance for Rising Tide ops; property_repair_maintenance if charged to a per-property account.',
    default_category: 'repairs_maintenance',
  },
  {
    matcher: 'ace hardware',
    rule: 'Ace Hardware -> repairs_maintenance for Rising Tide ops; property_repair_maintenance if charged to a per-property account.',
    default_category: 'repairs_maintenance',
  },
  {
    matcher: 'target',
    rule: 'Target -> supplies_materials.',
    default_category: 'supplies_materials',
  },
  {
    matcher: 'joss & main',
    rule: 'Joss & Main furniture/home -> supplies_materials.',
    default_category: 'supplies_materials',
  },
  {
    matcher: 'crate & barrel',
    rule: 'Crate & Barrel / CB2 furniture -> supplies_materials.',
    default_category: 'supplies_materials',
  },

  // ── Meals ───────────────────────────────────────────────────────────
  {
    matcher: 'tst*',
    rule: 'TST* prefix is Toast POS at a restaurant -> meals.',
    default_category: 'meals',
  },
  {
    matcher: 'doordash',
    rule: 'DoorDash -> meals.',
    default_category: 'meals',
  },
  {
    matcher: 'starbucks',
    rule: 'Starbucks -> meals.',
    default_category: 'meals',
  },

  // ── Taxes / regulatory ──────────────────────────────────────────────
  {
    matcher: 'massachusetts dor',
    rule: 'Massachusetts DOR room-occupancy tax remittance -> ma_tax. These flow from the *9928 tax account.',
    default_category: 'ma_tax',
  },
  {
    matcher: 'ct secretary',
    rule: 'CT Secretary of State filing -> filing_fees.',
    default_category: 'filing_fees',
  },

  // ── Utilities / phone ──────────────────────────────────────────────
  {
    matcher: 'at&t',
    rule: 'AT&T phone service -> utilities_phone.',
    default_category: 'utilities_phone',
  },

  // ── Bank operations / non-P&L ──────────────────────────────────────
  {
    matcher: 'online transfer to chk',
    rule: 'Internal Chase transfer between own accounts -> intercompany_due / transfer. NOT an expense. The categorizer should mark these as transfers, not P&L entries.',
    default_category: 'intercompany_due',
  },
  {
    matcher: 'online transfer from chk',
    rule: 'Internal Chase transfer between own accounts -> intercompany_due / transfer. NOT an expense.',
    default_category: 'intercompany_due',
  },
  {
    matcher: 'same-day ach payment',
    rule: 'Same-Day ACH outbound (e.g. to property owners like DennisSenecal53RockyNeck) -> property_owner_payouts (pass-through) when going to a property owner; intercompany_due when going to a Goose entity. Use the recipient name.',
    default_category: 'property_owner_payouts',
  },
  {
    matcher: 'chase fee',
    rule: 'Chase service fees -> bank_service_charges.',
    default_category: 'bank_service_charges',
  },
  {
    matcher: 'credit card',
    rule: 'A "payment to Credit Card" descriptor on the bank side is the monthly CC payoff -> NOT an expense, mark as transfer. The expense was already booked when the card was swiped.',
    default_category: 'intercompany_due',
  },

  // ── Property owner reimbursements (negative entries on R&M) ────────
  {
    matcher: 'claudia',
    rule: 'Negative entries with Claudia / Rocky Neck in the descriptor are owner reimbursements -- typically reverse a prior charge. Same category as the original but as a contra. The categorizer should accept negative repairs_maintenance or supplies entries without warning.',
    default_category: 'repairs_maintenance',
  },
  {
    matcher: 'goose of calderwood',
    rule: 'Inter-entity transfers between Rising Tide and Goose of Calderwood -> intercompany_due.',
    default_category: 'intercompany_due',
  },
  {
    matcher: 'goose of astoria',
    rule: 'Inter-entity transfers -> intercompany_due.',
    default_category: 'intercompany_due',
  },
];

/**
 * Renders the vendor hint table as a compact bullet list for the AI
 * categorizer's system prompt. Kept short -- under 2k tokens -- so it
 * doesn't crowd out the chart of accounts.
 */
export function vendorHintsForPrompt(): string {
  return VENDOR_HINTS
    .map((h) => `  - "${h.matcher}" → ${h.default_category} | ${h.rule}`)
    .join('\n');
}
