# Cluster C2: per-property tools, fleet boards, contracts and prospects

Audited 2026-10-17 against branch `claude/helm-ui-ux-audit-7760d6`. Every page.tsx in the cluster was read in full along with its sibling components; the public render pages were skimmed as the brief asked. Line numbers refer to the files as they stand on this branch.

## How a user reaches these tools (the discovery layer)

The property page has four tabs plus a conditional fifth (`src/app/properties/[id]/page.tsx:848-861`): Now, Facts, Owner & money, Guest & listing, and Setup, which appears only while `!(p.activated_at || firstStayStarted)` (page.tsx:649). The tools in this cluster hang off those tabs like this:

| Tool | Where it is linked | Words on the link | Words on the destination |
|---|---|---|---|
| Launch checklist | Now tab action link (page.tsx:870-889); Setup tab "Go-live gates" collapsible (1196-1207); post-activation one-liner (1525-1534); Onboarding board rows | "Launch checklist 12/26 →", "Open launch checklist →", "Open the launch checklist", "Open checklist →" | h1 "Bring 47 Atlantic online", eyebrow "Launch checklist", breadcrumb Onboarding › home › Launch checklist (launch/page.tsx:72-87) |
| Draft listing | Guest & listing tile (page.tsx:2113-2118); launch step `generate_copy` deep link (LaunchStepCard.tsx:74-78) | "Draft listing" / "Draft listing copy" | "Draft a listing.", eyebrow "Stay Cape Ann · Listing copy", breadcrumb "Listing copy" |
| Caption photos | Guest & listing tile (2119-2124); launch step `caption_photos` | "Caption photos" | "Caption the gallery.", eyebrow "Guesty · Photo captions", breadcrumb "Photo captions" |
| Sync to Guesty | Guest & listing tile (2125-2130) | "Sync to Guesty" | "Fill Guesty from Helm.", eyebrow "Guesty · Listing fields", breadcrumb "Guesty listing fields" |
| Stay Cape Ann | Guest & listing tile (2137-2167); launch step `set_external_title` ("Open Stay Cape Ann"); caption-photos needs-listing link | "Stay Cape Ann" with a status chip | "Launch on Stay Cape Ann", breadcrumb "Stay Cape Ann launch" |
| Bedroom photos | Guest & listing tile only when SCA is live (2168-2175); whisper link on /properties (properties/page.tsx:123-128) | "Bedroom photos" | "Bedroom photos for Stay Cape Ann" |
| Home guide | Guest Deliverables tile (2232-2277) | eyebrow "Welcome Guide", title "Stay Cape Ann home guide", buttons "Open ↗" "Download PDF" "Customize" | document reads "Welcome home."; the editor below reads "Customize home guide" |
| Welcome card, Wi-Fi placard, Information Note, Trash Day Notice | Guest Deliverables tiles (2278-2398) | "Open ↗" + "Download PDF" (+ "Whole fleet" on trash) | raw document pages with no chrome |
| Work slips print sheet | Open Work header on Now (OpenWorkSection.tsx:73-87); turnovers rows (CompactTurnoverRow.tsx:297) | "Print →" | "Rising Tide · Work Slip Checklist", back link "← Property folder" |
| Order checklist | ONLY from two Setup catalog items (onboarding-catalog.ts:881, 947) | "Open →" | "Outfitting order", back link "← Onboarding" |
| Info note, trash notice | Gloucester homes only (page.tsx:2316, 2347) | | |

Three things fall out of that table before any page is opened.

First, the order checklist is reachable only while the Setup tab exists. The moment a home is activated or its first guest arrives, the Setup tab leaves the strip (page.tsx:860) and the outfitting order list becomes a URL-only page. Its own back link points at `?tab=setup` (OrderChecklistClient.tsx:117), which `PropertyTabs` silently maps to the first tab when the id is unknown (PropertyTabs.tsx:76).

Second, the tile names and the page titles disagree on nearly every tool. "Caption photos" becomes "Photo captions" becomes "Caption the gallery." "Sync to Guesty" becomes "Fill Guesty from Helm", while a different Facts tile reads "Fill blanks from Guesty" and pushes in the opposite direction (page.tsx:1251-1264). "Welcome Guide" is the eyebrow for something whose title is "home guide", whose document says "Welcome home.", whose editor says "Customize home guide", and which sits next to a different artifact called "Welcome Card".

Third, the same checklist is summarized in four places (Now tab chip, Setup "Go-live gates" collapsible, post-activation sentence, Onboarding board) while a different 108-item list occupies the whole Setup tab under the heading nobody uses for it. The memory note is blunt about this: when Dotti says "the onboarding checklist" she means the launch checklist, not the catalog.

## Per-page findings

### /properties/[id]/launch

1. **Purpose.** The 26-step go-live list for one home: bank, Stripe, listing, cleaner wiring, activation.
2. **Entry points.** Now tab action link (page.tsx:870); Setup collapsible (1205); post-activation sentence (1530); Onboarding board (onboarding/page.tsx:236, 279, 294); Cmd+K does not list it (no atlas entry; the board is 05d).
3. **Inventory.** Masthead; breadcrumb "Onboarding › home › Launch checklist" (launch/page.tsx:72-78); h1 "Bring X online"; a five-line explainer paragraph (88-93); "All homes onboarding →" link; progress strip with two serif numbers ("12 of 26", "Required remaining 7"), a bar, and "Next up" (104-188); six phase sections (Identity, Financial, Listing, Integrations, Owner-facing, Launch) each with a "N/26 Resolved | Complete" chip; 26 `LaunchStepCard` rows. Per row: status dot, title, up to five tags (Next up, Required, Activation gate, Auto, Ops/Systems/Owner), description, why, example, completed stamp, an inline field editor on four steps (external title, tax cert, bank last 4, listing-match), a deep link, the Activate button on the gate step, "+ Add note" toggle with Cancel/Save note, and a status `<select>` with five values (To-do, In progress, Done, Skipped, N/A). The Financial phase also hosts `StripeAccountCheck` (auto-runs on mount, "Check all keys" button). Roughly 26 × 4 controls plus the strip: well over a hundred interactive elements on one page.
4. **New-hire friction.**
   - "Systems" as a who-label is defined only in the lede ("Systems is a Helm change to ask for", launch/page.tsx:89-91). The step `code_roster_entry` is titled "Listed in Helm's code roster (src/lib/properties.ts)" (launch-checklist.ts) and the board repeats "Not in the code roster (src/lib/properties.ts): /book page 404s, fallbacks skip it." (onboarding/page.tsx:67). A file path is not a step a new operations manager can act on.
   - Five statuses where the memory says the team wanted one tick. "Skipped" versus "N/A" is never explained (LaunchStepCard.tsx:97-103).
   - The `tax_cert` and `bank_last4` steps have an inline editor and ALSO a deep link to `/properties/<id>/edit` labelled "Open property edit" (LaunchStepCard.tsx:66-70), so the row offers two ways to set one field. The same tax certificate can also be entered on the property page's `TaxCertEditor`, on the edit page, and on the owner intake form as "MA Room Occupancy Certificate #" (onboarding/[token]/page.tsx:334-347). Four writers, three names (tax certificate, Room Occupancy Certificate, `masstax_registration` in the catalog).
   - `open_quo` opens `https://my.openphone.com/` (LaunchStepCard.tsx:85); the product is Quo everywhere else in Helm.
   - `StripeAccountCheck` fires two Stripe reads on every load for every visitor and prints charge counts (StripeAccountCheck.tsx:54-65, 212-215). Staff see it.
   - Mobile: the row is a three-column grid (dot, body, status select) with tags that do not wrap; the status pill column is fixed. Usable but cramped; the progress strip's two 28px numbers side by side will stack awkwardly.
5. **Overlap.** The Onboarding board shows the same rows. The Setup catalog repeats several steps in substance (`financial.chase_account_opened` vs `bank_last4`, `financial.sca_payment_wiring` vs `sca_page_live`, `financial.masstax_registration` vs `tax_cert`).
6. **Owner vs staff.** Not gated. Staff see bank last 4 (an owner field per CLAUDE.md's "not yet redacted" note) and the Stripe charge count.
7. **Proposals.**
   - S: one status control per row (done / not done / does not apply) and drop "In progress" and "Skipped"; keep notes.
   - S: remove the duplicate "Open property edit" link on rows that carry an inline editor.
   - M: hide the Financial phase's bank and Stripe rows from staff, or move the Stripe check behind a button instead of auto-running.
   - M: rename `code_roster_entry` and the board flag to what the operator sees ("Book page does not resolve yet; ask Systems") and keep the file path in the step's `why`.

### /properties/onboarding (the Onboarding board)

1. **Purpose.** Every home carrying a launch checklist, in three groups, with the next step and who owns it.
2. **Entry points.** PropertiesTabBar "Onboarding" (PropertiesTabBar.tsx:13); launch page breadcrumb and "All homes onboarding →" (launch/page.tsx:74, 96); Cmd+K (atlas 05d "Onboarding board").
3. **Inventory.** Hero "Homes coming online."; the tab bar; a four-tile stat strip (In flight, Live loose ends, Needs a look, Open required steps); three groups (In flight, Live with loose ends, Complete) each with a blurb; one row per home (name link, owner and live line, progress bar, "12/26 resolved · 3 required open", Next up link, attention flags, "Open checklist →"); an "Not tracked here" paragraph. No controls other than links.
4. **New-hire friction.**
   - The stat strip is derived rollup chrome ("Open required steps across tracked homes") of the kind the lens says Dotti dislikes (onboarding/page.tsx:116-131).
   - The hero says "Homes coming online", the tab says "Onboarding", the atlas says "Onboarding board", the rows link to a "Launch checklist". The word onboarding is also the name of the prospect's intake stage and of the owner intake link on the property page.
   - Attention flags are sentences with code in them (lines 59-70).
   - Mobile: the row is a three-column grid with `whiteSpace: nowrap` on the right cell (line 277); no media query.
5. **Overlap.** Same loader and rows as the launch page; the "Needs a look" count duplicates the nightly launch-readiness slips.
6. **Owner vs staff.** Open to staff; the page itself is fine, but its tab bar shows Prospects and Contracts to staff (see bugs).
7. **Proposals.**
   - S: drop the stat strip; the three group counts already say it.
   - S: rename the tab and hero to "Launch" so the board, the per-home page and the chip share one word.
   - M: collapse the board into /properties as a "Coming online" section at the top of the roster (it is three short lists), and retire the separate route.

### /properties/[id] Setup tab (the 108-item catalog) and the Go-live gates collapsible

Not a page of its own but the brief asked how it relates to the launch checklist and the board.

The Setup tab renders nine collapsible stages (owner_deal, financial, compliance, physical, access, services, inventory, listing, guest_experience) over 108 items (`ONBOARDING_ITEMS`, onboarding-catalog.ts:203, count 108), each row with a dot, a title, an "Open →" link on 60 of them, a description plus why line, an optional note, and an `OnboardingItemToggle` (page.tsx:1103-1189). The physical stage also embeds the `RoomsEditor`. Below the stages sits "Go-live gates", a collapsible holding one sentence and an "Open launch checklist →" button (1196-1207). The catalog's links resolve to 17 distinct targets, 27 of them to the edit page and 8 to the property page itself (the page the user is already on).

So the Setup tab is a third view of launch state (summary only) sitting on top of a second, longer list with its own table (`property_onboarding_items`) and its own status vocabulary (todo / done / n_a), and the order checklist and readiness walk are a fourth and fifth list with a third table pair. Live data in the memory note: four human ticks on the launch checklist across nine homes, 23 on the catalog, and the team "keep complaining that we need one".

Proposals: M: make the launch checklist the only list with ticks; turn the catalog's 41 derived items into facts that simply render on Facts, and the hand-tick remainder into launch-step notes or delete them. S: delete the Go-live gates collapsible (the Now tab chip already links the checklist).

### /properties/[id]/order-checklist

1. **Purpose.** The outfitting order for a new home: linens at 2.5x per bed size, towels at 2.5x max guests, pillows, plus the readiness groups, rolling up into a "To order" list.
2. **Entry points.** Two Setup catalog items (`inventory.linen_par`, `inventory.readiness_carryover`, onboarding-catalog.ts:881, 947). Nothing else. URL-only once the Setup tab is gone.
3. **Inventory.** No masthead. Sticky header with "← Onboarding" and "Print ↗"; eyebrow "Outfitting order"; h1 home name; a context line ("6 guests · 3 beds (2 queen, 1 king) · 3 BR / 2 BA"); an estimate warning with a "Walk the rooms" link; progress ("14 of 38 covered", "52 units to order", bar, save status, last edit); per group a title and "N / M" count and rows (tap to toggle full/none, a number input "have / need"); "Order notes" textarea; "To order" summary; footer.
4. **New-hire friction.**
   - "← Onboarding" and "Walk the rooms" both link `?tab=setup` (OrderChecklistClient.tsx:117, 131); on an activated home that tab does not exist and the link lands on Now with no sign anything was wrong.
   - "Print ↗" is `window.print()` (line 120); the arrow glyph means "opens elsewhere" on every other surface in this cluster.
   - The page has no masthead or breadcrumb, unlike every other tool page except the print sheets; a user who arrives from the catalog cannot get anywhere but back.
   - Tap-the-row-to-fill-all with a number input beside it is explained nowhere on the page; the aria-label carries the only hint.
5. **Overlap.** The prospect readiness checklist (same groups, same interaction, `projections.readiness_state`) and this one (`property_order_checklist`) are two copies of one walk-through; this page merges the prospect's counts at read time (order-checklist/page.tsx:57-73).
6. **Owner vs staff.** Open to staff. Fine.
7. **Proposals.**
   - S: give it the masthead and a registry breadcrumb (Properties › home › Outfitting order) and point the back link at the home, not a tab.
   - S: add a tile for it on the Facts tab (next to Inspection layout) so it survives activation.
   - L: merge the readiness walk and the outfitting order into one walkthrough that follows the home from prospect to property (one table, one page, two modes: counting and ordering).

### /properties/[id]/home-guide (and the Customize form on the property page)

1. **Purpose.** The one-page guest "Welcome home." sheet: Wi-Fi, climate, parking, trash, two operator-picked cells.
2. **Entry points.** Guest Deliverables tile "Open ↗" and "Download PDF" (page.tsx:2251-2254); catalog item `guest_experience.home_guide` (onboarding-catalog.ts:1099-1104).
3. **Inventory.** The document only: header, six cells, footer. No chrome, no back link, no print button. Self-guards via `requirePropertyDocumentAccess` (home-guide/page.tsx:36). The Customize form (`HomeGuideCustomizeForm`, a `<details>` under the tile grid) holds four textareas for the fixed cells, two picker slots each with a Type select, a Custom title input and a Body textarea, a conventions paragraph, and "Save changes".
4. **New-hire friction.**
   - Naming: tile eyebrow "Welcome Guide", tile title "Stay Cape Ann home guide", editor "Customize home guide", document "Welcome home.", catalog "home_guide". The Welcome Card is a different artifact one tile over.
   - The tile copy says "Edit operational data in the Operations tab to refresh" (page.tsx:2238). There is no Operations tab; the fields live under Facts.
   - The customize hints are developer prose: "network + password rows from the property's wifi_* columns" (HomeGuideCustomizeForm.tsx:70), "uses the parking field if filled; otherwise the city-level default from civic.parking" (84). Column names on an operator form.
   - The "Custom title (only used when Type is Custom)" input is always visible (303-320).
   - The document inlines its own old `ScaMark` (home-guide/page.tsx:313-322); the three 4 x 6 cards use the shared `components/properties/ScaMark.tsx`. Brand drift the memory note already flags as open.
   - Opened in a new tab, the page is a dead end: Cmd+P is the only way to print, and nothing says so.
5. **Overlap.** The intake form's section 08 "Your Home, for Guests" writes the same overrides (onboarding/[token]/page.tsx:438-478); the property page's Customize form edits them; the Sync to Guesty tool pushes the same Wi-Fi and parking text to Guesty.
6. **Owner vs staff.** Staff can open it. Fine (the Wi-Fi password is guest-facing anyway).
7. **Proposals.**
   - S: one name. Call it "Home guide" on the tile, the editor and the catalog; keep "Welcome home." as the document headline only.
   - S: rewrite the six hints as what the guest will read ("Default: the network and password on file"), no column names.
   - S: use the shared ScaMark.
   - M: give the five guest documents one screen-only header bar (home name, "Back", "Print", "Download PDF") so an opened document is not a dead end.

### /properties/[id]/info-note

1. **Purpose.** The posted house and civic sheet the Gloucester STR permit inspector reads: contacts, trash, parking, noise, animals, shutoffs, fire safety, permit id.
2. **Entry points.** Guest Deliverables tile, Gloucester only (page.tsx:2316-2345); the tile lists missing fields in red.
3. **Inventory.** Document only, three contact cells, six cells, footer. No controls. No self-guard; 404s outside Gloucester (info-note/page.tsx:39).
4. **Friction.** Same dead-end opened page as the home guide. Empty cells print a dash while the tile says what is missing; the two should agree. The contacts strip prints `LOCAL_CONTACTS_24HR` (the operator and a backup), not the owner's emergency contact, which is the intake field named "Emergency Contact"; an operator will look for it here and not find it.
5. **Overlap.** The trash cell repeats the trash notice's rule; the shutoff and fire fields are the same ones the intake form, the edit page and the Facts tab show.
6. **Owner vs staff.** Open. Fine.
7. **Proposals.** S: share the header bar above. S: label the strip "Rising Tide contacts" so nobody hunts for the owner's emergency contact here.

### /properties/[id]/welcome-card, /properties/[id]/wifi-placard, /properties/[id]/trash-notice

Three 4 x 6 cards, one component family, one pattern: raw document page, "Open ↗" and "Download PDF" on the tile. The welcome card is universal copy and always ready (welcome-card/page.tsx:27-33). The Wi-Fi placard prints one card per network and self-guards (wifi-placard/page.tsx:36). The trash notice renders a reason panel instead of a card when the day cannot be resolved (trash-notice/page.tsx:31-50) and its tile text says "the city small print" (page.tsx:2353-2354) although the card was stripped of small print on purpose (memory note: no small print). The tile also says "Add where the carts live under Operations" (page.tsx:2361), a tab that no longer exists.

Proposals: S: fix the two tile sentences. S: the shared header bar. These pages are otherwise fine.

### /properties/trash-notices

1. **Purpose.** Every Gloucester home's fridge card on one page for a batch print, with a review table.
2. **Entry points.** The per-home tile's "Whole fleet" ghost link (page.tsx:2377-2393); Cmd+K (05e). Not on the Properties tab bar or the fleet page.
3. **Inventory.** No masthead; a cream review strip with "← Properties", title, a three-line explainer, "Print all", a table (#, Home, Day, Source, Where the carts live), a "No card" list linking each skipped home to `/properties/<id>/edit#safety`; then the cards.
4. **Friction.** Reachable only from inside one home's Guest & listing tab, which is not where someone printing the fleet starts. "Print all" is the only button; no download. The explainer could be the table's caption.
5. **Overlap.** The per-home trash notice.
6. **Owner vs staff.** Open. Fine.
7. **Proposals.** S: a "Trash day cards" link beside "Stay Cape Ann listing copy →" on /properties. This page is otherwise the best-shaped deliverable page in the cluster (a review table, one verb) and the others should copy it.

### /properties/[id]/work-slips/print

1. **Purpose.** The printable per-home work sheet: the brief's bullets, then one section per lane, with tappable tick boxes on screen.
2. **Entry points.** Open Work header "Print →" (OpenWorkSection.tsx:73); turnover rows (CompactTurnoverRow.tsx:297, with `?auto=1`).
3. **Inventory.** No masthead; "← Property folder" and "Print / Save PDF"; a masthead line "Rising Tide · Work Slip Checklist" and the date; h1 home name; brief bullets or a count line; a summary bits line; per lane a header (label, hint, count), a "Bring:" line for supply, a count-only line for office, rows with a tick button, number, title, detail, meta, priority, and `/work/<id>` short id; colophon.
4. **Friction.**
   - Lane vocabulary (Needs restock, This visit, Handyman run, Licensed pro or vendor, Owner to purchase or decide, Office follow-through) is defined by `LANE_HINTS` on the sheet itself (work-slip-lanes.ts:46-51), which is the right place; the meta line's "From ... · still open Sep 2 · asked Sep 4" is not.
   - The tick is one-way: "once you mark a slip done, the tick box locks. Undo is on the slip detail page" (SlipRow.tsx:36-37). On a phone in a basement that is a destructive tap with no undo on the surface where it happened.
   - "← Property folder" is the only place in Helm the property page is called a folder.
   - Owner-ask lines print to whoever carries the sheet ("Owner to purchase or decide · asked Sep 4").
5. **Overlap.** The Open Work section on the Now tab (same slips, same brief); the Field packet print.
6. **Owner vs staff.** Open. Fine.
7. **Proposals.** S: an "Undo" on the ticked row for the length of the session. S: rename the back link "← 47 Atlantic". Otherwise this page is good: one verb, lanes explained in place.

### /properties/[id]/listing-copy

1. **Purpose.** An AI draft of a title, summary and description from the property record plus up to six photos, to paste into Guesty or Stay Cape Ann.
2. **Entry points.** Guest & listing tile "Draft listing" (page.tsx:2113-2118); launch step "Draft listing copy" (LaunchStepCard.tsx:74-78).
3. **Inventory.** Masthead; breadcrumb home › Listing copy; h1 "Draft a listing."; a five-line explainer; a Format toggle (Airbnb / Guesty, Stay Cape Ann); "What makes it special" textarea; photo input with chips; "Generate listing copy" / "Regenerate"; "Back to <home>"; result pane with per-field Copy buttons and character counters.
4. **Friction.** The page says of itself "Nothing saves back to the property yet, this is a copy + paste workflow" (listing-copy/page.tsx:56-57). The Stay Cape Ann format produces exactly the tagline, About and highlights the SCA launcher's form wants, and the launcher has its own "Pull from Guesty" that fills the same fields (ScaLaunchClient.tsx:174-236), so the operator drafts here, copies, pastes there. The explainer paragraph is the only description of the format choice; the two format buttons already say it.
5. **Overlap.** The SCA launcher (per home) and the Listing Copy Studio (fleet) edit the same three fields with their own redraft buttons.
6. **Owner vs staff.** Open. Fine.
7. **Proposals.** M: fold this into the SCA launcher's Step 1 as a "Draft with AI" button beside "Pull from Guesty", and into the Listing collapsible for the Guesty format; retire the route.

### /properties/[id]/caption-photos

1. **Purpose.** Load the Guesty gallery, draft a caption per photo, save captions back to Guesty one at a time or all at once.
2. **Entry points.** Guest & listing tile "Caption photos" (page.tsx:2119-2124); launch step `caption_photos`.
3. **Inventory.** Masthead; breadcrumb home › Photo captions; h1 "Caption the gallery."; explainer; a verification notice; toolbar with counts and "Draft empty (N)", "Draft all", "Save all to Guesty (N)"; a collapsed "Add a note to ground the drafts"; restore notice; result notice; a grid of photo cards each with current caption, a textarea, "Save to Guesty" and an Unsaved flag.
4. **Friction.** Three names for one tool (tile, breadcrumb, title). The "needs listing" empty state links to the SCA launcher to set the Guesty listing id (CaptionPhotosClient.tsx:267-274), which is the right destination but an odd name for "where the Guesty id lives". The confirm on Save all names three channels (line 204); good. The standing notice "New here, so try one photo first" (281-284) is permanent explainer copy for a feature that shipped in September.
5. **Overlap.** The Listing collapsible's photos on the property page.
6. **Owner vs staff.** Open. Fine.
7. **Proposals.** S: one name ("Photo captions") on tile, breadcrumb, title and launch link. S: drop the "new here" notice. Otherwise the page is well shaped: counts, two verbs, one confirm.

### /properties/[id]/sync-guesty

1. **Purpose.** Push Helm's Wi-Fi, parking and trash fields into the matching Guesty guest-facing fields, with a per-field diff and tick.
2. **Entry points.** Guest & listing tile "Sync to Guesty" (page.tsx:2125-2130).
3. **Inventory.** Masthead; breadcrumb home › Guesty listing fields; h1 "Fill Guesty from Helm."; explainer; one card per field (checkbox, label, Reveal/Hide on the password, a status chip Will fill / Will overwrite / Already matches / Empty, an editable "Value to push" input and an "In Guesty now" column); "Push N to Guesty" / "Nothing selected".
4. **Friction.**
   - Three names (tile "Sync to Guesty", title "Fill Guesty from Helm", breadcrumb "Guesty listing fields") and a sibling tile on Facts, "Fill blanks from Guesty", that goes the other way (page.tsx:1251-1264). A new hire cannot tell which fills what.
   - The failure state drops the `needsListing` flag and shows only the error text (SyncGuestyClient.tsx:161-178); caption-photos handles the same case with a link. Dead end.
   - Visual drift: rounded 12px cards, `var(--card)`, a teal 8px-radius button (SyncGuestyClient.tsx:166, 194, 290) on a page whose siblings are square and ink.
5. **Overlap.** The Listing collapsible; the home guide's cells.
6. **Owner vs staff.** Open. Fine.
7. **Proposals.** S: add the SCA-launcher link to the needs-listing state. S: one name and the square button family. M: merge with "Fill blanks from Guesty" into one "Guesty fields" screen with two columns and two arrows, so direction is visible instead of named.

### /properties/[id]/stay-cape-ann

1. **Purpose.** Put a home on staycapeann.com: fill the registry entry, open a PR, review the preview, wire the property's own Stripe account, go live; afterwards, update copy or unlist.
2. **Entry points.** Guest & listing tile "Stay Cape Ann" with a status chip (page.tsx:2137-2167); launch step "Open Stay Cape Ann"; caption-photos and the catalog (`financial.sca_payment_wiring`, `financial.sca_test_booking`, `listing.sca_bedroom_photos`).
3. **Inventory.** Masthead; breadcrumb; hero; status bar (Draft / PR open / Live / Unlisted); GITHUB_TOKEN banner; notice banner; Step 1 fieldset with six inputs (Guesty listing ID, Stripe account key, Public listing name, Internal name, iCal export URL, Display rank), "Pull from Guesty", Map pitch, Tagline, About, Highlights (3+ with add/remove), Stay favorite (name, town, lat, lng, blurb), three Repeatables (Extra dining picks, Sleeping arrangements with a PhotoUploader per room, Curated reviews), then "Save draft" and "Open preview PR →" (or "Update live listing →", "Refresh update PR", "Publish update"); Step 2 Review the preview (PR link, preview badge, "Open preview ↗", "Check now"); Step 3 Wire up payments (three env var copy lines, a permissions table, a webhook copy line, three checkboxes, "Verify wiring"); Step 4 Go live ("Approve & go live →", "Force go-live…", and when live "Verify payments (production)", "Refresh site data", "Unlist…"). Around 45 controls.
4. **Friction.**
   - The page is a deployment console: PR, preview deploy, squash-merge, env vars on a Vercel project, webhook signing secret, restricted-key permissions by resource. Delaney will meet "PR", "preview deploy", "snapshot refresh", "demo mode", "registry", "ical-urls.json" (ScaLaunchClient.tsx:356-359) on her first week with no definitions beyond the hints.
   - "Stripe account key" (an env var suffix the operator types in caps, line 370) sits next to "Guesty listing ID" as if they were the same kind of thing.
   - Lat/lng are typed by hand for every restaurant (446-447, 466-467).
   - Mobile: the Step 1 grid is fixed two columns and the favorite row is four columns (lines 366, 443); no media query.
5. **Overlap.** Listing Copy Studio (same tagline/About/highlights, different publish path); Bedroom photos (same sleeping arrangements, different publish path); Draft listing (the AI source for the same fields); the Listing collapsible (Helm-native listing content).
6. **Owner vs staff.** Not in `OWNER_PATH_PREFIXES` (helm-access.ts:64-84), so staff can open it and read the Stripe wiring instructions, env var names and the "Force go-live" button. CLAUDE.md puts Stripe behind the owner API gate; the page that tells you how to mint and place the key is open.
7. **Proposals.**
   - M: split content from wiring. Steps 1 and 2 are listing content (staff work). Steps 3 and 4 are money and deployment (owner work); put them behind `owner` and show staff a one-line "Payments: wired / not wired" instead.
   - M: make this the single home for SCA copy and bedroom photos and retire the two fleet pages (see the merge list).
   - S: a two-column breakpoint for phones.

### /properties/listing-copy-studio

1. **Purpose.** Review and fix the tagline, About and highlights on every live SCA listing, stage edits on one branch, publish once.
2. **Entry points.** A 12px whisper link on /properties, "Stay Cape Ann listing copy →" (properties/page.tsx:117-122); Cmd+K (05a).
3. **Inventory.** Masthead; "← Properties"; hero with a three-line description; "Publish all (N)"; "Only flagged" checkbox; a counts line; an unsaved warning; a notice; a four-line explainer on Stage versus Publish; one row per listing (expand toggle, public and internal name, flag chips such as "OTA bullets", "em dashes", "About is a wall", a status pill Clean / Needs review / Unsaved edits / Edited · restage / Staged ✓, "Live page ↗") and an editor (Tagline, About, highlights with add/remove, "Redraft from Guesty", "Stage edit").
4. **Friction.** "Stage" then "Publish all" is a git workflow with git words; the paragraph at ListingCopyStudio.tsx:236-241 exists because the two buttons do not explain themselves. The flag chips are a style linter ("em dashes", "exclamation marks") rendered as alerts. A listing can also be edited on its own SCA launcher page with "Update live listing" and "Publish update", a second publish path for the same three fields.
5. **Overlap.** The SCA launcher per home; Draft listing.
6. **Owner vs staff.** Open. Publishing to the public site from a staff login is probably intended.
7. **Proposals.** M: fold into the SCA launcher's Step 1 as a fleet filter ("All listings") with one verb, Publish; drop Stage. S: until then, rename "Stage edit" to "Save" and "Publish all" to "Publish N saved edits".

### /properties/bedroom-photos

1. **Purpose.** Add or replace a listing's bedroom photos on staycapeann.com by dropping files in.
2. **Entry points.** Whisper link on /properties (properties/page.tsx:123-128); the Guest & listing tile when SCA is live (page.tsx:2168-2175) with `?listing=&property=`; Cmd+K (05b).
3. **Inventory.** Masthead; "← Properties" (which goes to the home's Guest tab when `?property=` is set, bedroom-photos/page.tsx:84-89, so the label is wrong there); hero; left picker with search and per-listing photo counts; right editor with a legacy-photos strip, one card per bedroom (name, beds, PhotoUploader, Remove), "+ Add bedroom", "Publish to Stay Cape Ann", a result line.
4. **Friction.** The SCA launcher's "Sleeping arrangements" repeatable is the same editor with the same uploader (ScaLaunchClient.tsx:473-505); two places to add the same photos with two publish paths (auto-merged PR here, update PR there). The hero description promises "no file names, no commands, no work computer" (line 96), which is a sentence about what the page is not.
5. **Overlap.** SCA launcher.
6. **Owner vs staff.** Open. Fine.
7. **Proposals.** M: retire the fleet page; the per-home launcher already has it. S: fix the back-link label.

### /properties/prospects (the funnel list) and /prospects/new

1. **Purpose.** The prospect funnel: active, promoted and inactive projections, plus "New Prospect" and a Gmail sync.
2. **Entry points.** PropertiesTabBar "Prospects" (PropertiesTabBar.tsx:12); /today's Prospects card "Open →" (today/page.tsx:539); breadcrumbs from the workroom and new page; /projections redirects here; Cmd+K (06).
3. **Inventory.** Hero "All Rising Tide prospects."; tab bar; a CTA bar with "New Prospect →", "Sync Gmail" and an italic note ("Sync scans Allie's sent folder ...", ProspectsPanel.tsx:64); "Active Prospects" list (number, address, close-likelihood chip, name · market · BR, touch badges, range, status, a Demote/Reactivate text button inside the row link); "Promoted" and "Inactive" lists with blurbs; then a collapsed "+ Add a prospective property" form (Name, Address, Town, submit) with its own explainer. /prospects/new is the masthead, a breadcrumb, an h1 "A new prospect.", a two-line explainer and the seven-section `ProjectionForm` ending in "Create prospect".
4. **Friction.**
   - Two different things called prospect on one page. "New Prospect →" creates a `projections` row (a deal, with a deck and a contract). "+ Add a prospective property" creates a `properties` row with `kind: 'prospect'` and lands on a property page (properties/actions.ts:1242-1260). The second form's own explainer has to say what it is not ("it stays out of statements, owner tools, and the turnover board", AddProspectForm.tsx:53-54).
   - "Promoted" is headed "N archived" (ProspectsPanel.tsx:108-110): two words for the same group in one header.
   - "Demote" is a reasonless one-tap on the list row (ProspectInactiveControls.tsx:28-70) and a reason-taking button on the detail page; same action, two names ("Demote" and "Mark inactive").
   - The Gmail note names Allie's sent folder; the memory says the Gmail token is dotti@ and guest mail is From allie@. Verify before shipping copy.
   - /prospects/new asks for Home value, interior grade (A / B / C), ramp and go-live month, overrides, deposit, reputation damages and sale notification days on day one (ProjectionForm.tsx:104-385). Seven sections to create a record whose first deliverable needs three of them.
5. **Overlap.** The home feed's Prospects card; the CRM contacts.
6. **Owner vs staff.** Owner-only by prefix (helm-access.ts:73-74). Staff reach the tab and the home-feed link and bounce.
7. **Proposals.**
   - S: move "+ Add a prospective property" to /properties (it makes a property) and name it "Add a home we may sign"; the funnel page keeps one word for prospect.
   - S: one verb for inactivation ("Mark inactive") in both places; drop the in-row one-tap or make it ask for a reason too.
   - M: a two-field create (owner name, address) that lands on the workroom; everything else is edited there.

### /prospects/[id] (the workroom, 1,774 lines)

1. **Purpose.** One deal from first deck to promotion: send the projection, send the guide and contract, apply the owner's redlines, get the signature, countersign, collect the intake, promote.
2. **Entry points.** Funnel rows; the property page's "Contract workroom" and "Countersign on the prospect page" links (owner-gated); contracts register chips; /today.
3. **Inventory, top to bottom.** Masthead; breadcrumb; identity strip (month · status, address, "Prepared for"); Existing-owner banner; PipelineProgressBar (four dots) beside the CloseLikelihoodWidget (click to edit, Save / Cancel / Clear); a collapsed Communications `<details>` (SMS and Gmail merged); the Pipeline:
   - 01 Projection: three StageStats, a tiered-rule line, "Include monthly breakdown slide" form button, "Open ↗", "Download Projection", "Mark as sent".
   - 02 Partnership Guide & Contract: Guide ("Open ↗", "Download Guide"); Contract (term · fee · deposit, "Open ↗", "Download Contract", "Apply owner redlines with Claude" which opens `ContractRedlinesPanel`: Interpret / Precise toggle, a 20,000-char textarea, "Interpret edits", a preview with per-edit checkboxes and an "Attorney review recommended" block, a refine textarea with "Iterate", "Apply N selected edits", "Discard all", "Start over", "View updated contract ↗", "Run another round"); Signing (explainer, signed line, "Withdraw signature", a copy notice, Sealed copies with SHA-256 and "Send to owner" / "Resend", Owner email with "Save email" / "Update", the link box with "Copy" and "Open ↗", "↓ Download signed PDF", "↗ View in Drive archive", "Countersign & send"); Manual override ("Mark contract complete" / "Undo").
   - 03 Onboarding: explainer, link box, "Mark onboarding complete" / "Undo", Property Readiness Checklist ("Open ↗", "Download Checklist"), Submitted answers in seven groups.
   - 04 Promote: "Promote to managed property →" or "Open property →".
   Then: Activity log `<details>`; "Edit prospect details" `<details>` holding the seven-section ProjectionForm with a terms-locked notice; Funnel status (reason input, "Mark inactive" / "Reactivate prospect"); Danger zone ("Reset contract", "Delete prospect…" with typed last-name confirmation). Around 40 distinct controls, five "Open ↗ / Download" pairs, three explainer paragraphs per stage.
4. **Friction.**
   - Contract terms can be changed in two places with different grammars: section 06 of the edit form (ProjectionForm.tsx:306-385) and the redlines panel's Precise mode, which edits the same columns one field at a time (ContractRedlinesPanel.tsx:33, 469-531). Both refuse after signature, each with its own notice.
   - Four manual overrides ("Mark as sent", "Mark contract complete", "Mark onboarding complete", and the countersign) each with an italic sentence explaining when to use it (prospects/[id]/page.tsx:809, 1214).
   - "Interpret" versus "Precise (fields only)" is a mode toggle whose difference is explained in the lede sentence that changes under it (ContractRedlinesPanel.tsx:186-190).
   - The link boxes show a relative path (`/contract/<token>`) while Copy puts the absolute URL on the clipboard (page.tsx:1460-1500).
   - The Danger zone paragraph tells the reader to use Reset or Mark inactive instead (page.tsx:595-599); the deletion itself is well guarded (typed last name).
   - Close likelihood is a hand-typed percentage with three colour bands (CloseLikelihoodWidget.tsx:233-247); nobody asked the page to rank deals.
   - Mobile: the hero stacks under 720px (page.tsx:337-352) and the progress bar labels shrink, which is good; the stage cards are long paragraphs on a phone.
5. **Overlap.** The property page's Management Agreement section repeats the contract status and links back here; the contracts register classifies the same signing stages a second time (contracts/page.tsx:85-134).
6. **Owner vs staff.** Owner-only by prefix. Staff who are handed a `/projections/<id>/contract` link can open it: the deliverable regex returns before the owner check (proxy.ts:236 vs 272).
7. **Proposals.**
   - M: one place for contract terms. Keep the redlines panel (owner asks become edits) and strip section 06 from the edit form, or keep the form and drop Precise mode. Not both.
   - M: collapse the three manual overrides into one "Done outside Helm" control per stage with the same wording and the same Undo.
   - S: drop the close-likelihood widget and chip (or move it into the edit form as a plain field).
   - S: show the absolute URL in the link boxes.
   - L: make Stage 02 its own page ("Contract") and leave the workroom with the four-dot pipeline, the communications stream and the stage summaries.

### /prospects/[id]/readiness and /prospects/[id]/readiness/print

The interactive walk (tap a row to fill, type a partial count, six note fields, a "Still needed" list, "Send to team for review →" which emails Allie, Ryan and the sender) and its print twin (a Letter punch list with blank note lines and a footer naming allie@ and the OWNERS line). Entry: the workroom's Onboarding stage ("Open ↗", "Download Checklist"). Friction: the header's "Print version ↗" refuses to open while a save is pending with an alert-style error (ReadinessChecklistClient.tsx:214); the page has no masthead, and "← Prospect" is its only way out. The same checklist exists again per property as the order checklist (see above). Proposal: L: one walkthrough for both (listed under order-checklist).

### /properties/contracts (the register)

1. **Purpose.** Every management agreement: fee, term, renewal mechanic, next deadline, the paper, and the homes with no live agreement.
2. **Entry points.** PropertiesTabBar "Contracts" (PropertiesTabBar.tsx:14); the property page's "All contracts" (owner-gated, page.tsx:1926, 2040); Cmd+K (05c).
3. **Inventory.** Hero; tab bar; a four-tile stat strip (Live contracts, Next deadline, Settled for 2027, No live contract); "Action needed" as date groups (heading, relative days, a sentence, property chips) plus Countersign, Awaiting owner, No live contract, Not registered and In Drive groups; a six-column "Register" header (Property, Fee, Term, Renewal, Next deadline, blank) and one `<details>` row per home with the paper's facts folded underneath. Controls: zero writes. Everything is a link, a chip or an expander.
4. **Friction.**
   - The register cannot be written from the UI. The only writer is `countersignContract` on a Helm renewal (projections/actions.ts:1465-1469; memory: "Registering an orphan is still a manual/Claude step"). The "Not registered" group says "It joins this register once its terms are entered" (contracts/page.tsx:668-672) and offers nowhere to enter them. The "In Drive" group opens the PDF and stops.
   - The one write that exists, "Draft renewal", lives on the property page's Owner & money tab (page.tsx:1939, 2019), not here.
   - A live contract whose home has left the roster renders the raw id as the home's name (contracts/page.tsx:305-322, `name: c.property_id`).
   - The stat strip is derived chrome; "Settled for 2027" is a count nobody acts on.
   - Vocabulary: notice window, non-renewal, auto-renew, mutual agreement, fixed term, superseded, lapsed, executed, countersigned, register, orphan, all on one screen, none defined.
   - Mobile: the six-column summary collapses to two columns at 760px (css at contracts/page.tsx:208-213); the Action-needed groups stack. Workable.
5. **Overlap.** The property page's Management Agreement section; the workroom's signing panel; the weekly contracts-sweep cron.
6. **Owner vs staff.** Owner-only; the tab is shown to staff anyway.
7. **Proposals.**
   - M: a "Register this agreement" form (owner party, executed date, term, renewal type, notice days, fee, Drive file) opened from the Not registered and In Drive chips and from each home's row. This is the single biggest missing control in the cluster.
   - S: move "Draft renewal" onto each register row.
   - S: drop the stat strip; "Action needed" already leads.
   - S: fall back to the home's last known name for off-roster rows.

### /onboarding/ma-str-registration

A public six-step guide to the MassTaxConnect registration, linked from the intake form's "MA Room Occupancy Certificate #" hint and the catalog's `financial.masstax_registration`. Owner-facing, well written, no controls. One note: it names Allie and the OWNERS line (ma-str-registration/page.tsx:182-187) while `team-recipients.ts` is supposed to own who gets named; the thank-you page does the same ("Allie O'Brien, Owner, Rising Tide", thanks/page.tsx:73-74). Fine as a page.

### /onboarding/[token] (the owner intake form) and /thanks

As the owner sees it: a branded eight-section form (Personal, Property, Utilities, Short-term Rental, Access & Notes, Emergency Contact, Inspection & Safety, Your Home for Guests), around 60 fields, auto-saving, one "Submit form" button, Allie's contact in the footer. Hints are good ("Where the indoor bins and the outdoor carts live. We add the city set-out rule ourselves."). The form serves two audiences through one URL: a prospect's token and a managed property's token (onboarding/[token]/page.tsx:60-80), prefilling from either.

The thank-you page only looks up `projections` (thanks/page.tsx:19-27). A property-token owner is redirected there by `submitOnboarding` (projections/actions.ts, property branch ends in `redirect(/onboarding/${token}/thanks)`) and by the form page itself once submitted (page.tsx:206-208), and gets Not Found. See bugs.

### The public render pages, one line each

- `/projections/[id]/render`: the projection deck (2,971 lines), puppeteer target, public by regex, no self-guard.
- `/projections/[id]/guide`: the partnership guide, same pattern.
- `/projections/[id]/contract`: the contract preview over `ContractDocument` (the data-driven clause tree with overrides), no signing form, no self-guard.
- `/projections/[id]/onboarding-render`: the printed intake, self-guards (Helm session or `?token=`) because it carries Wi-Fi passwords and lock codes.

### src/components/projections/* (summary)

`Pipeline`/`Stage` is a clean layout primitive. `ProjectionForm` is seven sections and 30 fields with hints that read like docs ("Set revenue overrides to bypass the 50/50 blend", ProjectionForm.tsx:263-265). `ContractRedlinesPanel` is a full AI workflow (two modes, preview, iterate, apply, failures) living inside a disclosure inside a sub-deliverable inside a stage. `CloseLikelihoodWidget`, `SyncGmailButton`, `DownloadPdfButton`, `SigningButtons`, `DeleteProspectButton`, `ResetContractButton`, `ProspectInactiveControls`, `CustomClausesField` (with "Refine with AI" and Undo) and `OwnersSection` are each fine on their own; the problem is that all of them render on one page.

## The five biggest structural problems

1. **"Onboarding" names five different things and the home carries four checklists with no single owner.** The Properties tab "Onboarding" is the launch board (PropertiesTabBar.tsx:13; onboarding/page.tsx:106-112); the launch page's breadcrumb starts with "Onboarding" (launch/page.tsx:74); the Setup tab is a different 108-item catalog with its own table (page.tsx:860, 1103-1189; onboarding-catalog.ts:203); "Go-live gates" is the launch list again as a count (page.tsx:1196-1207); the prospect workroom's Stage 03 "Onboarding" is the owner intake form (prospects/[id]/page.tsx:423-441); the property page's "Owner onboarding intake" is the same form for a managed home (PropertyOnboardingLink.tsx:181); and the readiness walk and the outfitting order are two more tap-to-count lists on two tables (readiness/page.tsx:46-57; order-checklist/page.tsx:42-79). The order checklist is reachable only through the Setup tab, which disappears on activation (onboarding-catalog.ts:881, 947; page.tsx:649).

2. **The owner/staff line is drawn in the navigation in the wrong place.** The tab bar shows Prospects and Contracts to every login and has no role prop (PropertiesTabBar.tsx:9-15), the home feed's Prospects card links to the funnel for everyone (today/page.tsx:539; daily-brief.ts:1274 builds it without a role), and both proxy.ts:268 and not-available/page.tsx:8 assert that "the nav never links there for staff". Meanwhile the surfaces that actually hold money mechanics are open to staff: the launch page's bank last 4 editor and Stripe charge check (LaunchStepCard.tsx:44-49; StripeAccountCheck.tsx:54-65), the SCA launcher's Stripe wiring (ScaLaunchClient.tsx:622-692), and the deck and contract renders, because the deliverable regex returns before the owner check (proxy.ts:236-237 vs 272).

3. **The prospect workroom is one 1,774-line page doing five jobs.** Four stages, two AI tools (redlines, clause refine), four manual overrides, a 30-field form, a danger zone, and contract terms editable in two different grammars (ProjectionForm.tsx:306-385 and ContractRedlinesPanel.tsx:469-531). The "Open ↗ / Download" pair repeats five times (prospects/[id]/page.tsx:1415-1458). Every stage opens with an italic paragraph telling the reader what to do.

4. **Eleven printed deliverables per home share no single pattern and the opened page is a dead end for five of them.** Guest documents: tile with "Open ↗" plus "Download PDF" and a raw page with no chrome (page.tsx:2251-2254; home-guide/page.tsx). Work sheet: "← Property folder" plus "Print / Save PDF" (PrintButton.tsx:39). Order checklist: "← Onboarding" plus "Print ↗" meaning window.print (OrderChecklistClient.tsx:120). Fleet trash cards: "Print all" (PrintAllButton.tsx:21). Readiness: "Print version ↗" to a second page. Prospect deliverables: "Open ↗" plus "Download X" plus a Drive archive on send or countersign. Six affordances for one verb, and nothing in the property cluster archives anywhere.

5. **Tool names drift between tile, breadcrumb, page title and launch link, and three Guesty tools with opposite directions sit under look-alike names.** "Caption photos" / "Photo captions" / "Caption the gallery." (page.tsx:2121; caption-photos/page.tsx:42, 49). "Sync to Guesty" / "Fill Guesty from Helm." / "Guesty listing fields" (page.tsx:2127; sync-guesty/page.tsx:41, 48) beside "Fill blanks from Guesty" which pulls the other way (page.tsx:1251-1264). "Welcome Guide" / "Stay Cape Ann home guide" / "Customize home guide" / "Welcome home." next to "Welcome Card" (page.tsx:2235-2245; HomeGuideCustomizeForm.tsx:116). Two objects called prospect on the funnel page (ProspectsPanel.tsx:44-60; AddProspectForm.tsx:24). "Demote" on the list, "Mark inactive" on the detail (ProspectInactiveControls.tsx:65-67, 152).

## Vocabulary a new hire meets in this cluster

| Term | What the code means | Defined in the UI? |
|---|---|---|
| Prospect | Either a `projections` row (a deal with a deck) or a `properties` row with `kind: 'prospect'` | No; the two share a page |
| Projection | The deck AND the record that generates it | No |
| Partnership guide | The second deliverable, `/projections/<id>/guide` | No |
| Contract, agreement, management agreement | The third deliverable; "agreement" on the property page, "contract" everywhere else | No |
| Redlines, Interpret, Precise | The owner's requested edits; AI-mapped vs hand-entered | One lede sentence that swaps under the toggle |
| Rider, custom clause | Per-deal addenda rendered after Sale Protection | Paragraph in the form |
| Sealed copy, SHA-256 | The PDF kept at each signature with its hash | No |
| Withdraw signature, countersign, executed | The signing chain | Explainer paragraphs |
| Promote | Create the `properties` row from the projection | Paragraph in Stage 04 |
| Demote, inactive, reactivate | Park a dead deal | Paragraph |
| Close likelihood | A typed percentage | "your call" |
| Touch, last touch, marked sent | A Gmail send detected by sync, or a manual mark | Tooltip only |
| Onboarding | See structural problem 1 | No |
| Intake form | `/onboarding/<token>` | No |
| Launch checklist, go-live gates, activate, activation gate | The 26-step list and its last step | Lede paragraph |
| Setup, catalog, stage | The 108-item tab and its nine groups | No |
| Phase, Ops / Systems / Owner, Auto, Required | Launch step attributes | Lede paragraph defines Systems |
| Readiness checklist, outfitting order | Two tap-to-count walks | Hero sentence on each |
| Walkthrough, walk the rooms | Dictation into `property_rooms` | Setup lede |
| Deliverable | Guest documents on the property page; deck, guide, contract, readiness on the prospect | No |
| Placard, notice, information note, welcome guide, home guide, welcome card | Five printed guest items | Tile copy |
| Listing copy, tagline, About, highlights, map pitch, stay favorite, display rank | SCA registry fields | Hints |
| Stage edit, Publish all, PR, preview deploy, update PR, go live, force go-live, unlist, demo mode, snapshot refresh, registry, ical-urls.json | The SCA deployment workflow | A paragraph on the studio; hints on the launcher |
| Guesty listing ID, listing-match substring, external title, internal name, public listing name | Four identities of one home | Hints and the launch step |
| Fill blanks from Guesty vs Sync to Guesty vs Pull from Guesty vs Redraft from Guesty | Four Guesty reads and writes | No |
| Lane: needs restock, this visit, handyman run, licensed pro, owner, office | Where a slip is filed | Yes, `LANE_HINTS` on the print sheet |
| Slip, brief, organize group | Work items, the home's summary, a cluster | Brief: no; group: "↳ label" |
| Code roster, src/lib/properties.ts | A TypeScript file | No |
| Register, unregistered, orphan, in Drive | The contracts table and the sweep | No |
| Notice window, non-renewal, auto-renew, mutual agreement, fixed term, lapsed, superseded, settled | Renewal mechanics | No |
| Tax cert, Room Occupancy Certificate, STR permit, STR registration id, MassTax registration | Two numbers under five names | Only the MA guide |
| Stripe account key, restricted key, env var, webhook secret, STRIPE_KEY_<ID> | Payment wiring | Hints on the launcher |
| Carts handled by us, DPW street list, split street | Trash resolution | Review table on the fleet page |
| Helm-run, calendar authority | Whether Helm or Guesty owns the calendar | Tile status chip |

## Pages to merge, demote or delete

- **Merge /properties/onboarding into /properties** as a "Coming online" section (three short lists) and rename every surface of the 26-step list "Launch". Reason: it duplicates the per-home page, and its tab name is the root of the onboarding confusion.
- **Demote the Setup tab's 108-item catalog.** Keep the derives as facts on Facts; move the hand ticks that matter into launch-step notes; delete the "Go-live gates" collapsible. Reason: live data shows the team does not tick it, and it is the second list under a third name.
- **Merge /properties/[id]/listing-copy into the SCA launcher and the Listing collapsible** as a "Draft with AI" button. Reason: the page saves nothing (listing-copy/page.tsx:56-57) and its output is the launcher's input.
- **Delete /properties/listing-copy-studio and /properties/bedroom-photos as routes**; the per-home launcher already edits the same fields with the same uploader. Keep a fleet filter on the launcher if batch review is wanted. Reason: two publish paths for one registry entry.
- **Merge the readiness walk and the outfitting order** into one walkthrough that follows the home across promotion. Reason: same groups, same taps, two tables, two back links to two different parents.
- **Move "Add a prospective property" from /properties/prospects to /properties** and rename it. Reason: it creates a property, and the funnel page should have one meaning for prospect.
- **Split the SCA launcher** into Listing content (staff) and Payments and go-live (owner). Reason: the Stripe section is money mechanics on an ungated page.
- **Give the contracts register its own write control** and move "Draft renewal" onto its rows. Reason: it is the only board in the cluster with zero writes, and its action groups end in "once its terms are entered" with no entry point.
- **Keep** /properties/trash-notices, the work-slips print sheet, the five guest documents (behind a shared header bar), the MA guide, the intake form.

## Plain bugs (kept apart from the design findings)

1. **Owner intake for a managed property ends on Not Found.** `thanks/page.tsx:19-27` queries only `projections` by token; `submitOnboarding`'s property branch redirects to `/onboarding/<token>/thanks` (projections/actions.ts, the branch after the `properties` lookup ends in that redirect) and the form page redirects already-submitted property tokens to the same place (onboarding/[token]/page.tsx:206-208). An owner invited from the property page's "Owner onboarding intake" submits successfully and sees a 404; the link stays dead afterwards.
2. **Staff are shown owner-only tabs and bounce.** `PropertiesTabBar` takes no role and always renders Prospects and Contracts (PropertiesTabBar.tsx:9-15), rendered on /properties (properties/page.tsx:107) and /properties/onboarding (onboarding/page.tsx:112). Both land staff on /not-available. The home feed's Prospects card does the same (today/page.tsx:539; daily-brief.ts:1274). proxy.ts:268 and not-available/page.tsx:8 both assume this cannot happen.
3. **Dead tab deep links.** `?tab=documents` (DocumentsPanel.tsx:192), `?tab=setup` on an activated home (OrderChecklistClient.tsx:117, 131), `?tab=today` (page.tsx:928). `PropertyTabs` maps an unknown id to the first tab silently (PropertyTabs.tsx:76), so each click looks like it did nothing.
4. **Sync to Guesty's needs-listing state is a dead end.** `SyncGuestyClient.tsx:161-178` discards `needsListing` and prints only the error; caption-photos links to the fix (CaptionPhotosClient.tsx:267-274).
5. **Off-roster contracts print the property id as the home's name** (contracts/page.tsx:305-322).
6. **Stale tab names in live copy.** "Edit operational data in the Operations tab" (page.tsx:2238), "Add where the carts live under Operations" (2361), "the capture box on Today" (1097); the tabs are Facts and Now.
7. **Trash tile promises "the city small print"** (page.tsx:2353-2354); the card was stripped of it on purpose.
8. **The launch step's Quo link opens my.openphone.com** (LaunchStepCard.tsx:85).
9. **"← Properties" on /properties/bedroom-photos goes to a home's Guest tab** when `?property=` is set (bedroom-photos/page.tsx:84-89).
10. **The home guide inlines the old SCA mark** (home-guide/page.tsx:313-322) while its 4 x 6 siblings use the shared one.
11. **The Gmail sync note names "Allie's sent folder"** (ProspectsPanel.tsx:64); the memory says the Gmail token is dotti@. Verify which mailbox the sync reads before anyone relies on the sentence.

## What was surprising

- The contracts register, the page that tracks $400-per-day class deadlines, has no write path at all; the one way in is countersigning a Helm renewal, and found paper is "a manual/Claude step".
- A managed-property owner who completes the intake lands on a 404, and nothing in the code comments knows it.
- The order checklist, built on 2026-08-31 from Allie's Fix Linens rules, is unreachable from any activated home.
- The proxy, the not-available page and the tab bar disagree about whether staff are ever shown owner links; the two that say "never" are wrong.
