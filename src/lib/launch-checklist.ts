/**
 * Property launch checklist.
 *
 * Defines the canonical list of steps a property goes through after the
 * prospect is promoted (src/app/projections/actions.ts > promoteToProperty)
 * but before it's truly "live" — i.e. before turnover SMS attributes, the
 * Guesty statement ingest matches it, owner statements can be cut, and the
 * smart lock pages low battery.
 *
 * The DB (property_launch_steps) just persists state per (property_id,
 * step_key). The list itself lives here so it's typed, single-sourced, and
 * easy to extend as new integrations land in Helm.
 *
 * Adding a step: append an entry below, then on next promote-to-property
 * (or via the "Re-seed checklist" path if we add one later) the new step
 * shows up as `todo` on the launch page. Don't rename existing keys —
 * they're the join key to the audit rows in the DB.
 */

export type LaunchStepStatus = 'todo' | 'in_progress' | 'done' | 'skipped' | 'n_a';

export type LaunchStepPhase =
  | 'identity'
  | 'financial'
  | 'listing'
  | 'integrations'
  | 'owner'
  | 'launch';

export type LaunchStep = {
  /** Stable DB key. Never rename. */
  key: string;
  /** Phase grouping for the UI. */
  phase: LaunchStepPhase;
  /** Display title. */
  title: string;
  /** Required steps block activation. Optional ones are nice-to-have. */
  required: boolean;
  /** True if promoteToProperty marks this done automatically. */
  auto?: boolean;
  /** True for the final activation gate (flips properties.is_active). */
  gate?: boolean;
  /** One-line description shown under the title. */
  description?: string;
  /** Why this matters — surfaced as a quiet caption when expanded. */
  why?: string;
  /** Optional inline example to anchor the operator (e.g. an external title). */
  example?: string;
  /**
   * UX hint: which deep-link or action the step's button should trigger.
   * The launch page maps these to existing surfaces (Quo, Seam, edit page,
   * AI generator, etc.). Steps without an action are pure "I did it"
   * checkboxes.
   */
  action?:
    | 'edit_field'         // generic: scroll the property edit page to the field
    | 'set_listing_match'  // inline editor for properties.listing_match
    | 'set_bank_last4'     // inline editor for properties.bank_last4
    | 'set_external_title' // inline editor for properties.title
    | 'set_tax_cert'       // inline editor for properties.tax_cert_id
    | 'open_quo'           // jump to Quo cleaner mapping
    | 'open_seam'          // jump to Seam lock mapping
    | 'generate_copy'      // AI listing-copy generator
    | 'send_welcome'       // owner welcome email
    | 'activate';          // flip is_active = true
};

export const LAUNCH_STEPS: ReadonlyArray<LaunchStep> = [
  // ── Identity ────────────────────────────────────────────────────────
  {
    key: 'property_created',
    phase: 'identity',
    title: 'Property record created',
    required: true,
    auto: true,
    description: 'Auto-completed when the prospect was promoted.',
  },
  {
    key: 'owner_contact_confirmed',
    phase: 'identity',
    title: 'Owner contact verified',
    required: true,
    description: 'Name, emails, phone, preferred channel, mailing address.',
    action: 'edit_field',
  },

  // ── Financial ───────────────────────────────────────────────────────
  {
    key: 'fee_and_terms',
    phase: 'financial',
    title: 'Management fee and payout terms set',
    required: true,
    action: 'edit_field',
  },
  {
    key: 'bank_last4',
    phase: 'financial',
    title: 'Property bank account last4 entered',
    required: true,
    why: 'Cleaning attribution matches Chase ACH charges to the property by last4.',
    action: 'set_bank_last4',
  },
  {
    key: 'tax_cert',
    phase: 'financial',
    title: 'MA short-term rental tax certificate recorded',
    required: false,
    why: 'Required for MA properties; not applicable for out-of-state.',
    action: 'set_tax_cert',
  },

  // ── Listing ─────────────────────────────────────────────────────────
  {
    key: 'external_title',
    phase: 'listing',
    title: 'External listing title chosen',
    required: true,
    example: 'Stay at Rocky Neck',
    action: 'set_external_title',
  },
  {
    key: 'listing_copy',
    phase: 'listing',
    title: 'Listing copy drafted and owner-approved',
    required: true,
    description: 'Helm drafts from the property\'s onboarding data; you edit and the owner signs off.',
    action: 'generate_copy',
  },
  {
    key: 'photo_pack',
    phase: 'listing',
    title: 'Photo pack delivered',
    required: true,
  },
  {
    key: 'airbnb_live',
    phase: 'listing',
    title: 'Airbnb listing published',
    required: true,
  },
  {
    key: 'vrbo_live',
    phase: 'listing',
    title: 'VRBO listing published',
    required: false,
  },
  {
    key: 'sca_page_live',
    phase: 'listing',
    title: 'stay-cape-ann.com page live',
    required: false,
    why: 'Only for Cape Ann properties.',
  },
  {
    key: 'guesty_listing_match',
    phase: 'listing',
    title: 'Guesty listing-match substring verified',
    required: true,
    why: 'Statement ingest matches Guesty PDF rows by lib/properties.ts listing_match.',
    action: 'set_listing_match',
  },

  // ── Integrations ────────────────────────────────────────────────────
  {
    key: 'quo_cleaner_mapped',
    phase: 'integrations',
    title: 'Cleaner phone mapped in Quo',
    required: true,
    why: 'Without this, turnover SMS will not attribute to this property.',
    action: 'open_quo',
  },
  {
    key: 'seam_lock_paired',
    phase: 'integrations',
    title: 'Smart lock paired in Seam',
    required: false,
    why: 'Enables battery alerts and auto-opened maintenance slips.',
    action: 'open_seam',
  },
  {
    key: 'cape_ann_invoice_route',
    phase: 'integrations',
    title: 'Cape Ann Elite invoice routing confirmed',
    required: false,
    why: 'Cape Ann properties only. Out-of-state cleaners are handled separately.',
  },

  // ── Owner ───────────────────────────────────────────────────────────
  {
    key: 'owner_welcome',
    phase: 'owner',
    title: 'Owner welcome email sent',
    required: true,
    action: 'send_welcome',
  },
  {
    key: 'statement_template',
    phase: 'owner',
    title: 'Owner statement template chosen',
    required: true,
    description: 'Template 1, 2, or 3 (see CLAUDE.md > Owner statement send process).',
  },

  // ── Launch gate ─────────────────────────────────────────────────────
  {
    key: 'activated',
    phase: 'launch',
    title: 'Property activated',
    required: true,
    gate: true,
    description: 'Flips properties.is_active = true. The property starts appearing in Statements + Operations.',
    action: 'activate',
  },
] as const;

export const LAUNCH_PHASES: ReadonlyArray<{ key: LaunchStepPhase; label: string; blurb: string }> = [
  { key: 'identity', label: 'Identity', blurb: 'Who owns it, what it is.' },
  { key: 'financial', label: 'Financial', blurb: 'Fee, payout, bank, tax.' },
  { key: 'listing', label: 'Listing', blurb: 'Copy, photos, channels live.' },
  { key: 'integrations', label: 'Integrations', blurb: 'Quo, Seam, invoice routing.' },
  { key: 'owner', label: 'Owner-facing', blurb: 'Welcome, statement template.' },
  { key: 'launch', label: 'Launch', blurb: 'Flip the switch.' },
];

/** A step's resolved-status (any of done | skipped | n_a). */
export function isStepResolved(status: LaunchStepStatus | undefined | null): boolean {
  return status === 'done' || status === 'skipped' || status === 'n_a';
}

/**
 * Context for auto-deriving a step's resolved state from data already on
 * the property + adjacent tables. The launch page passes this in so the
 * checklist stops asking the operator to do work that's demonstrably
 * already done (e.g. fee + payout terms got set when the prospect was
 * promoted; bank_last4 was filled in via the edit page; SCA page is
 * live per sca_launches; cleaner is mapped in cleaner_phones).
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
  };
  /** Latest sca_launches.status for this property, or null if no row. */
  scaLaunchStatus: string | null;
  /** True if any cleaner_phones row has this property in its property_ids,
   *  or has an empty property_ids array (catch-all cleaner). */
  hasQuoCleanerMapping: boolean;
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
      return !!p.bank_last4 && p.bank_last4.length === 4;
    case 'tax_cert':
      return !!p.tax_cert_id?.trim();
    case 'external_title':
      return !!p.title?.trim();
    case 'guesty_listing_match':
      // The hard signal is a real Guesty listing_id on the row; the legacy
      // substring (lib/properties.ts > listing_match) is a fallback.
      return !!p.guesty_listing_id?.trim();
    case 'sca_page_live':
      return ctx.scaLaunchStatus === 'live';
    case 'quo_cleaner_mapped':
      return ctx.hasQuoCleanerMapping;
    case 'activated':
      return p.is_active === true;
    // listing_copy, photo_pack, airbnb_live, vrbo_live, seam_lock_paired,
    // cape_ann_invoice_route, owner_welcome, statement_template — no DB
    // signal yet, operator-driven.
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

/**
 * Computes whether the activation gate can be flipped: every REQUIRED non-gate
 * step is resolved. The gate step itself (key='activated') is not counted —
 * it's the action being unlocked, not a prerequisite for itself.
 */
export function canActivate(stepsByKey: Map<string, LaunchStepRow>): boolean {
  for (const def of LAUNCH_STEPS) {
    if (!def.required || def.gate) continue;
    const row = stepsByKey.get(def.key);
    if (!isStepResolved(row?.status)) return false;
  }
  return true;
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
