/**
 * Property launch checklist.
 *
 * Defines the canonical list of steps a property goes through after the
 * prospect is promoted (src/app/projections/actions.ts > promoteToProperty)
 * but before it's truly "live" — i.e. before turnover SMS attributes, the
 * Guesty statement ingest matches it, owner statements can be cut, the
 * cleaners hear about its bookings, and the smart lock pages low battery.
 *
 * The DB (property_launch_steps) just persists state per (property_id,
 * step_key). The list itself lives here so it's typed, single-sourced, and
 * easy to extend as new integrations land in Helm.
 *
 * Adding a step: append an entry below. The launch page's backstop seed
 * (ensureLaunchStepsSeeded) fills the missing row on next load, so the new
 * step shows up as `todo` for every property mid-launch. Don't rename
 * existing keys — they're the join key to the audit rows in the DB.
 *
 * Every step carries `who`: the role that actually does the work. "Ops" is
 * the team working in Guesty, Airbnb, Stripe, Quo, Seam and the property
 * pages; "Systems" is code, Vercel env and the roster files that only a
 * Helm change can touch; "Owner" is the homeowner. The 2026-09 review found
 * the list unused in practice partly because nobody could tell which steps
 * were theirs, and which ones were quietly waiting on a code change.
 */

import {
  hasBankLast4,
  hasTaxCert,
  hasExternalTitle,
  hasGuestyListing,
  pricingIsFlowing,
  scaIsLive,
} from '@/lib/property-facts';

export type LaunchStepStatus = 'todo' | 'in_progress' | 'done' | 'skipped' | 'n_a';

export type LaunchStepPhase =
  | 'identity'
  | 'financial'
  | 'listing'
  | 'integrations'
  | 'owner'
  | 'launch';

export type LaunchStepWho = 'ops' | 'systems' | 'owner';

export const LAUNCH_WHO_LABELS: Record<LaunchStepWho, string> = {
  ops: 'Ops',
  systems: 'Systems',
  owner: 'Owner',
};

export type LaunchStep = {
  /** Stable DB key. Never rename. */
  key: string;
  /** Phase grouping for the UI. */
  phase: LaunchStepPhase;
  /** Display title. */
  title: string;
  /** Required steps block activation. Optional ones are nice-to-have. */
  required: boolean;
  /** Who does the work. See the module comment. */
  who: LaunchStepWho;
  /** True if promoteToProperty marks this done automatically. */
  auto?: boolean;
  /** True for the final activation gate (stamps activated_at, confirms is_active). */
  gate?: boolean;
  /** One-line description shown under the title. */
  description?: string;
  /** Why this matters — surfaced as a quiet caption when expanded. */
  why?: string;
  /** Optional inline example to anchor the operator (e.g. an external title). */
  example?: string;
  /**
   * UX hint: which deep-link or action the step's button should trigger.
   * The launch page maps these to existing surfaces (Quo, Seam, Guesty,
   * PriceLabs, edit page, AI generator, etc.). Steps without an action are
   * pure "I did it" checkboxes.
   */
  action?:
    | 'edit_field'              // generic: scroll the property edit page to the field
    | 'set_listing_match'       // inline editor for properties.listing_match
    | 'set_bank_last4'          // inline editor for properties.bank_last4
    | 'set_external_title'      // inline editor for properties.title
    | 'set_tax_cert'            // inline editor for properties.tax_cert_id
    | 'open_quo'                // jump to Quo cleaner mapping
    | 'open_seam'               // jump to Seam lock mapping
    | 'open_guesty_automations' // jump to Guesty's message-automation list
    | 'open_pricelabs'          // jump to PriceLabs
    | 'generate_copy'           // AI listing-copy generator
    | 'caption_photos'          // AI Guesty photo-caption tool
    | 'send_welcome'            // owner welcome / intake invite (property page)
    | 'activate';               // stamp activated_at + confirm is_active
};

export const LAUNCH_STEPS: ReadonlyArray<LaunchStep> = [
  // ── Identity ────────────────────────────────────────────────────────
  {
    key: 'property_created',
    phase: 'identity',
    title: 'Property record created',
    required: true,
    who: 'systems',
    auto: true,
    description: 'Auto-completed when the prospect was promoted.',
  },
  {
    key: 'owner_contact_confirmed',
    phase: 'identity',
    title: 'Owner contact verified',
    required: true,
    who: 'ops',
    description: 'Name, emails, phone, preferred channel, mailing address.',
    action: 'edit_field',
  },

  // ── Financial ───────────────────────────────────────────────────────
  {
    key: 'fee_and_terms',
    phase: 'financial',
    title: 'Management fee and payout terms set',
    required: true,
    who: 'ops',
    action: 'edit_field',
  },
  {
    key: 'bank_last4',
    phase: 'financial',
    title: 'Property bank account last4 entered',
    required: true,
    who: 'ops',
    why: 'Cleaning attribution matches Chase ACH charges to the property by last4.',
    action: 'set_bank_last4',
  },
  {
    key: 'stripe_auto_payouts',
    phase: 'financial',
    title: 'Stripe account set up with automatic payouts',
    required: true,
    who: 'systems',
    description:
      "In the property's own Stripe account: Settings > Payouts > payout schedule = Automatic. While you're in there, mint a restricted key and add it in Vercel as STRIPE_KEY_<PROPERTY_ID> (the per-property standard; the legacy STRIPE_KEYS_JSON blob is never reopened for new properties). Then use the account check below to confirm the key reaches the RIGHT account.",
    why: "Direct/SCA bookings charge into this account. Automatic payouts sweep funds to the property's bank account like the rest of the fleet; a manual schedule strands guest money in the Stripe balance.",
  },
  {
    key: 'airbnb_bank_linked',
    phase: 'financial',
    title: 'Property bank account linked in Airbnb',
    required: true,
    who: 'ops',
    description:
      "In Airbnb: Account > Payments & payouts > add the property's bank account as a payout method, then complete verification.",
    why: "Each property pays out to its own bank account. The routing rule below can't be created until Airbnb confirms the account.",
  },
  {
    key: 'airbnb_payout_routing',
    phase: 'financial',
    title: 'Airbnb payout routing rule created',
    required: true,
    who: 'ops',
    description:
      "Once the bank account is confirmed, add a payout routing rule in Airbnb assigning this listing's payouts to that account.",
    why: "Without a routing rule the property's earnings land in the default payout account and have to be untangled by hand.",
  },
  {
    key: 'tax_cert',
    phase: 'financial',
    title: 'MA short-term rental tax certificate recorded',
    required: false,
    who: 'ops',
    why: 'Required for MA properties; not applicable for out-of-state.',
    action: 'set_tax_cert',
  },
  {
    key: 'occupancy_tax_config',
    phase: 'financial',
    title: 'Occupancy tax rate agreed in Guesty, Helm, and Stay Cape Ann',
    required: true,
    who: 'systems',
    description:
      'Decide whether this home owes the 3% Community Impact Fee on top of the 11.7% base (Dotti decides; it is per property, never inferred from a folio). Set the Guesty listing tax config to match. If the CIF applies, it also has to be recorded in Helm (src/lib/occupancy-tax.ts, keyed by property id) and in stay-cape-ann (lib/occupancyTax.ts, keyed by Guesty listing id). A plain 11.7% home needs the Guesty config only.',
    why: 'Helm cannot read the listing tax config, so this is a hand tick. When the three disagree, either the state is under-filed by 3% or over-collected tax is paid to the owner as rent (the 79 Main July bug). 17 Beach billed the CIF for a year without owing it.',
  },

  // ── Listing ─────────────────────────────────────────────────────────
  {
    key: 'external_title',
    phase: 'listing',
    title: 'External listing title chosen',
    required: true,
    who: 'ops',
    example: 'Stay at Rocky Neck',
    action: 'set_external_title',
  },
  {
    key: 'listing_copy',
    phase: 'listing',
    title: 'Listing copy drafted',
    required: true,
    who: 'ops',
    description: 'Helm drafts from the property\'s onboarding data; you edit and finalize. The owner doesn\'t sign off on listing copy.',
    action: 'generate_copy',
  },
  {
    key: 'photo_pack',
    phase: 'listing',
    title: 'Photo pack delivered',
    required: true,
    who: 'ops',
    description: 'Photos archived to Drive (Marketing > Photographs and Video > the internal-name folder) and uploaded to the Guesty listing.',
  },
  {
    key: 'photo_captions',
    phase: 'listing',
    title: 'Photo captions written in Guesty',
    required: false,
    who: 'ops',
    description: 'AI-draft a caption for every gallery photo in our existing listings’ voice, then push them to Guesty.',
    why: 'Captioned photos read as a curated gallery on Airbnb / VRBO and lift conversion.',
    action: 'caption_photos',
  },
  {
    key: 'airbnb_live',
    phase: 'listing',
    title: 'Airbnb listing published',
    required: true,
    who: 'ops',
  },
  {
    key: 'vrbo_live',
    phase: 'listing',
    title: 'VRBO listing published',
    required: false,
    who: 'ops',
  },
  {
    key: 'sca_page_live',
    phase: 'listing',
    title: 'stay-cape-ann.com page live',
    required: false,
    who: 'ops',
    why: 'Only for Cape Ann properties.',
  },
  {
    key: 'pricing_flowing',
    phase: 'listing',
    title: 'Dynamic pricing flowing from PriceLabs',
    required: true,
    who: 'ops',
    description:
      'Map the new Guesty listing in PriceLabs and turn on sync. Helm ticks this itself once the next 60 days of the calendar mirror show two or more distinct nightly prices.',
    why: 'A flat single price on every forward night is the Guesty base rate, which means PriceLabs is not pushing and every channel (Airbnb, VRBO, Stay Cape Ann) is underpriced. 3 Windward launched that way at a flat $1,000.',
    action: 'open_pricelabs',
  },
  {
    key: 'guesty_listing_match',
    phase: 'listing',
    title: 'Guesty listing-match substring verified',
    required: true,
    who: 'ops',
    why: 'Every Guesty sync (reservations, calendar, bookings) matches the listing to this property by the listing_match needle; the statement ingest matches PDF rows the same way. 4 Middle Road was invisible to all of Helm for two months while every sync reported ok.',
    action: 'set_listing_match',
  },

  // ── Integrations ────────────────────────────────────────────────────
  {
    key: 'quo_cleaner_mapped',
    phase: 'integrations',
    title: 'Cleaner phone mapped in Quo',
    required: true,
    who: 'ops',
    description:
      'Cape Ann homes are covered: Rosa and Nina ride catch-all cleaner_phones rows that serve every property. An out-of-region home needs its own cleaner row with this property id.',
    why: 'Without this, turnover SMS will not attribute to this property.',
    action: 'open_quo',
  },
  {
    key: 'guesty_cleaning_automation',
    phase: 'integrations',
    title: 'Added to the Guesty cleaning-updates automation',
    required: true,
    who: 'ops',
    description:
      'In Guesty: Operations > Front desk > Message automation. Open "Cleaning updates - Rosa" (Cape Ann homes; an out-of-region home goes on its own cleaner\'s automation, e.g. "Cleaning updates - Luana" for 65 Calderwood), add this listing under Properties, and apply the change. Confirm the Properties chip count went up by one.',
    why: 'That automation is what texts the cleaners at booking confirmation, and it only fires for listings on its list. A home left off it takes bookings silently. Guesty exposes no API for automations, so Helm cannot check this one; it is a hand tick, and the onboarding board flags it while bookings are landing.',
    action: 'open_guesty_automations',
  },
  {
    key: 'code_roster_entry',
    phase: 'integrations',
    title: 'Listed in Helm\'s code roster (src/lib/properties.ts)',
    required: true,
    who: 'systems',
    description:
      'Ask for the entry: id, internal name, address, owner names, emails, fee, bank last4, listing_match, tax cert. Helm ticks this itself once the entry ships.',
    why: 'The DB row drives statements, syncs and the cleaner schedule, but /book/<id> and the code-side fallbacks still read this roster. 36 Granite, 16 Waterman, 79 Main and 4 Middle went live without an entry.',
  },
  {
    key: 'seam_lock_paired',
    phase: 'integrations',
    title: 'Smart lock paired in Seam',
    required: false,
    who: 'ops',
    description: 'Connect the lock in Seam, press Sync Seam devices on the property page, map the device to this property. The nightly sync then programs the cleaner (2222), maintenance (3333) and creative (5555) codes.',
    why: 'Enables battery alerts, auto-opened maintenance slips, "Cleaner in" on the turnover rail, and guest door codes. Helm ticks this itself once a lock is mapped.',
    action: 'open_seam',
  },
  {
    key: 'cape_ann_invoice_route',
    phase: 'integrations',
    title: 'Cleaning invoices route to this property',
    required: false,
    who: 'ops',
    description: 'Cape Ann Elite invoices match by the property name and address on the record. Only an odd spelling (an abbreviation, a sub-unit) needs an explicit invoice_match entry on the property.',
    why: 'Cape Ann properties only. Out-of-state cleaners are handled separately. Helm ticks this itself once the registry yields a needle for this property.',
  },

  // ── Owner ───────────────────────────────────────────────────────────
  {
    key: 'owner_welcome',
    phase: 'owner',
    title: 'Owner welcome email sent',
    required: true,
    who: 'ops',
    description: 'The intake invite goes out from the property page (Send onboarding form). The welcome note itself, covering the monthly rhythm (statements in the first business days, funds the first Monday), is a plain email for now.',
    action: 'send_welcome',
  },
  {
    key: 'statement_template',
    phase: 'owner',
    title: 'Owner statement template chosen',
    required: true,
    who: 'ops',
    description: 'Template 1 (standard monthly), 2 (monthly with a touch-base ask) or 3 (year-end recap). See Playbook > Send monthly owner statements.',
  },

  // ── Launch gate ─────────────────────────────────────────────────────
  {
    key: 'activated',
    phase: 'launch',
    title: 'Property activated',
    required: true,
    who: 'ops',
    gate: true,
    description: 'Stamps the go-live date (activated_at) that the revenue and forecast models read, and confirms is_active. Unlocks once every required step above is resolved.',
    why: 'Before this existed, promotion set is_active on day one and nothing ever wrote activated_at, so the forecast could not tell a home\'s first month.',
    action: 'activate',
  },
] as const;

export const LAUNCH_PHASES: ReadonlyArray<{ key: LaunchStepPhase; label: string; blurb: string }> = [
  { key: 'identity', label: 'Identity', blurb: 'Who owns it, what it is.' },
  { key: 'financial', label: 'Financial', blurb: 'Fee, payout, bank, Stripe, tax.' },
  { key: 'listing', label: 'Listing', blurb: 'Copy, photos, pricing, channels live.' },
  { key: 'integrations', label: 'Integrations', blurb: 'Cleaners, Guesty automation, Seam, invoices, the code roster.' },
  { key: 'owner', label: 'Owner-facing', blurb: 'Welcome, statement template.' },
  { key: 'launch', label: 'Launch', blurb: 'Stamp the go-live date.' },
];

/** A step's resolved-status (any of done | skipped | n_a). */
export function isStepResolved(status: LaunchStepStatus | undefined | null): boolean {
  return status === 'done' || status === 'skipped' || status === 'n_a';
}

/**
 * Context for auto-deriving a step's resolved state from data already on
 * the property + adjacent tables. src/lib/launch-context.ts assembles it
 * (one loader, shared by the launch page, the property page chip and the
 * onboarding board) so the checklist stops asking the operator to do work
 * that's demonstrably already done.
 *
 * Manual operator-set status (done / skipped / n_a / in_progress) always
 * wins over derivation — the operator's choice is the source of truth
 * once they touch a row. Derivation only fires on rows still in `todo`.
 */
export type LaunchDerivationContext = {
  /** Read-only subset of public.properties for the current row. */
  property: {
    title: string | null;
    owner_full: string | null;
    owner_emails: string[] | null;
    owner_phone: string | null;
    management_fee_pct: number | null;
    bank_last4: string | null;
    tax_cert_id: string | null;
    guesty_listing_id: string | null;
    is_active: boolean;
    activated_at: string | null;
  };
  /** Latest sca_launches.status for this property, or null if no row. */
  scaLaunchStatus: string | null;
  /** True if any cleaner_phones row has this property in its property_ids,
   *  or has an empty property_ids array (catch-all cleaner). */
  hasQuoCleanerMapping: boolean;
  /** lock_devices rows mapped to this property. */
  locksMapped: number;
  /** Distinct non-null nightly prices over the next 60 days of the Guesty
   *  calendar mirror. 1 = flat base rate (PriceLabs not pushing); 2+ = real
   *  rate variation is flowing. */
  forwardDistinctPrices: number;
  /** A confirmed, non-duplicate booking has already checked in. */
  firstStayStarted: boolean;
  /** The invoice registry yields at least one needle for this property. */
  invoiceNeedleMapped: boolean;
  /** src/lib/properties.ts PROPERTIES carries this id. */
  inCodeRoster: boolean;
};

/**
 * Returns true if this step's underlying data is already populated and
 * the step should render as auto-resolved. Per-step rules; everything not
 * listed returns false (the operator has to tick it manually).
 */
export function deriveStepResolved(
  stepKey: string,
  ctx: LaunchDerivationContext,
): boolean {
  const p = ctx.property;
  switch (stepKey) {
    case 'property_created':
      // Promotion always creates the property row; this is the seed-time
      // auto-done flag but we re-derive too for completeness.
      return true;
    case 'owner_contact_confirmed':
      // Promotion copies owner_full + owner_emails + owner_phone from the
      // prospect's onboarding answers; once all three are present the
      // contact's been verified for our purposes.
      return (
        !!p.owner_full?.trim() &&
        (p.owner_emails?.length ?? 0) > 0 &&
        !!p.owner_phone?.trim()
      );
    case 'fee_and_terms':
      // Promotion sets management_fee_pct from the prospect's mgmt_fee_pct.
      // Anything > 0 means the terms were committed.
      return (p.management_fee_pct ?? 0) > 0;
    case 'bank_last4':
      return hasBankLast4(p);
    case 'tax_cert':
      return hasTaxCert(p);
    case 'external_title':
      return hasExternalTitle(p);
    case 'guesty_listing_match':
      // The hard signal is a real Guesty listing_id on the row; the legacy
      // substring (lib/properties.ts > listing_match) is a fallback.
      return hasGuestyListing(p);
    case 'sca_page_live':
      return scaIsLive(ctx.scaLaunchStatus);
    case 'pricing_flowing':
      return pricingIsFlowing(ctx.forwardDistinctPrices);
    case 'quo_cleaner_mapped':
      return ctx.hasQuoCleanerMapping;
    case 'seam_lock_paired':
      return ctx.locksMapped > 0;
    case 'cape_ann_invoice_route':
      return ctx.invoiceNeedleMapped;
    case 'code_roster_entry':
      return ctx.inCodeRoster;
    case 'activated':
      // The stamped go-live date is the real signal. A home whose first
      // guest has already checked in is live whether or not anyone pressed
      // the button; the gate then reads as resolved and the button stays
      // available to backfill the date.
      return !!p.activated_at || ctx.firstStayStarted;
    // listing_copy, photo_pack, airbnb_live, vrbo_live, occupancy_tax_config,
    // guesty_cleaning_automation, owner_welcome, statement_template — no DB
    // signal, operator-driven.
    default:
      return false;
  }
}

export type LaunchStepRow = {
  id: string;
  property_id: string;
  step_key: string;
  status: LaunchStepStatus;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type LaunchProgressRow = {
  property_id: string;
  done_count: number;
  total_count: number;
  is_complete: boolean;
};

/** The minimal row shape the resolvers need; full rows satisfy it too. */
export type LaunchStepStatusRow = Pick<LaunchStepRow, 'step_key' | 'status'> & Partial<LaunchStepRow>;

/** One step with its effective state: the DB row, the operator's status,
 *  and whether derivation resolved it on the operator's behalf. */
export type EffectiveLaunchStep = {
  step: LaunchStep;
  row: LaunchStepStatusRow | null;
  /** Effective status: the row's status, bumped to 'done' when derived. */
  status: LaunchStepStatus;
  resolved: boolean;
  /** True when the row was still todo and data resolved it. */
  auto: boolean;
};

/**
 * Single source of truth for "what state is each step in". Manual status
 * wins; derivation only lifts rows still in todo (or missing). Every
 * surface (launch page, property chip, onboarding board) goes through this
 * so no two counts can disagree (the 1/18-vs-5/18 mismatch on 2026-06-15
 * came from the chip counting only persisted rows).
 */
export function resolveLaunchSteps(
  rows: ReadonlyArray<LaunchStepStatusRow>,
  ctx: LaunchDerivationContext,
): EffectiveLaunchStep[] {
  const byKey = new Map(rows.map((r) => [r.step_key, r]));
  return LAUNCH_STEPS.map((step) => {
    const row = byKey.get(step.key) ?? null;
    const manual: LaunchStepStatus = row?.status ?? 'todo';
    if (isStepResolved(manual)) {
      return { step, row, status: manual, resolved: true, auto: false };
    }
    if (manual === 'todo' && deriveStepResolved(step.key, ctx)) {
      return { step, row, status: 'done', resolved: true, auto: true };
    }
    return { step, row, status: manual, resolved: false, auto: false };
  });
}

export type LaunchSummary = {
  done: number;
  total: number;
  allDone: boolean;
  /** Required, non-gate steps still open. */
  requiredRemaining: number;
  /** The first open required step in checklist order (the gate last), or
   *  null when everything required is resolved. */
  next: LaunchStep | null;
  /** The gate step is resolved: the home is live. */
  live: boolean;
  /** Every required non-gate step is resolved, so the gate can be pressed. */
  canActivate: boolean;
};

export function summarizeLaunch(effective: ReadonlyArray<EffectiveLaunchStep>): LaunchSummary {
  const total = effective.length;
  let done = 0;
  let requiredRemaining = 0;
  let next: LaunchStep | null = null;
  let gateOpen: LaunchStep | null = null;
  let live = true;
  for (const e of effective) {
    if (e.resolved) done += 1;
    if (e.step.gate) {
      live = e.resolved;
      if (!e.resolved) gateOpen = e.step;
      continue;
    }
    if (e.step.required && !e.resolved) {
      requiredRemaining += 1;
      if (!next) next = e.step;
    }
  }
  const canActivate = requiredRemaining === 0;
  if (!next && gateOpen) next = gateOpen;
  return { done, total, allDone: done >= total, requiredRemaining, next, live, canActivate };
}

/**
 * Back-compat wrapper: the count the property page chip shows. Same
 * resolver as everything else.
 */
export function computeLaunchProgress(
  rows: ReadonlyArray<LaunchStepStatusRow>,
  ctx: LaunchDerivationContext,
): { done: number; total: number; allDone: boolean } {
  const s = summarizeLaunch(resolveLaunchSteps(rows, ctx));
  return { done: s.done, total: s.total, allDone: s.allDone };
}

/**
 * The initial seed payload for a property's launch checklist. One row per
 * canonical step. `property_created` is pre-completed because by the time
 * this is called the property already exists. The caller (promoteToProperty)
 * is responsible for the insert.
 */
export function buildInitialLaunchSteps(propertyId: string, completedBy: string | null): Array<{
  property_id: string;
  step_key: string;
  status: LaunchStepStatus;
  completed_at: string | null;
  completed_by: string | null;
}> {
  const now = new Date().toISOString();
  return LAUNCH_STEPS.map((step) => {
    const isAutoDone = !!step.auto;
    return {
      property_id: propertyId,
      step_key: step.key,
      status: isAutoDone ? 'done' : 'todo',
      completed_at: isAutoDone ? now : null,
      completed_by: isAutoDone ? completedBy : null,
    };
  });
}
