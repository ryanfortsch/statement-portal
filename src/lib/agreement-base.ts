/**
 * Guest rental agreement language — the Stay Cape Ann parallel to
 * contract-base.ts (the prospect management contract).
 *
 * Where the management contract is a fixed clause tree with an override
 * engine (owners redline it), the guest agreement varies STRUCTURALLY:
 * which sections render depends on the agreement kind (short_term vs
 * mid_term) and per-agreement dials (deposit kind, cancellation policy,
 * utilities, cleaning). So instead of base-tree + overrides, this module
 * exposes buildAgreementSections(row) — a pure function that assembles
 * the numbered section list for one agreement. The renderer numbers them
 * in order, so conditional sections never leave gaps.
 *
 * The language is lifted from the four real agreements in use through
 * 2026 (17 Beach short-term; 3 South + 20 Enon mid-term; the legacy
 * Rising Tide / Brier Neck bullet form), normalized onto the newest
 * generation's wording. Bespoke additions land as custom_clauses, which
 * render as their own numbered sections before Governing Law.
 *
 * Pure module: no server-only imports, no env access. Safe for both the
 * document renderer (server) and any client preview.
 */

import type { GuestAgreementRow } from '@/lib/agreement-types';

export type AgreementBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] };

export type AgreementSection = {
  id: string;
  title: string;
  blocks: AgreementBlock[];
};

// ─── Brand / parties constants ──────────────────────────────────────────────

/** Guest-facing brand + operator affiliation, per Dotti 2026-07-10: make it
 *  clear the SCA brand is Rising Tide, since Rising Tide is the name on the
 *  guest's card statement. Renders on the cover and travels with the PDF. */
export const SCA_AFFILIATION_LINE =
  'Stay Cape Ann is the guest-facing brand of Rising Tide Property Management (Rising Tide STR, LLC). ' +
  'Your reservation, payments, and guest support are handled by Rising Tide, and charges may appear on ' +
  'your card or bank statement from Rising Tide STR.';

export const AGREEMENT_HOST_NAME = "Allie O'Brien";
export const AGREEMENT_HOST_ORG = 'Rising Tide Property Management';
export const AGREEMENT_HOST_EMAIL = 'allie@risingtidestr.com';
export const AGREEMENT_HOST_PHONE = '978-387-1573';

/** Document heading under the cover, e.g. "MID-TERM RENTAL AGREEMENT". */
export function agreementHeading(a: Pick<GuestAgreementRow, 'kind'>): string {
  return a.kind === 'mid_term' ? 'Mid-Term Rental Agreement' : 'Short-Term Rental Agreement';
}

/** Subheading qualifier (mid-term carries the no-tenancy flag up top,
 *  matching the 20 Enon form). */
export function agreementSubheading(a: Pick<GuestAgreementRow, 'kind'>): string | null {
  return a.kind === 'mid_term' ? 'Furnished Stay · No Tenancy Created' : null;
}

/** The parties + binding-acknowledgment lead-in above section 1. */
export function agreementIntro(a: GuestAgreementRow): string {
  const kindWord = a.kind === 'mid_term' ? 'Mid-Term' : 'Short-Term';
  return (
    `This ${kindWord} Rental Agreement ("Agreement") is entered into by and between ` +
    `Rising Tide Property Management, operator of the Stay Cape Ann guest brand and ` +
    `authorized agent for the property ("Host"), and ${a.guest_name} ("Guest"). ` +
    `By signing, Guest confirms that they have read, understood, and agreed to this ` +
    `Agreement. This Agreement is legally binding and governs Guest's stay.`
  );
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

export function fmtAgreementMoney(n: number): string {
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

/** "2026-06-22" → "June 22, 2026". Manual split to avoid TZ rollback. */
export function fmtAgreementDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * The municipality phrase for the Quiet Hours section. Cape Ann + nearby
 * municipalities get their proper "City of X regulations" / "Town of X
 * expectations" form (matching the real agreements); anything else falls
 * back to a generic phrase.
 */
export function quietHoursAuthority(propertyCity: string): string {
  const townName = propertyCity.split(',')[0].trim();
  const CITIES = new Set(['Gloucester', 'Beverly', 'Salem', 'Peabody']);
  const TOWNS = new Set(['Rockport', 'Essex', 'Manchester-by-the-Sea', 'Ipswich', 'Hamilton', 'Wenham']);
  if (CITIES.has(townName)) return `City of ${townName} regulations`;
  if (TOWNS.has(townName)) return `Town of ${townName} expectations`;
  return 'local noise regulations';
}

// ─── Section builder ────────────────────────────────────────────────────────

export function buildAgreementSections(a: GuestAgreementRow): AgreementSection[] {
  const mid = a.kind === 'mid_term';
  const startLong = fmtAgreementDate(a.stay_start);
  const endLong = fmtAgreementDate(a.stay_end);
  const fee = fmtAgreementMoney(a.rental_fee);
  const sections: AgreementSection[] = [];

  // 1 — Property & stay
  {
    const blocks: AgreementBlock[] = [
      {
        type: 'paragraph',
        text:
          `This Agreement applies to the ${mid ? 'furnished residential property' : 'property'} located at ` +
          `${a.property_address}, ${a.property_city}. The approved stay dates are ${startLong} through ${endLong}. ` +
          `Guest's right to occupy the property is strictly limited to these dates and automatically terminates at ` +
          `${a.check_out_time} on ${endLong} without further notice.`,
      },
    ];
    if (mid) {
      blocks.push({
        type: 'paragraph',
        text: 'No extension, renewal, or holdover is permitted without prior written approval from Host.',
      });
    }
    sections.push({
      id: 'property-stay',
      title: mid ? 'Property & Occupancy Term' : 'Property & Stay Details',
      blocks,
    });
  }

  // 2 — No tenancy created
  sections.push({
    id: 'no-tenancy',
    title: 'Nature of Stay · No Tenancy Created',
    blocks: mid
      ? [
          {
            type: 'paragraph',
            text:
              'This Agreement grants Guest a temporary, revocable license to occupy a furnished dwelling for ' +
              'short-term residential use only. This Agreement:',
          },
          {
            type: 'bullets',
            items: [
              'Does not create a landlord-tenant relationship',
              'Does not convey tenancy or leasehold rights',
              'Is not governed by Massachusetts landlord-tenant law',
              'Confers no right to continued occupancy beyond the approved stay dates',
            ],
          },
          {
            type: 'paragraph',
            text: 'Guest expressly waives any claim to tenancy, lease renewal, or statutory tenant protections.',
          },
        ]
      : [
          {
            type: 'paragraph',
            text:
              'This Agreement is a license for short-term lodging only and does not create a landlord-tenant ' +
              'relationship. Guest acknowledges they are not a tenant, waives any tenant rights, and has no right ' +
              'to continued occupancy beyond the agreed dates. Massachusetts landlord-tenant laws do not apply ' +
              'to this stay.',
          },
        ],
  });

  // 3 — Rental fee (+ payment terms for mid-term)
  {
    const blocks: AgreementBlock[] = [
      {
        type: 'paragraph',
        text:
          `The total rental fee for the agreed stay is ${fee}. Payment of this amount constitutes acceptance of ` +
          `this Agreement and does not create any rights of tenancy or ongoing occupancy beyond the approved ` +
          `stay dates.`,
      },
    ];
    if (mid) {
      blocks.push({
        type: 'bullets',
        items: [
          'Payment is due in full prior to occupancy',
          ...(a.no_early_termination
            ? ['No proration, refunds, or credits will be provided for early departure']
            : []),
        ],
      });
    }
    sections.push({
      id: 'rental-fee',
      title: mid ? 'Rental Fee & Payment Terms' : 'Rental Fee',
      blocks,
    });
  }

  // 4 — Deposit (by kind)
  if (a.deposit_kind !== 'none' && a.deposit_amount != null) {
    const amt = fmtAgreementMoney(a.deposit_amount);
    if (a.deposit_kind === 'security') {
      sections.push({
        id: 'deposit',
        title: 'Security Deposit',
        blocks: [
          {
            type: 'paragraph',
            text:
              `A ${amt} security deposit will be held and may be applied toward damages, excessive cleaning, or ` +
              `violations of this Agreement. The deposit will be returned promptly following the stay, less any ` +
              `applicable deductions.`,
          },
        ],
      });
    } else if (a.deposit_kind === 'damage') {
      sections.push({
        id: 'deposit',
        title: 'Damage Deposit',
        blocks: [
          {
            type: 'paragraph',
            text:
              `Guest shall pay a damage deposit in the amount of ${amt}. This is not a security deposit under ` +
              `Massachusetts law. It is a contractual damage deposit intended to cover:`,
          },
          {
            type: 'bullets',
            items: [
              'Damage beyond normal wear and tear',
              'Excessive cleaning',
              'Missing items',
              'Violations of this Agreement',
            ],
          },
          {
            type: 'paragraph',
            text:
              'Any unused portion will be returned within a reasonable period following departure, less ' +
              'documented deductions if applicable.',
          },
        ],
      });
    } else {
      sections.push({
        id: 'deposit',
        title: 'Deposit Hold',
        blocks: [
          {
            type: 'paragraph',
            text:
              `A deposit of ${amt} will be pre-authorized on Guest's payment method at the time of booking ` +
              `confirmation. This hold will be released within 10 days after check-out, provided no damages, ` +
              `policy violations, or outstanding fees are identified.`,
          },
        ],
      });
    }
  }

  // 5 — Cancellation
  sections.push({
    id: 'cancellation',
    title: 'Cancellation Policy',
    blocks:
      a.cancel_cutoff_days != null
        ? [
            {
              type: 'bullets',
              items: [
                `${a.cancel_refund_pct ?? 50}% refund for cancellations made more than ${a.cancel_cutoff_days} days ` +
                  `prior to check-in, less processing fees`,
                `No refunds for cancellations made within ${a.cancel_cutoff_days} days of check-in`,
                'No-shows are not eligible for a refund',
              ],
            },
          ]
        : [
            {
              type: 'paragraph',
              text:
                'All payments are non-refundable. Cancellations, early departures, and no-shows are not ' +
                'eligible for a refund or credit.',
            },
          ],
  });

  // 6 — Occupancy & access
  {
    const blocks: AgreementBlock[] = [];
    if (a.additional_occupants) {
      blocks.push({
        type: 'paragraph',
        text: `Approved occupants are limited to: ${a.additional_occupants}.`,
      });
    }
    if (a.max_occupancy != null) {
      blocks.push({
        type: 'paragraph',
        text:
          `The property sleeps a maximum of ${a.max_occupancy} guests. If Guest anticipates a group larger than ` +
          `${a.max_occupancy} at any time during the stay, Guest agrees to notify Host in advance for approval.`,
      });
    }
    blocks.push({
      type: 'paragraph',
      text:
        'Access is limited to approved occupants only, the booking guest must be present for the duration of ' +
        'the stay, and unauthorized occupancy may result in additional fees or termination of the stay ' +
        'without refund.',
    });
    sections.push({ id: 'occupancy', title: 'Occupancy & Access', blocks });
  }

  // 7 — Utilities & services (mid-term)
  if (mid && (a.utilities_included.length > 0 || a.snow_removal_by_guest)) {
    const blocks: AgreementBlock[] = [];
    if (a.utilities_included.length > 0) {
      blocks.push(
        { type: 'paragraph', text: 'The following utilities and services are included in the rental fee:' },
        { type: 'bullets', items: a.utilities_included },
      );
    }
    if (a.snow_removal_by_guest) {
      blocks.push({
        type: 'paragraph',
        text:
          'Snow removal is not included. Guest is responsible for snow removal during the stay unless ' +
          'otherwise agreed in writing.',
      });
    }
    sections.push({ id: 'utilities', title: 'Utilities & Services', blocks });
  }

  // 8 — Cleaning
  if (a.cleaning_fee_separate || a.midstay_cleaning) {
    const blocks: AgreementBlock[] = [];
    if (a.cleaning_fee_separate) {
      blocks.push({
        type: 'paragraph',
        text:
          'A departure cleaning fee will be billed to Guest following checkout. This fee is separate from the ' +
          'rental fee' +
          (a.deposit_kind !== 'none' ? ' and deposit' : '') +
          '. Failure to leave the property in reasonable condition may result in additional cleaning charges.',
      });
    }
    if (a.midstay_cleaning) {
      blocks.push({
        type: 'paragraph',
        text:
          'For longer stays, Host will provide a complimentary mid-stay cleaning to ensure the home remains in ' +
          'excellent condition throughout the visit. This service will be scheduled in coordination with Guest ' +
          'at a convenient time and will include general cleaning, linen refresh, and light turnover.',
      });
    }
    sections.push({ id: 'cleaning', title: 'Cleaning', blocks });
  }

  // 9 — Check-in / check-out
  {
    const blocks: AgreementBlock[] = [
      {
        type: 'bullets',
        items: [
          `Check-In: ${a.check_in_time}${mid ? ` on ${startLong}` : ''}`,
          `Check-Out: ${a.check_out_time}${mid ? ` on ${endLong}` : ''}`,
        ],
      },
    ];
    if (mid && a.no_early_termination) {
      blocks.push({
        type: 'paragraph',
        text: 'Late departure is not permitted. Failure to vacate on time constitutes an unauthorized holdover.',
      });
    } else {
      blocks.push({
        type: 'paragraph',
        text: 'Early check-in or late check-out may be available with prior approval and additional fees.',
      });
    }
    sections.push({ id: 'check-in-out', title: 'Check-In / Check-Out', blocks });
  }

  // 10 — No early termination (mid-term dial)
  if (mid && a.no_early_termination) {
    sections.push({
      id: 'no-early-termination',
      title: 'No Early Termination',
      blocks: [
        {
          type: 'paragraph',
          text:
            'Early termination by Guest is not permitted. Guest remains financially responsible for the full ' +
            'rental fee regardless of early departure.',
        },
      ],
    });
  }

  // 11 — Quiet hours
  sections.push({
    id: 'quiet-hours',
    title: 'Quiet Hours',
    blocks: [
      {
        type: 'paragraph',
        text:
          `Quiet hours are observed from ${a.quiet_hours}, in accordance with ${quietHoursAuthority(a.property_city)}. ` +
          `Guests must keep noise to a minimum and avoid activities that may disturb neighboring residences.`,
      },
    ],
  });

  // 12 — House rules
  sections.push({
    id: 'house-rules',
    title: 'House Rules & Prohibited Conduct',
    blocks: [
      {
        type: 'paragraph',
        text:
          'Guest agrees to comply with all house rules provided prior to or during the stay. Parties or events, ' +
          'illegal activity, smoking or vaping inside the property, and pets without prior written approval are ' +
          'strictly prohibited. Violations constitute a material breach of this Agreement and may result in ' +
          'termination of the stay without refund.',
      },
    ],
  });

  // 13 — Safety & personal property
  sections.push({
    id: 'safety',
    title: 'Safety & Personal Property',
    blocks: [
      {
        type: 'paragraph',
        text:
          'Guest is responsible for securing the property during the stay. Host is not responsible for lost, ' +
          'stolen, or damaged personal property. Guest assumes all risk for personal belongings.',
      },
    ],
  });

  // 14 — Damage & condition
  sections.push({
    id: 'damage',
    title: 'Damage & Condition',
    blocks: [
      {
        type: 'paragraph',
        text:
          'Guest agrees to maintain the property in good condition and to promptly report any damage. Costs for ' +
          'repair or replacement beyond normal wear and tear may be charged to the payment method on file with ' +
          'supporting documentation.',
      },
    ],
  });

  // 15 — Right of entry
  sections.push({
    id: 'right-of-entry',
    title: 'Right of Entry',
    blocks: [
      {
        type: 'paragraph',
        text:
          'Host reserves the right to enter the property upon reasonable notice for maintenance, safety ' +
          'concerns, or to address violations of this Agreement. For any non-urgent access, Host will ' +
          'coordinate timing with Guest in advance. In the event of an emergency, Host may enter without ' +
          'prior notice.',
      },
    ],
  });

  // 16 — Chargebacks
  sections.push({
    id: 'chargebacks',
    title: 'Chargebacks & Disputes',
    blocks: [
      {
        type: 'paragraph',
        text:
          'Guest agrees that all charges are authorized and agrees to contact Host directly to resolve any ' +
          'concerns prior to initiating a chargeback or payment dispute. Initiating a chargeback without first ' +
          'attempting resolution constitutes a breach of this Agreement, and Guest agrees to be responsible for ' +
          'reasonable administrative costs incurred by Host in responding to unauthorized disputes. This ' +
          'Agreement and all booking records may be used as evidence in any dispute.',
      },
    ],
  });

  // 17 — Limitation of liability
  sections.push({
    id: 'liability',
    title: 'Limitation of Liability',
    blocks: [
      {
        type: 'paragraph',
        text:
          'Host is not liable for events beyond reasonable control, including but not limited to weather ' +
          'events, power outages, service interruptions, or emergencies. Guest is encouraged to obtain travel ' +
          'insurance.',
      },
    ],
  });

  // 18 — Indemnification (names Rising Tide STR, LLC explicitly so the
  // brand-vs-entity distinction never weakens the clause)
  sections.push({
    id: 'indemnification',
    title: 'Indemnification',
    blocks: [
      {
        type: 'paragraph',
        text:
          "Guest agrees to indemnify and hold harmless Host and Rising Tide STR, LLC from any claims, damages, " +
          "losses, or liabilities arising from Guest's use of the property or breach of this Agreement.",
      },
    ],
  });

  // 19/20 — Mid-term protections (newest 3 South generation)
  if (mid) {
    sections.push({
      id: 'no-residency',
      title: 'No Residency / Mailing Address',
      blocks: [
        {
          type: 'paragraph',
          text:
            'Guest may not use the property address for residency, mailing purposes, voter registration, or ' +
            'establishing domicile.',
        },
      ],
    });
    sections.push({
      id: 'holdover',
      title: 'Holdover',
      blocks: [
        {
          type: 'paragraph',
          text:
            'Any occupancy beyond the agreed dates without written approval will be considered unauthorized and ' +
            'subject to a daily rate equal to 150% of the prorated nightly rate, plus any associated costs or ' +
            'legal fees incurred.',
        },
      ],
    });
  }

  // 21+ — Bespoke clauses, each its own numbered section
  for (const [i, clause] of (a.custom_clauses ?? []).entries()) {
    if (!clause.body?.trim()) continue;
    sections.push({
      id: `custom-${i}`,
      title: clause.title?.trim() || 'Additional Terms',
      blocks: clause.body
        .split(/\n{2,}/)
        .map((para) => ({ type: 'paragraph', text: para.trim() }) as AgreementBlock),
    });
  }

  // Tail — governing law + entire agreement
  sections.push({
    id: 'governing-law',
    title: 'Governing Law',
    blocks: [
      {
        type: 'paragraph',
        text: 'This Agreement shall be governed by the laws of the Commonwealth of Massachusetts.',
      },
    ],
  });
  sections.push({
    id: 'entire-agreement',
    title: 'Entire Agreement',
    blocks: [
      {
        type: 'paragraph',
        text:
          'This Agreement constitutes the entire understanding between Host and Guest and supersedes all prior ' +
          'discussions or representations.',
      },
    ],
  });

  return sections;
}
