import type { HelmPropertyRow } from '@/lib/properties';

/**
 * Deep property-onboarding catalog.
 *
 * Every item that takes a home from "house on a lot" to a live, smooth-running
 * listing: the deal paperwork, the financial rails (Chase, Stripe, Guesty,
 * tax), compliance and safety, the room-by-room walkthrough, access and
 * connectivity, staffing, outfitting, listing setup, and the guest-experience
 * layer that answers questions before they're asked.
 *
 * Same architecture as the launch checklist (src/lib/launch-checklist.ts):
 * the catalog lives here in code so it stays typed and single-sourced, and
 * the DB (property_onboarding_items) only persists status rows per
 * (property_id, item key). A manual operator status always wins; `derive`
 * only auto-resolves items the operator hasn't touched, the same rule as
 * deriveStepResolved on the launch page. Items without a reliable data
 * signal have no derive and are plain checkboxes.
 *
 * Relationship to the launch checklist: the 19 launch steps are the go-live
 * gate and render separately as the final stage. Nothing in this catalog
 * duplicates a launch step; these items are the depth the launch list
 * doesn't have (the launch step says "bank_last4 entered", this catalog
 * covers opening the Chase account, wiring Stripe, and dry-running the
 * first statement).
 *
 * Adding an item: append it under its stage. Never rename a key once
 * shipped, keys are the join to the status rows in the DB. `href` supports
 * an {id} placeholder the renderer swaps for the property id.
 */

export type OnboardingStage =
  | 'owner_deal'
  | 'financial'
  | 'compliance'
  | 'physical'
  | 'access'
  | 'services'
  | 'inventory'
  | 'listing'
  | 'guest_experience';

export const ONBOARDING_STAGES: { id: OnboardingStage; title: string; blurb: string }[] = [
  {
    id: 'owner_deal',
    title: 'Owner & deal',
    blurb: 'The agreement, the reserve check, and what the owner told us about the home.',
  },
  {
    id: 'financial',
    title: 'Financial rails',
    blurb: 'Chase, Stripe, Guesty, and tax wiring so month one reconciles cleanly.',
  },
  {
    id: 'compliance',
    title: 'Compliance & safety',
    blurb: 'Permits, inspections, shutoffs, and disclosures on file before a guest sleeps here.',
  },
  {
    id: 'physical',
    title: 'The home, room by room',
    blurb: 'Walk the home and write down everything a guest or cleaner will ask about.',
  },
  {
    id: 'access',
    title: 'Access & connectivity',
    blurb: 'Codes, keys, wifi, and every way a person gets into the home.',
  },
  {
    id: 'services',
    title: 'Services & staffing',
    blurb: 'Cleaners, vendors, and the automations that keep turnovers moving.',
  },
  {
    id: 'inventory',
    title: 'Inventory & outfitting',
    blurb: 'Linens, supplies, and gear stocked to par before the first booking.',
  },
  {
    id: 'listing',
    title: 'Listing & channels',
    blurb: 'Pricing, policies, and channel plumbing beyond the go-live checklist.',
  },
  {
    id: 'guest_experience',
    title: 'Guest experience',
    blurb: 'Printed guides, a seeded KB, and the local knowledge that answers guests before they ask.',
  },
];

/**
 * Context for auto-deriving an item's done state from live data. The
 * onboarding page assembles this per property (rooms, notes, documents,
 * locks, climate, cleaner mapping, SCA status) so the catalog stops asking
 * for work that's demonstrably already done. Manual status rows always win;
 * derivation only fires on untouched items.
 */
export type OnboardingDeriveContext = {
  p: HelmPropertyRow;
  roomsCount: number;
  /** property_rooms rows with room_type='bedroom'. */
  bedroomsOnFile: number;
  /** Bedroom rooms that actually have beds listed, not just a row. */
  bedroomsWithBeds: number;
  /** Rooms whose details.quirks is non-empty. */
  roomsWithQuirks: number;
  /** guest_facing property_notes count. */
  guestFacingNotes: number;
  /** Internal property_notes count. */
  opsNotes: number;
  documentsCount: number;
  /** Seam locks mapped to this property. */
  locksMapped: number;
  climateConfigured: boolean;
  /** cleaner_phones row exists for this property. */
  cleanerMapped: boolean;
  scaLive: boolean;
};

export type OnboardingItem = {
  /** Stable, namespaced 'stage.slug'. Never rename once shipped. */
  key: string;
  stage: OnboardingStage;
  /** Short imperative. */
  title: string;
  /** One line, what done looks like. */
  description?: string;
  /** The concrete Helm or guest consequence of skipping it. */
  why?: string;
  /** Deep link; {id} is replaced with the property id. */
  href?: string;
  hrefLabel?: string;
  /** Auto-done from live data; a manual status row always wins. */
  derive?: (ctx: OnboardingDeriveContext) => boolean;
};

/** Non-empty string check shared by the derives. */
const has = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

export const ONBOARDING_ITEMS: OnboardingItem[] = [
  // ── Owner & deal ────────────────────────────────────────────────────
  {
    key: 'owner_deal.management_agreement_signed',
    stage: 'owner_deal',
    title: 'Management agreement signed',
    description: 'Signed agreement in hand, both parties dated.',
    why: 'Contract data lives on the projection and does not carry over at promote, so the signed copy is the record.',
    href: '/properties/{id}?tab=records',
    hrefLabel: 'Open records',
  },
  {
    key: 'owner_deal.contract_dates_logged',
    stage: 'owner_deal',
    title: 'Log contract start, term, and renewal',
    description: 'Start date, term length, and renewal terms noted where the team can find them.',
    why: 'No properties column holds agreement metadata. An unlogged renewal date is an invisible one.',
    href: '/properties/{id}?tab=records',
    hrefLabel: 'Open records',
  },
  {
    key: 'owner_deal.documents_filed',
    stage: 'owner_deal',
    title: 'File the core paper trail',
    description: 'Agreement, insurance dec page, permits, and W-9 uploaded to Documents.',
    why: 'One place to look when an owner, a city, or an accountant asks.',
    href: '/properties/{id}?tab=records',
    hrefLabel: 'Open records',
    derive: (ctx) => ctx.documentsCount > 0,
  },
  {
    key: 'owner_deal.owner_reserve_check',
    stage: 'owner_deal',
    title: 'Owner Reserve check received',
    description: 'The $2,000 minimum-balance check is in hand and deposited.',
    why: 'Policy: every new owner hands $2,000 at onboarding. If it never arrives, the operator has to withhold it from a payout via the statement checkbox instead.',
  },
  {
    key: 'owner_deal.intake_form_sent',
    stage: 'owner_deal',
    title: 'Send the owner intake form',
    description: 'Onboarding link generated and emailed to the owner.',
    why: 'The eight-section intake fills fifty-plus columns in one pass, wifi to shutoffs to the guest home guide.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
    derive: ({ p }) => has(p.onboarding_token),
  },
  {
    key: 'owner_deal.intake_form_submitted',
    stage: 'owner_deal',
    title: 'Owner intake form submitted',
    description: 'Owner completed and submitted the form.',
    why: 'Submission writes column by column into properties and property_access, and seeds the printed home guide.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
    derive: ({ p }) => has(p.onboarding_submitted_at),
  },
  {
    key: 'owner_deal.owners_structured',
    stage: 'owner_deal',
    title: 'Fill in the owner cards',
    description: 'Structured owner entries with a primary flag, roles, and per-person contact.',
    why: 'Owner messaging reads the structured cards, not the flat name fields.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
    derive: ({ p }) => (p.owners?.length ?? 0) > 0,
  },
  {
    key: 'owner_deal.statement_greeting',
    stage: 'owner_deal',
    title: 'Set the statement greeting',
    description: 'The "Hi ___," name that statements and emails open with.',
    why: 'Sends misaddress without it, and the fix always lands after an owner noticed.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.owner_greeting),
  },
  {
    key: 'owner_deal.statement_cc_list',
    stage: 'owner_deal',
    title: 'Confirm who receives statements',
    description: 'Owner emails plus any spouse, accountant, or partner CC confirmed.',
    why: 'Per-owner CC lists live in team memory, not data. Confirm now, not after a missed statement.',
  },
  {
    key: 'owner_deal.monthly_rhythm_walkthrough',
    stage: 'owner_deal',
    title: 'Walk the owner through the monthly rhythm',
    description: 'When statements land, how payouts move, who to email with questions.',
    why: 'Expectation-setting up front is cheaper than reconciliation threads later.',
  },
  {
    key: 'owner_deal.go_live_target',
    stage: 'owner_deal',
    title: 'Set a target go-live date',
    description: 'A date the team is working toward, shared with the owner.',
    why: 'activated_at records when launch happened. Nothing records when it was supposed to.',
  },

  // ── Financial rails ─────────────────────────────────────────────────
  {
    key: 'financial.chase_account_opened',
    stage: 'financial',
    title: 'Open the dedicated Chase account',
    description: 'One business checking account for this property alone, never shared.',
    why: 'Monthly Bank CSV ingest and Cape Ann Elite ACH cleaning charges attribute to the property by this account.',
    href: '/properties/{id}/edit#bank',
    hrefLabel: 'Edit field',
  },
  {
    key: 'financial.chase_signers_named',
    stage: 'financial',
    title: 'Settle Chase naming and signers',
    description: 'Account name convention and authorized signers decided.',
    why: 'Still an open Playbook TODO. Deciding it once beats re-deciding it per phone call with Chase.',
  },
  {
    key: 'financial.stripe_account_created',
    stage: 'financial',
    title: 'Create the property Stripe account',
    description: 'Independent Stripe account with the new Chase account linked as payout bank.',
    why: 'SCA direct bookings charge through the property\'s own Stripe so Guesty never takes a per-booking fee.',
  },
  {
    key: 'financial.stripe_restricted_key',
    stage: 'financial',
    title: 'Wire the property\'s Stripe key into Helm',
    description:
      'In the property\'s Stripe: Developers > API keys > Create restricted key, name it "Helm", exactly six permissions: ' +
      'Charges Read, Checkout Sessions Read, Balance Read, Payment Links Write, Products Write, Prices Write ' +
      '(Prices is its own row, Products does NOT cover it). Copy the rk_live key. ' +
      'In Vercel (rising-tide-statements > Environment Variables) ADD A NEW var named STRIPE_KEY_<PROPERTY_ID> ' +
      '(uppercased, e.g. STRIPE_KEY_19_RACKLIFFE), value = the bare key only, no JSON, no quotes. Never edit the old ' +
      'STRIPE_KEYS_JSON blobs. Redeploy. Verify: the payment-links diagnostic (or ask Claude to mint-and-kill a test link).',
    why:
      'Powers three things: statement extras sync (guest add-on charges appear in the statement review queue), ' +
      'installment fee cross-checks, and auto-minted add-on payment links in guest messaging. ' +
      'Never use the sk_ secret key - Helm refuses those by policy.',
  },
  {
    key: 'financial.stripe_linked_in_guesty',
    stage: 'financial',
    title: 'Link Stripe in Guesty',
    description: 'Payment wiring on the Guesty listing, for calendar and channel sync only.',
    why: 'SCA payments deliberately bypass Guesty. Guesty shows TOTAL_PAID = 0 for those stays and the amount-based matcher does the rest.',
  },
  {
    key: 'financial.sca_payment_wiring',
    stage: 'financial',
    title: 'Wire Stripe keys into staycapeann',
    description: 'Publishable key, secret, and webhook set in the SCA launch flow, then verified.',
    why: 'Helm never touches the Stripe secret. The book-probe stamps payment_verified_at when the wiring is right.',
    href: '/properties/{id}/stay-cape-ann',
    hrefLabel: 'Open SCA launch',
    derive: (ctx) => ctx.scaLive,
  },
  {
    key: 'financial.sca_test_booking',
    stage: 'financial',
    title: 'Test a direct booking end to end',
    description: 'Book on stay-cape-ann, pay, land in Guesty as Direct, match the Stripe charge.',
    why: 'The one test that proves Chase, Stripe, Guesty, and the ingest matcher all agree before a real guest pays.',
    href: '/properties/{id}/stay-cape-ann',
    hrefLabel: 'Open SCA launch',
    derive: (ctx) => ctx.scaLive,
  },
  {
    key: 'financial.guesty_business_model',
    stage: 'financial',
    title: 'Configure the Guesty Business model',
    description: 'Business model set on the listing so accounting fields populate.',
    why: 'Reservations missing it never get OWNER NET REVENUE, and the monthly statement silently misses those stays.',
  },
  {
    key: 'financial.masstax_registration',
    stage: 'financial',
    title: 'Register on MassTaxConnect',
    description: 'Room occupancy tax account open for this property.',
    why: 'The cert ID recording is the launch step. The registration behind it starts here, and only covers channels that do not remit for us.',
  },
  {
    key: 'financial.cleaning_cost_estimate',
    stage: 'financial',
    title: 'Set the cleaning cost estimate',
    description: 'Expected per-turn cleaning cost on the property record.',
    why: 'Revenue snapshots and forecasts fall back to this number until real cleanings land.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => p.cleaning_cost_estimate != null,
  },
  {
    key: 'financial.first_statement_dry_run',
    stage: 'financial',
    title: 'Dry-run the month-one statement inputs',
    description: 'Guesty PDF, platform CSV, and bank CSV all pull cleanly for this property.',
    why: 'A missing listing match or bank feed should surface in a dry run, not on the first owner send.',
  },

  // ── Compliance & safety ─────────────────────────────────────────────
  {
    key: 'compliance.str_permit',
    stage: 'compliance',
    title: 'Record the local STR permit',
    description: 'City registration ID on the property record.',
    why: 'Gloucester\'s Information Note must show the registration ID.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.str_registration_id),
  },
  {
    key: 'compliance.permit_expiry',
    stage: 'compliance',
    title: 'Log the permit expiry',
    description: 'Permit expiration date on file.',
    why: 'The column is free text with no renewal reminder pipeline. The date on file is the only warning we get.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.str_permit_expires),
  },
  {
    key: 'compliance.insurance_on_file',
    stage: 'compliance',
    title: 'STR insurance on file',
    description: 'Carrier recorded, policy number and expiry noted in Documents.',
    why: 'Helm stores carrier only, so the dec page in Documents carries the detail.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.str_insurance_carrier),
  },
  {
    key: 'compliance.smoke_co_cert',
    stage: 'compliance',
    title: 'Pass the MA 26F smoke and CO inspection',
    description: 'Fire department inspection done, certificate filed in Documents.',
    why: 'A Massachusetts rental requirement with a paper certificate. No Helm column tracks it, so the Documents panel is the record.',
    href: '/properties/{id}?tab=records',
    hrefLabel: 'Open records',
  },
  {
    key: 'compliance.smoke_detectors_mapped',
    stage: 'compliance',
    title: 'Map smoke detector locations',
    description: 'Every detector located and listed.',
    why: 'An Information Note field, and guests ask: 73 Rocky Neck wanted battery location and silencing steps mid-stay.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.smoke_detector_locations),
  },
  {
    key: 'compliance.fire_extinguishers',
    stage: 'compliance',
    title: 'Record fire extinguisher locations',
    description: 'Every extinguisher located and listed.',
    why: 'An Information Note field, and the thing you want found fast.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.fire_extinguisher_locations),
  },
  {
    key: 'compliance.fire_exits',
    stage: 'compliance',
    title: 'Record fire exit routes',
    description: 'Exit paths from every floor written down.',
    why: 'Required on the Information Note for the Gloucester permit.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.fire_exit_locations),
  },
  {
    key: 'compliance.gas_shutoff',
    stage: 'compliance',
    title: 'Record the gas shutoff location',
    description: 'Exact location, photographed if it helps.',
    why: 'Contractors ask for shutoffs and the panel more than anything else on site.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.gas_shutoff_location),
  },
  {
    key: 'compliance.water_shutoff',
    stage: 'compliance',
    title: 'Record the water shutoff location',
    description: 'Main shutoff located and written down.',
    why: 'Tub valves and sink cabinets leak in real guest threads. The shutoff is the first question every time.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.water_shutoff_location),
  },
  {
    key: 'compliance.electrical_panel',
    stage: 'compliance',
    title: 'Record the electrical panel location',
    description: 'Panel located, breakers labeled if possible.',
    why: '4 Brier Neck\'s gap list literally reads "electrical panel location for technician reference".',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.electrical_panel_location),
  },
  {
    key: 'compliance.septic_or_sewer',
    stage: 'compliance',
    title: 'Note septic or sewer',
    description: 'Which system the home is on, plus any disposal rules for guests.',
    why: 'Septic homes need flushing and disposal warnings in the guest guide. Today that lives only in guide prose, if anywhere.',
  },
  {
    key: 'compliance.camera_disclosure',
    stage: 'compliance',
    title: 'Disclose security cameras in the listing',
    description: 'Cameras on file in Helm and declared on every live channel.',
    why: 'Undisclosed exterior cameras are a delisting risk on Airbnb. Helm holds the on-file half; the listing text is on you.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.security_cameras),
  },
  {
    key: 'compliance.info_note_posted',
    stage: 'compliance',
    title: 'Print and post the Information Note',
    description: 'The permit placard printed and hung in the home.',
    why: 'Gloucester requires it posted. The page flags any of its six required fields still empty.',
    href: '/properties/{id}?tab=records',
    hrefLabel: 'Open info note',
  },

  // ── The home, room by room ──────────────────────────────────────────
  {
    key: 'physical.walkthrough_rooms',
    stage: 'physical',
    title: 'Walk every room onto the record',
    description: 'A property_rooms row per real room, named and ordered.',
    why: 'Room records feed the inspection card, SCA sleeping arrangements, and every "which room has" answer.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
    derive: (ctx) => ctx.roomsCount > 0,
  },
  {
    key: 'physical.bedrooms_with_beds',
    stage: 'physical',
    title: 'Every bedroom on file with bed sizes',
    description: 'One bedroom room per real bedroom, each with its beds listed.',
    why: 'Guests ask bed sizes per room, and 21 Horton carried contradictory pull-out-couch answers for months.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
    derive: (ctx) => ctx.bedroomsWithBeds >= (ctx.p.bedrooms ?? 1),
  },
  {
    key: 'physical.bathrooms_fixtures',
    stage: 'physical',
    title: 'Bathrooms on file with fixture types',
    description: 'Tub versus walk-in shower noted per bathroom.',
    why: '"Which bathroom has a walk-in shower" is a recurring mobility question. The photo-derived room guide exists because of it.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
  },
  {
    key: 'physical.quirks_captured',
    stage: 'physical',
    title: 'Capture quirks on the walkthrough',
    description: 'Every oddity written onto its room: sticky doors, tricky valves, mode quirks.',
    why: 'The 20 Enon "set AUX, not heat" thermostat quirk recurred across multiple guest threads before it was written down.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
    derive: (ctx) => ctx.roomsWithQuirks > 0,
  },
  {
    key: 'physical.fireplace_decided',
    stage: 'physical',
    title: 'Fireplace: usable or decorative, decided',
    description: 'One written answer, owner-confirmed, including any seasonal shutoff.',
    why: 'Two homes, 30 Woodward and 65 Calderwood, gave guests conflicting answers.',
  },
  {
    key: 'physical.heating_cooling',
    stage: 'physical',
    title: 'Document heating and cooling',
    description: 'Systems, zones, thermostat locations, and operating quirks.',
    why: '"Which bedrooms have which AC units" went unanswered at 3 Locust. Window units versus mini-splits matters in July.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.heating) && has(p.cooling),
  },
  {
    key: 'physical.laundry_documented',
    stage: 'physical',
    title: 'Document the laundry setup',
    description: 'In-unit or not, where, detergent, and cycle tips.',
    why: 'Missing at four homes (20 Hammond, 4 Brier Neck, 53 Rocky Neck, 3 South) and guests ask.',
  },
  {
    key: 'physical.kitchen_appliances',
    stage: 'physical',
    title: 'Document kitchen appliances',
    description: 'Coffee maker model and pod type, oven and dishwasher quirks, filtered water.',
    why: 'The coffee maker question alone hit four-plus properties.',
  },
  {
    key: 'physical.tv_streaming',
    stage: 'physical',
    title: 'Document TVs and streaming',
    description: 'TV count, how to turn each on, whose accounts, app PINs.',
    why: 'The 20 Enon Peacock PIN stayed unresolved through a guest stay. Streaming logins were missing in four KBs.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => p.num_tvs != null && has(p.smart_tv),
  },
  {
    key: 'physical.grill_propane',
    stage: 'physical',
    title: 'Grill, propane, and the spare tank',
    description: 'Grill type, tank location, and where the spare lives.',
    why: 'An empty tank on a Saturday is a guest complaint. A noted spare is a one-line answer.',
  },
  {
    key: 'physical.outdoor_features',
    stage: 'physical',
    title: 'Document hot tub, fire pit, and outdoor features',
    description: 'What exists, the rules, and any seasonal closures.',
    why: 'Hot tub and fire pit questions carry safety and cost weight. The answer should be written, not recalled.',
  },
  {
    key: 'physical.cell_signal',
    stage: 'physical',
    title: 'Note cell signal quality',
    description: 'Carrier-by-carrier signal notes from standing inside the home.',
    why: 'Guests ask, and it was missing in most KBs at the last portfolio review.',
  },
  {
    key: 'physical.owner_known_issues',
    stage: 'physical',
    title: 'Log known issues and upcoming maintenance',
    description: 'The owner\'s honest list, recorded before the first guest finds it.',
    why: 'What is written here seeds work slips instead of surprise complaints.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.known_issues) || has(p.upcoming_maintenance),
  },

  // ── Access & connectivity ───────────────────────────────────────────
  {
    key: 'access.guest_access_method',
    stage: 'access',
    title: 'Decide the guest access method',
    description: 'Smart lock, lockbox, or keys, recorded on the property.',
    why: 'A high-stakes capture field. The field packet access card and every arrival answer start from it.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.guest_access_method),
  },
  {
    key: 'access.primary_door_code',
    stage: 'access',
    title: 'Primary door code on file',
    description: 'The working entry code stored in the RLS-locked access record.',
    why: 'A wrong value strands a cleaner at a keypad. This column is service-role only for a reason.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.smart_lock_code),
  },
  {
    key: 'access.key_backup',
    stage: 'access',
    title: 'Document the physical key backup',
    description: 'Lockbox location and who holds spare keys.',
    why: '73 Rocky Neck\'s foyer lock froze mid-stay. The backup path is what turns that into a two-minute fix.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.key_code_location),
  },
  {
    key: 'access.gate_garage_codes',
    stage: 'access',
    title: 'Capture gate and garage codes',
    description: 'Any driveway gate or garage keypad codes on file, or mark n/a.',
    why: 'Neither is asked on the intake form. Staff entry is the only way these land.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.gate_code) || has(p.garage_code),
  },
  {
    key: 'access.alarm_documented',
    stage: 'access',
    title: 'Document the alarm system',
    description: 'System, disarm steps, and what happens on a false trip.',
    why: 'An alarm nobody can disarm turns a cleaner arrival into a police visit.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.alarm_system),
  },
  {
    key: 'access.cleaner_code_programmed',
    stage: 'access',
    title: 'Program the cleaner code on the lock',
    description: 'The shared cleaner code (2222) programmed on every door lock.',
    why: 'A lock.unlocked with the cleaner code stamps "Cleaner in" on the turnover rail. Without it the home reads lockless.',
  },
  {
    key: 'access.guest_pin_test',
    stage: 'access',
    title: 'Issue and burn a test guest PIN',
    description: 'A short-lived test code issued from the property page and used on the actual door.',
    why: 'The three-hour test codes exist to pressure-test Helm to Seam to Schlage before a real guest is standing outside.',
    href: '/properties/{id}',
    hrefLabel: 'Open property',
  },
  {
    key: 'access.no_code_reuse',
    stage: 'access',
    title: 'Use fresh codes, not fleet repeats',
    description: 'No code copied from another property.',
    why: 'Code reuse across homes (2222 and 0124 at multiple properties) is a flagged leakage risk.',
  },
  {
    key: 'access.arrival_brief',
    stage: 'access',
    title: 'Write the arrival brief for field crews',
    description: 'Colleague-tone arrival and parking prose for inspectors and contractors.',
    why: 'The Field packet "How to get in" panel prints it. Access confusion is a dedicated contractor topic for a reason.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
  },
  {
    key: 'access.wifi_on_file',
    stage: 'access',
    title: 'Wifi network and password on file',
    description: 'Both networks with labels on two-router homes.',
    why: 'The canonical Tier 1 guest question. 79 Main\'s KB said _TODO_ while Helm had the password, the case that built the KB bridge.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.wifi_name) && has(p.wifi_password),
  },
  {
    key: 'access.router_location',
    stage: 'access',
    title: 'Note the router location and reboot steps',
    description: 'Where the router lives and how to power-cycle it.',
    why: 'The first fix for dead wifi is a reboot, and a guest can do it themselves if the note exists.',
  },
  {
    key: 'access.wifi_speed_test',
    stage: 'access',
    title: 'Run a wifi speed test in the home',
    description: 'Measured down and up speeds noted, not guessed.',
    why: 'Work-from-home guests ask for a number. An adjective invites a refund thread.',
  },
  {
    key: 'access.thermostat_access',
    stage: 'access',
    title: 'Capture thermostat brand and PIN',
    description: 'Brand plus any lock code on the unit.',
    why: 'The Nest and ecobee PINs used to trade around in Slack. Now they have a column.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.thermostat_brand) || has(p.thermostat_code),
  },

  // ── Services & staffing ─────────────────────────────────────────────
  {
    key: 'services.cleaner_assigned',
    stage: 'services',
    title: 'Assign a named cleaner',
    description: 'Who cleans this home, at what rate, on what schedule.',
    why: 'cleaner_phones maps SMS attribution, but nothing records who the cleaner actually is or what they charge.',
  },
  {
    key: 'services.cleaner_walkthrough',
    stage: 'services',
    title: 'Cleaner walkthrough done',
    description: 'The cleaner has walked the home: supply closet, quirks, par levels.',
    why: 'Turnover one is not the time for the cleaner to learn the house.',
  },
  {
    key: 'services.first_deep_clean',
    stage: 'services',
    title: 'Schedule the pre-launch deep clean',
    description: 'A full clean before photos and the first guest.',
    why: 'The photo shoot and the first review both ride on it.',
  },
  {
    key: 'services.linen_service_decided',
    stage: 'services',
    title: 'Decide the linen and laundry service',
    description: 'Nor\'East, Laundry Plus, or in-home laundering, decided and priced.',
    why: 'Linen and laundry vendors roll into cleaning_total but are non-turnover vendors, so the choice shapes the owner\'s cleaning line.',
  },
  {
    key: 'services.vendor_classification',
    stage: 'services',
    title: 'Add new vendors to bank classification',
    description: 'Any new cleaner, linen, or maintenance vendor added to the bank-charges arrays.',
    why: 'Vendor matching is code (src/lib/bank-charges.ts). A vendor missing from the arrays lands in the wrong statement bucket.',
  },
  {
    key: 'services.vendor_roster',
    stage: 'services',
    title: 'Build the local vendor roster',
    description: 'Plumber, electrician, landscaper, snow, each with a name and number.',
    why: 'Today vendor knowledge is ad-hoc notes with a vendor tag. Midnight leaks do not wait for research.',
  },
  {
    key: 'services.snow_landscaping',
    stage: 'services',
    title: 'Arrange snow and landscaping',
    description: 'Who plows, who mows, and what winter parking looks like.',
    why: 'Snow and tight winter parking is a real guest thread at 20 Enon. Bin access needs shoveling too.',
  },
  {
    key: 'services.climate_automation',
    stage: 'services',
    title: 'Configure climate automation',
    description: 'Thermostat mapped in Seam with eco and comfort setpoints per season.',
    why: 'Empty homes idle at eco and pre-warm before check-in. The 20 Enon lesson: the owner must complete the Ecobee account connect.',
    href: '/properties/{id}?tab=operations',
    hrefLabel: 'Open operations',
    derive: (ctx) => ctx.climateConfigured,
  },
  {
    key: 'services.emergency_contact',
    stage: 'services',
    title: 'Emergency contact on file',
    description: 'Name, relationship, and phone from the intake.',
    why: 'Incident escalation needs a person, not a search.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.emergency_contact_name) && has(p.emergency_contact_phone),
  },
  {
    key: 'services.ops_notebook',
    stage: 'services',
    title: 'Start the ops notebook',
    description: 'First internal note filed on the property.',
    why: 'Walkthrough leftovers, neighbor intel, and vendor quirks need a home the team actually reads.',
    href: '/properties/{id}?tab=operations',
    hrefLabel: 'Open operations',
    derive: (ctx) => ctx.opsNotes > 0,
  },
  {
    key: 'services.field_setup_packet',
    stage: 'services',
    title: 'Run the field setup packet',
    description: 'Setup packet created, claimed, and completed: staging, stocking, placards hung.',
    why: 'The setup visit rides the contractor rail with per-claim door codes, priced by bedroom count at $40 an hour.',
    href: '/operations/packets/setup',
    hrefLabel: 'Open packet setup',
  },

  // ── Inventory & outfitting ──────────────────────────────────────────
  {
    key: 'inventory.supply_closet',
    stage: 'inventory',
    title: 'Locate and stock the supply closet',
    description: 'One spot for cleaning supplies, linens, and paper goods, recorded and filled.',
    why: 'Cleaners and inspectors both ask where supplies live. The column exists precisely because the intake never asked.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.supply_closet_location),
  },
  {
    key: 'inventory.linen_par',
    stage: 'inventory',
    title: 'Linens at two sets per bed',
    description: 'Two full linen sets per bed plus towel par on site.',
    why: 'Bedding and towel counts were missing in nearly every KB. Two sets means a turnover never waits on laundry.',
  },
  {
    key: 'inventory.core_kitchen',
    stage: 'inventory',
    title: 'Complete the Core Kitchen Supplies list',
    description: 'Paper towels, TP, sponges, detergents, trash bags, and coffee pods at par.',
    why: 'The inspection card surveys these at every visit. Starting at par cuts the restock slips it would otherwise open.',
  },
  {
    key: 'inventory.bath_consumables',
    stage: 'inventory',
    title: 'Stock bathroom consumables',
    description: 'Soap, shampoo, and spare TP in every bathroom.',
    why: 'The cheapest category of five-star defense there is.',
  },
  {
    key: 'inventory.guest_gear',
    stage: 'inventory',
    title: 'Record guest gear on hand',
    description: 'Pack \'n play and high chair flags set if the home keeps them.',
    why: 'kb-facts exports the flags, so an approved gear request answers "already in the home" instead of opening a prep slip.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => p.has_pack_n_play || p.has_high_chair,
  },
  {
    key: 'inventory.gear_storage',
    stage: 'inventory',
    title: 'Write down where the gear lives',
    description: 'Storage spot for the pack \'n play, high chair, and extras.',
    why: 'Gear prep slips tell a cleaner to set it up. That note needs to say where to find it.',
  },
  {
    key: 'inventory.beach_gear',
    stage: 'inventory',
    title: 'Inventory the beach gear',
    description: 'Chairs, umbrellas, coolers, and sand toys counted and noted.',
    why: 'A KB template section guests genuinely ask about in a beach market.',
  },
  {
    key: 'inventory.purple_bags',
    stage: 'inventory',
    title: 'Stock purple bags (Gloucester)',
    description: 'A stash of city purple trash bags in the home, or n/a outside Gloucester.',
    why: 'The pre-arrival prep cron sends someone with bags. A stash in the home short-circuits the errand.',
  },
  {
    key: 'inventory.spares_stash',
    stage: 'inventory',
    title: 'Stash spare batteries and bulbs',
    description: 'Lock and detector batteries plus bulbs somewhere findable.',
    why: 'Locks at 20 percent auto-open a maintenance slip. The swap is fast only if batteries are already on site.',
  },
  {
    key: 'inventory.readiness_carryover',
    stage: 'inventory',
    title: 'Carry over the outfitting shortfall',
    description: 'The have-versus-need list from the projection readiness checklist, re-listed on the property.',
    why: 'Readiness state dies on the projection at promote. Whatever the home still needed goes invisible unless re-recorded.',
  },

  // ── Listing & channels ──────────────────────────────────────────────
  {
    key: 'listing.pricing_set',
    stage: 'listing',
    title: 'Set pricing, min-stay, and cleaning fee',
    description: 'Nightly rates, minimum-stay rules, and the guest cleaning fee configured in Guesty.',
    why: 'Nothing in Helm tracks rate-plan setup, and a listing can go live on defaults.',
  },
  {
    key: 'listing.house_rules',
    stage: 'listing',
    title: 'Write the house rules',
    description: 'The canonical rules text every channel shows.',
    why: 'Every policy answer a guest gets held to starts here.',
  },
  {
    key: 'listing.times_confirmed',
    stage: 'listing',
    title: 'Confirm check-in and checkout times',
    description: 'One canonical pair, identical in Guesty, the listing, and the KB.',
    why: '3 South\'s automated message said 10 AM while the team said 11. Guests notice the difference.',
  },
  {
    key: 'listing.quiet_hours_occupancy',
    stage: 'listing',
    title: 'State quiet hours and max occupancy',
    description: 'Both in the listing as hard numbers, not vibes.',
    why: 'Quiet hours were undocumented in 8 of 9 KBs, occupancy vague in 6 of 9. The fallback was citing the municipal ordinance.',
  },
  {
    key: 'listing.pet_policy',
    stage: 'listing',
    title: 'Decide the pet policy',
    description: 'Allowed or not, the fee, and the multi-dog and size lines.',
    why: 'The $200 fee is confirmed fleet-wide, but breed, size, and multi-dog questions still escalate. 30 Woodward carried a $200-versus-$250 ambiguity.',
  },
  {
    key: 'listing.smoking_policy',
    stage: 'listing',
    title: 'State the smoking policy',
    description: 'Inside, outside, and where, written in the listing.',
    why: 'Missing in 6 of 9 KBs at the last audit.',
  },
  {
    key: 'listing.cancellation_policy',
    stage: 'listing',
    title: 'Choose cancellation policies per channel',
    description: 'Airbnb, VRBO, and direct each set deliberately.',
    why: 'Refund threads land on whatever these say, chosen or not.',
  },
  {
    key: 'listing.discount_stance',
    stage: 'listing',
    title: 'Record the discount stance',
    description: 'Weekly, monthly, and repeat-guest positions, plus a long-stay floor.',
    why: 'Long-stay counter-offers reached $15-17k a month at 30 Woodward. A pre-decided floor makes those threads short.',
  },
  {
    key: 'listing.prior_listings',
    stage: 'listing',
    title: 'Record prior listing history',
    description: 'Whether the home was listed before, and the old listing URLs.',
    why: 'Old listings carry reviews, photos, and pricing history worth mining.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.currently_listed),
  },
  {
    key: 'listing.ical_imports',
    stage: 'listing',
    title: 'Wire channel iCal imports',
    description: 'A channel_listings row per channel with its import URL.',
    why: 'The Channels calendar reads these feeds. The Guesty aggregate row parses into real channels.',
    href: '/channels/{id}',
    hrefLabel: 'Open channels',
  },
  {
    key: 'listing.ical_export',
    stage: 'listing',
    title: 'Mint the iCal export and subscribe OTAs',
    description: 'Export token on the row, OTAs subscribed to the outbound feed.',
    why: 'The export URL only renders once the token exists. It is what keeps outside calendars blocked.',
    href: '/channels/{id}',
    hrefLabel: 'Open channels',
    derive: ({ p }) => has(p.ical_export_token),
  },
  {
    key: 'listing.sca_bedroom_photos',
    stage: 'listing',
    title: 'Shoot bedroom photos for SCA',
    description: 'Per-room photos for the sleeping arrangements section.',
    why: 'The SCA registry takes photos per sleeping arrangement. The setup packet stages beds hotel-style for exactly this shoot.',
    href: '/properties/{id}/stay-cape-ann',
    hrefLabel: 'Open SCA launch',
  },

  // ── Guest experience ────────────────────────────────────────────────
  {
    key: 'guest_experience.trash_rules',
    stage: 'guest_experience',
    title: 'Trash day and bag rules on file',
    description: 'Trash day, recycling day, and the purple-bag rule recorded.',
    why: 'Drives the trash-day reminder engine, the purple-bag prep cron, the guest KB, and Guesty\'s trashCollectedOn. Non-Gloucester homes need the day set by hand.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.trash_day),
  },
  {
    key: 'guest_experience.guest_kb_seeded',
    stage: 'guest_experience',
    title: 'Seed the guest knowledge base',
    description: 'First guest-facing notes filed on the property.',
    why: 'guest_facing notes ARE the guest KB. A fresh scaffold ships with about twenty _TODO_ placeholders that each become an escalation.',
    href: '/properties/{id}?tab=operations',
    hrefLabel: 'Open operations',
    derive: (ctx) => ctx.guestFacingNotes > 0,
  },
  {
    key: 'guest_experience.home_guide',
    stage: 'guest_experience',
    title: 'Generate and print the home guide',
    description: 'Six-cell guide customized, printed, and in the home.',
    why: 'Wifi, climate, parking, and trash cells auto-fill from the record. The setup packet hangs it.',
    href: '/properties/{id}/home-guide',
    hrefLabel: 'Open home guide',
  },
  {
    key: 'guest_experience.wifi_placard',
    stage: 'guest_experience',
    title: 'Print the wifi placard',
    description: 'Network and password placard printed and posted by the router.',
    why: 'The single most-asked guest question, answered by a piece of paper.',
    href: '/properties/{id}/wifi-placard',
    hrefLabel: 'Open placard',
  },
  {
    key: 'guest_experience.welcome_card',
    stage: 'guest_experience',
    title: 'Print the welcome card',
    description: 'The SCA subscribe-QR welcome card out on the counter.',
    why: 'Every OTA guest who scans it is a future direct booking without channel fees.',
    href: '/properties/{id}/welcome-card',
    hrefLabel: 'Open welcome card',
  },
  {
    key: 'guest_experience.early_late_defaults',
    stage: 'guest_experience',
    title: 'Decide early and late defaults',
    description: 'Default answers and fees for early check-in and late checkout.',
    why: 'The highest-frequency judgment ask, and the expedited-clean fee ($100 versus $150) was never confirmed.',
  },
  {
    key: 'guest_experience.checkout_expectations',
    stage: 'guest_experience',
    title: 'Write the checkout expectations',
    description: 'What guests should do at checkout, even if the answer is "nothing, we handle it".',
    why: 'A scaffold _TODO_ at every fresh property. Guests ask for a checklist.',
  },
  {
    key: 'guest_experience.parking_prose',
    stage: 'guest_experience',
    title: 'Write guest-voice parking instructions',
    description: 'How many cars, where exactly, street rules, and winter caveats.',
    why: '"How far is overflow when Rocky Neck Ave is full" went unanswered. Snow parking at 20 Enon is a real thread.',
    href: '/properties/{id}/edit',
    hrefLabel: 'Edit field',
    derive: ({ p }) => has(p.parking),
  },
  {
    key: 'guest_experience.arrival_landmarks',
    stage: 'guest_experience',
    title: 'Write arrival landmarks and GPS gotchas',
    description: 'The little white gate, the back door that is really the front, whatever finds the house.',
    why: '20 Enon guests keyed the wrong door because the front code does not work. Landmarks beat addresses on these streets.',
  },
  {
    key: 'guest_experience.grocery_coffee',
    stage: 'guest_experience',
    title: 'Name the closest grocery and coffee',
    description: 'Two concrete recs with walk or drive times.',
    why: 'The two most-missing local recs portfolio-wide, absent from 5 of 9 KBs.',
  },
  {
    key: 'guest_experience.local_shortlist',
    stage: 'guest_experience',
    title: 'Build the local shortlist',
    description: 'Seafood, dinner, beaches, activities, and rainy-day options with seasonal notes.',
    why: 'Rainy-day recs were missing in four KBs, and Cape Ann restaurants close by season.',
  },
  {
    key: 'guest_experience.neighbors_noise',
    stage: 'guest_experience',
    title: 'Note the neighbor and noise profile',
    description: 'What the street sounds like and who lives next door.',
    why: 'The wine bar next to 73 Rocky Neck and the Saturday generator test at 16 Waterman both surprised guests first.',
  },
  {
    key: 'guest_experience.deliveries_mail',
    stage: 'guest_experience',
    title: 'Set the deliveries and mail protocol',
    description: 'Where packages drop and what to do with misdelivered mail.',
    why: 'Misrouted packages at 20 Enon stayed an unresolved thread. A written protocol ends it.',
  },
];

export function itemsForStage(stage: OnboardingStage): OnboardingItem[] {
  return ONBOARDING_ITEMS.filter((item) => item.stage === stage);
}
