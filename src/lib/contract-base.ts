/**
 * Structured representation of the Rising Tide management contract.
 *
 * Replaces what was 600+ lines of hard-coded JSX in ContractDocument.tsx.
 * Each section, paragraph, and bullet has a stable ID. The redlines tool
 * (and any future override mechanism) targets clauses by ID instead of
 * by string matching or position. Without these IDs, every owner-requested
 * edit collapsed into a "Rider — Additional Terms" appendix because the
 * apply step had no way to identify what to modify.
 *
 * Template strings use {{varName}} for deal-specific values. The renderer
 * (see contract-overrides.ts → renderContractContent) interpolates these
 * with real React nodes (e.g. <Term> spans, <DateOrBlank/> fillable
 * underlines for empty dates).
 *
 * Available variables:
 *   {{ownerName}}        - prospect_full_legal or prospect_name
 *   {{propertyAddress}}  - property_address[, property_city]
 *   {{propertyType}}     - House / Condo / Cottage / etc.
 *   {{mgmtPct}}          - "25%" formatted percent
 *   {{deposit}}          - "$5,000" formatted money
 *   {{minBalance}}       - "$2,500" formatted money
 *   {{minDays}}          - "180 days"
 *   {{saleDays}}         - "185 days"
 *   {{repFee}}           - "$5,000"
 *   {{termStartShort}}   - "1/15/2026" or fillable blank
 *   {{termEndShort}}     - same
 *   {{termStartLong}}    - "January 15, 2026" or fillable blank
 *   {{termEndLong}}      - same
 *
 * IDs follow a kebab-case scheme: <section>-<clause-purpose>.
 * Section IDs match the natural section heading slug.
 */

export type ContractClause = {
  id: string;
  type: 'paragraph' | 'bullet';
  /** Template text with {{varName}} placeholders. */
  template: string;
  /** Optional bold prefix (renders as "**Notification Requirement:** ..."). */
  boldPrefix?: string;
  /** Optional nested bullets (only used when type === 'bullet'). */
  children?: ContractClause[];
};

export type ContractKv = {
  /** Two-column kv row (Property Details). */
  type: 'kv';
  id: string;
  label: string;
  /** Template for the value, supports the same {{var}} substitution. */
  valueTemplate: string;
};

export type ContractSectionContent = ContractClause | ContractKv;

export type ContractSection = {
  id: string;
  title: string;
  /** Optional intro paragraph rendered before the content. Same format as a
   *  ContractClause but lives outside the content array so it's never
   *  treated as a bullet/numbered item. */
  intro?: ContractClause;
  content: ContractSectionContent[];
};

export type ContractPage = {
  id: string;
  /** Page 1 is the cover (different layout). Signatures + Rider also have
   *  special render paths. Everything else is a "body" page that renders
   *  its sections sequentially. */
  kind: 'cover' | 'body' | 'signatures';
  /** Sections on this page. Empty for the signatures page (rendered
   *  separately by ContractDocument). */
  sections: ContractSection[];
};

/**
 * The full base contract. Pages 2 onward render through the generic
 * section renderer. Page 1 (cover) and the signatures page have custom
 * rendering because their visual structure is non-standard.
 */
export const CONTRACT_BASE: ContractPage[] = [
  // Page 1: COVER — rendered separately by ContractDocument
  { id: 'cover', kind: 'cover', sections: [] },

  // Page 2
  {
    id: 'page-2',
    kind: 'body',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        content: [
          {
            id: 'summary-parties',
            type: 'paragraph',
            template:
              'This Agreement is made and entered into on {{termStartLong}} by and between Rising Tide STR, LLC ("Property Manager"), a Massachusetts Limited Liability Company, located at 3 Locust Lane, Gloucester, MA, and {{ownerName}} ("Owner"), collectively referred to as the "Parties".',
          },
        ],
      },
      {
        id: 'property-details',
        title: 'Property Details',
        content: [
          { type: 'kv', id: 'property-details-address', label: 'Address', valueTemplate: '{{propertyAddress}}' },
          { type: 'kv', id: 'property-details-type', label: 'Type', valueTemplate: '{{propertyType}}' },
        ],
      },
      {
        id: 'term',
        title: 'Term',
        // Single canonical paragraph. The original contract had a separate
        // "short dates" sentence followed by an almost-identical "long
        // dates + renewal notice" paragraph, which read as duplicate prose
        // back-to-back. Consolidated here.
        content: [
          {
            id: 'term-renewal-notice',
            type: 'paragraph',
            template:
              'This Agreement shall commence on {{termStartLong}} and continue through {{termEndLong}}, unless terminated earlier in accordance with the terms herein. Upon expiration of the initial term, this Agreement shall automatically renew for successive one-year terms unless either party provides written notice of non-renewal. Such notice must be provided at least 120 days prior to the end of the then-current term. This advance notice requirement ensures adequate lead time to close the calendar and prevent unfillable bookings.',
          },
        ],
      },
      {
        id: 'manager-responsibilities',
        title: "Property Manager's Responsibilities",
        content: [
          { id: 'mgr-resp-marketing', type: 'bullet', template: 'Market and advertise the Property for short-term rentals.' },
          { id: 'mgr-resp-bookings', type: 'bullet', template: 'Handle booking and reservations and offer customer support to guests.' },
          { id: 'mgr-resp-collect-payments', type: 'bullet', template: 'Collect rental payments and deposit them into a bank account.' },
          { id: 'mgr-resp-disburse', type: 'bullet', template: 'Disburse rental income to the Owner monthly.' },
          { id: 'mgr-resp-checkin-out', type: 'bullet', template: 'Conduct check-in and check-out procedures.' },
          { id: 'mgr-resp-cleaning', type: 'bullet', template: 'Provide cleaning and maintenance services.' },
          { id: 'mgr-resp-consumables', type: 'bullet', template: 'Supply and replenish consumables, including toiletries, paper towels, toilet paper, etc.' },
          { id: 'mgr-resp-launch-items', type: 'bullet', template: 'Ensure the property is ready for rental by installing necessary items for launching the property.' },
          { id: 'mgr-resp-no-warranty', type: 'bullet', template: 'The Property Manager will use commercially reasonable efforts to market and rent the Property; however, the Property Manager makes no representations or warranties regarding occupancy levels or the amount of rental income that will be generated.' },
        ],
      },
    ],
  },

  // Page 3
  {
    id: 'page-3',
    kind: 'body',
    sections: [
      {
        id: 'initial-deposit',
        title: 'Initial Deposit',
        content: [
          {
            id: 'deposit-amount',
            type: 'bullet',
            boldPrefix: 'Deposit Amount:',
            template: 'The Owner agrees to deposit {{deposit}} into the bank account to cover initial setup costs and maintain this minimum balance for ongoing expenses.',
          },
          {
            id: 'deposit-use',
            type: 'bullet',
            boldPrefix: 'Use of Deposit:',
            template: 'The deposit will be used for the purchase of necessary items to launch the property. Additional setup items may include:',
            children: [
              { id: 'deposit-use-decor', type: 'bullet', template: 'Interior decor and furnishings to enhance the guest experience' },
              { id: 'deposit-use-kitchen', type: 'bullet', template: 'Basic kitchen supplies' },
              { id: 'deposit-use-ops', type: 'bullet', template: 'Operational necessities (i.e., smart lock)' },
            ],
          },
          {
            id: 'deposit-ownership',
            type: 'bullet',
            boldPrefix: 'Ownership of Purchased Items:',
            template: "All items purchased with initial deposit will become the Owner's property.",
          },
          {
            id: 'deposit-min-balance',
            type: 'bullet',
            boldPrefix: 'Minimum Account Balance:',
            template: 'The account must maintain a minimum balance of {{minBalance}} at all times. If the balance falls below {{minBalance}}, the Property Manager is authorized to deduct the necessary amount from the Gross Rental Income to restore the balance.',
          },
        ],
      },
      {
        id: 'rental-income-and-fees',
        title: 'Rental Income and Fees',
        content: [
          {
            id: 'rental-income-definition',
            type: 'bullet',
            boldPrefix: 'Gross Rental Income Definition:',
            template: '"Gross Rental Income" shall be defined as the total rental revenue received by Rising Tide STR, LLC in connection with the Property from all sources, including but not limited to short-term rental platforms (e.g., Airbnb, VRBO), direct bookings, and any other booking channels, after the deduction of platform service fees, payment processing fees, taxes, or any other charges imposed by the platform, payment processor, or governmental authority. This includes all revenue streams from the rental, such as rental fees, cleaning fees, and any additional service charges paid by guests.',
          },
          {
            id: 'rental-income-commission',
            type: 'bullet',
            boldPrefix: 'Commission on Gross Rental Income:',
            template: 'The Property Manager shall deduct a fee of {{mgmtPct}} of the Gross Rental Income as compensation for its management services. This fee will be calculated based on the net amount received post-platform fees and taxes.',
          },
          {
            id: 'rental-income-extra-services',
            type: 'bullet',
            template: 'Additional fees will only apply to extraordinary services that fall outside the scope of routine management. Examples include:',
            children: [
              { id: 'rental-income-extra-repairs', type: 'bullet', template: "Coordinating large-scale repairs or renovations at the Owner's request." },
              { id: 'rental-income-extra-emergency', type: 'bullet', template: 'Emergency interventions requiring significant time, such as addressing severe property damage due to natural disasters.' },
            ],
          },
          { id: 'rental-income-notice', type: 'bullet', template: 'The Property Manager will provide written notice and an estimate of these fees before incurring the cost, ensuring full transparency.' },
          { id: 'rental-income-statement', type: 'bullet', template: 'A detailed statement of rental income and fees will be provided monthly.' },
        ],
      },
    ],
  },

  // Page 4
  {
    id: 'page-4',
    kind: 'body',
    sections: [
      {
        id: 'owner-responsibilities',
        title: "Owner's Responsibilities",
        content: [
          { id: 'owner-resp-access', type: 'bullet', template: 'Provide the Property Manager with access to the Property for management purposes.' },
          {
            id: 'owner-resp-maintenance',
            type: 'bullet',
            template: 'Cover costs related to the maintenance and repair of the Property unless due to guest negligence.',
            children: [
              {
                id: 'owner-resp-guest-negligence-def',
                type: 'bullet',
                template: '"Guest negligence" is defined as damages resulting from a guest\'s intentional acts, gross negligence, or failure to follow property guidelines.',
              },
            ],
          },
          { id: 'owner-resp-utilities', type: 'bullet', template: 'Cover costs related to the utilities and upkeep of the Property.' },
          {
            id: 'owner-resp-compliance',
            type: 'bullet',
            template: "The Owner shall ensure the Property complies with all applicable federal, state, and local laws, regulations, ordinances, and licensing requirements for short-term rentals. The Owner acknowledges that the Property Manager shall not be liable for any fines, penalties, or legal actions resulting from the Owner's failure to comply with such requirements.",
          },
          {
            id: 'owner-resp-habitability',
            type: 'bullet',
            template: 'The Owner is responsible for providing and maintaining the Property in a safe, habitable condition, including adherence to building codes, fire safety requirements, and any other relevant health and safety regulations.',
          },
        ],
      },
      {
        id: 'min-availability',
        title: 'Minimum Availability for Rental',
        content: [
          {
            id: 'min-availability-clause',
            type: 'paragraph',
            template:
              'The Owner agrees to make the Property available for short-term rental for a minimum of {{minDays}} during the term of this Agreement. Availability is calculated as any day the Property is listed and unblocked for booking on short-term rental platforms.',
          },
        ],
      },
      {
        id: 'payments-and-accounting',
        title: 'Payments and Accounting',
        content: [
          { id: 'payments-disbursement', type: 'bullet', template: "Rental income, after deduction of Property Manager's fees, will be disbursed to the Owner monthly." },
          { id: 'payments-records', type: 'bullet', template: 'The Property Manager shall maintain accurate records of all transactions and provide the Owner with monthly financial statements.' },
          { id: 'payments-taxes', type: 'bullet', template: 'The Property Manager is responsible for collecting and remitting occupancy and lodging taxes for each booking platform used.' },
        ],
      },
      {
        id: 'expenses',
        title: 'Expenses',
        content: [
          {
            id: 'expenses-owner',
            type: 'bullet',
            boldPrefix: "Owner's Responsibilities:",
            template: 'The Owner shall cover costs related to the maintenance and repair of the Property unless the damage is due to guest negligence.',
          },
          {
            id: 'expenses-manager',
            type: 'bullet',
            boldPrefix: "Property Manager's Responsibilities:",
            template: 'The Property Manager shall make efforts to recover costs for damages caused by guests via the short-term rental platforms, credit card holds or insurance (if applicable).',
          },
          {
            id: 'expenses-consumables',
            type: 'bullet',
            boldPrefix: 'Consumables and Utilities:',
            template: 'The Owner shall cover costs related to the utilities and upkeep of the Property, while the Property Manager will cover the costs of replenishment of consumables (e.g., toiletries, paper towels, toilet paper).',
          },
        ],
      },
    ],
  },

  // Page 5
  {
    id: 'page-5',
    kind: 'body',
    sections: [
      {
        id: 'termination',
        title: 'Termination',
        content: [
          {
            id: 'termination-clause',
            type: 'paragraph',
            template:
              "Either Party may terminate this Agreement upon a material breach by the other Party, provided the breaching Party fails to cure such breach within thirty (30) days of receiving written notice. In the event of a severe breach that materially threatens the Property Manager's ability to operate (such as refusal to honor existing bookings or failure to comply with critical legal or safety requirements), the non-breaching Party may terminate this Agreement immediately without further notice.",
          },
        ],
      },
      {
        id: 'protection-against-sale',
        title: 'Protection Against Sale of Property',
        intro: {
          id: 'protection-intro',
          type: 'paragraph',
          template:
            "Cancellations of confirmed reservations can inflict serious harm on a short-term rental business. Apart from the immediate loss of rental income, platforms like Airbnb or VRBO may impose penalties, require refunds to guests, or, in severe cases, remove the Property Manager from their platforms. Such outcomes can damage the Property Manager's reputation and future hosting ability, necessitating the following protections:",
        },
        content: [
          {
            id: 'protection-notification',
            type: 'bullet',
            boldPrefix: 'Notification Requirement:',
            template: 'The Owner shall provide the Property Manager with {{saleDays}} written notice of intent to sell the Property.',
          },
          {
            id: 'protection-existing-reservations',
            type: 'bullet',
            boldPrefix: 'Existing Reservations:',
            template: 'The Owner agrees to either: (a) Ensure the buyer honors all existing reservations; or (b) Compensate the Property Manager for all direct costs incurred due to the cancellation of these reservations.',
          },
          {
            id: 'protection-compensation',
            type: 'bullet',
            boldPrefix: 'Compensation for Cancellations:',
            template: 'If existing reservations cannot be honored, the Owner shall compensate the Property Manager as follows:',
            children: [
              {
                id: 'protection-comp-lost-gri',
                type: 'bullet',
                boldPrefix: 'Lost Gross Rental Income.',
                template: 'The total Gross Rental Income projected from all affected reservations based on average nightly rates for similar periods.',
              },
              {
                id: 'protection-comp-platform-penalties',
                type: 'bullet',
                boldPrefix: 'Platform Penalties.',
                template: 'Any fees, penalties, or fines imposed by booking platforms (e.g., Airbnb, VRBO) due to cancellations resulting from the sale.',
              },
              {
                id: 'protection-comp-reputation',
                type: 'bullet',
                boldPrefix: 'Reputation Damages.',
                template: 'A fixed fee of {{repFee}} to cover long-term reputational harm. This amount reflects the typical loss incurred from platform penalties, reduced listing visibility, and adverse guest reviews.',
              },
            ],
          },
          {
            id: 'protection-binding',
            type: 'bullet',
            boldPrefix: 'Binding Obligation:',
            template: 'This clause shall remain binding on the Owner and any potential buyer. The Owner agrees to disclose this obligation to the buyer as part of the sale agreement. Failure to do so may result in the Owner being liable for all outlined damages.',
          },
        ],
      },
    ],
  },

  // Page 6 (legal text)
  {
    id: 'page-6',
    kind: 'body',
    sections: [
      {
        id: 'liability-and-indemnification',
        title: 'Liability and Indemnification',
        content: [
          {
            id: 'liability-clause',
            type: 'paragraph',
            template:
              'The Property Manager shall not be liable for any damage or loss unless due to willful misconduct or gross negligence. The Owner shall indemnify the Property Manager against any claims arising from the ownership, use, or condition of the Property.',
          },
        ],
      },
      {
        id: 'insurance-and-liability-coverage',
        title: 'Insurance & Liability Coverage',
        content: [
          {
            id: 'insurance-owner-obligations',
            type: 'bullet',
            boldPrefix: "Owner's Insurance Obligations:",
            template: "The Owner shall maintain at all times, at the Owner's own expense, a comprehensive homeowner's insurance policy that covers short-term rental activities, including liability coverage for personal injury or property damage incurred by guests.",
          },
          {
            id: 'insurance-additional-insured',
            type: 'bullet',
            boldPrefix: 'Property Manager as Additional Insured:',
            template: 'The Owner shall name the Property Manager as an additional insured (or additional interest if full additional insured status is not available) on the insurance policy if such coverage is obtainable.',
          },
          {
            id: 'insurance-evidence',
            type: 'bullet',
            boldPrefix: 'Evidence of Coverage:',
            template: 'The Owner agrees to provide proof of such insurance upon execution of this Agreement and annually thereafter.',
          },
        ],
      },
      {
        id: 'force-majeure',
        title: 'Force Majeure',
        content: [
          {
            id: 'force-majeure-clause',
            type: 'paragraph',
            template:
              "Neither Party shall be held liable for failure or delay in fulfilling its obligations under this Agreement if such failure or delay is caused by or results from events beyond that Party's reasonable control, including but not limited to natural disasters, acts of government, pandemics, or other unforeseen circumstances. The affected Party shall notify the other Party within 10 business days of the occurrence of the force majeure event. Both Parties will work in good faith to mitigate the impact of the force majeure event.",
          },
        ],
      },
      {
        id: 'dispute-resolution',
        title: "Dispute Resolution & Attorneys' Fees",
        content: [
          {
            id: 'dispute-resolution-clause',
            type: 'paragraph',
            template:
              "In the event of any dispute arising under or relating to this Agreement, the Parties agree first to attempt to resolve the dispute through good-faith negotiation. Should such negotiation fail, either Party may resort to litigation or arbitration. The prevailing Party in any litigation or arbitration arising from this Agreement shall be entitled to recover its reasonable attorneys' fees, court costs, and other expenses incurred.",
          },
        ],
      },
      {
        id: 'severability',
        title: 'Severability',
        content: [
          {
            id: 'severability-clause',
            type: 'paragraph',
            template:
              'If any provision of this Agreement is deemed unlawful or unenforceable, the remainder of the Agreement shall remain in full force and effect. The Parties agree to negotiate a replacement provision within 30 days of invalidation, ensuring the replacement aligns as closely as possible with the original intent of the Agreement.',
          },
        ],
      },
      {
        id: 'governing-law',
        title: 'Governing Law & Entire Agreement',
        content: [
          {
            id: 'governing-law-clause',
            type: 'paragraph',
            template:
              'This Agreement shall be governed by and construed in accordance with the laws of the State of Massachusetts. This document represents the entire agreement between the Parties and supersedes all prior communications, agreements, or understandings, written or oral, concerning the subject matter hereof.',
          },
        ],
      },
    ],
  },

  // Signatures page — rendered separately by ContractDocument
  { id: 'signatures', kind: 'signatures', sections: [] },
];

/** Flat list of every clause + section ID, for LLM prompt + UI lookups.
 *  `depth` indicates nesting level: 0 = top-level bullet/paragraph in a
 *  section; 1 = first-level child (sub-bullet); 2 = grandchild; etc. The
 *  LLM uses depth to anchor 'add' overrides at the right nesting level. */
export function listContractIds(pages: ContractPage[] = CONTRACT_BASE): {
  sections: { id: string; title: string }[];
  clauses: { id: string; sectionId: string; depth: number; preview: string }[];
} {
  // Defaults to the base contract, but callers can pass a post-override
  // tree (base + applied redlines) so the inventory reflects the CURRENT
  // contract — including clauses added by previous redlines. Without that,
  // the interpret prompt couldn't see (and therefore couldn't delete or
  // modify) a clause a prior redline had added.
  const sections: { id: string; title: string }[] = [];
  const clauses: { id: string; sectionId: string; depth: number; preview: string }[] = [];
  const collect = (sectionId: string, c: ContractClause | ContractKv, depth: number) => {
    if (c.type === 'kv') {
      clauses.push({ id: c.id, sectionId, depth, preview: `${c.label}: ${c.valueTemplate}` });
      return;
    }
    clauses.push({ id: c.id, sectionId, depth, preview: previewText(c.template, c.boldPrefix) });
    for (const child of c.children ?? []) collect(sectionId, child, depth + 1);
  };
  for (const page of pages) {
    for (const s of page.sections) {
      sections.push({ id: s.id, title: s.title });
      if (s.intro) collect(s.id, s.intro, 0);
      for (const c of s.content) collect(s.id, c, 0);
    }
  }
  return { sections, clauses };
}

function previewText(template: string, boldPrefix?: string): string {
  const t = boldPrefix ? `${boldPrefix} ${template}` : template;
  return t.length > 100 ? `${t.slice(0, 97)}...` : t;
}
