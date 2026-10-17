# F1: Growth (Marketing, Guests, Competitors)

Audit of the Growth masthead tab and everything under it, read from source on 2026-10-17. Repo root `/Users/maguire/Developer/statement-portal/.claude/worktrees/helm-ui-ux-audit-7760d6`; paths below are relative to `src/`. Line numbers are from the files as read.

## Verdict on the masthead slot

Growth does not earn a masthead slot for a staff member. Tapping Growth lands on `/marketing`, a Google Analytics mirror (`lib/helm-modules.ts:524-533`: the `marketing` module carries `navLabel: 'Growth'` and `href: '/marketing'`). Nothing under the tab is an operations duty except two things: reading reviews (`/guests`) and the direct-stay rental agreement (`/guests/agreements`). The rest is owner work (quotes, AirDNA, competitor owner-of-record research), marketing sends (campaigns to the whole list), or analytics. 132 visits in 90 days for the whole tab fits what the code shows: a shelf of five unrelated tools behind one word.

The mechanism to fix this exists and is not a nav reorg: `primaryModulesFor(role)` already drops Money from the staff masthead (`lib/helm-modules.ts:790-792`). Growth needs a flag that demotes it to the More menu for staff without gating the route, because `access: 'owner'` also turns the route away at the proxy and `helm-access.test.ts:117-134` requires every owner-flagged href to sit behind `OWNER_PATH_PREFIXES`. For staff, Reviews stays reachable from the home Five-Star Reviews tile (`app/page.tsx:391`) and Agreements should be reachable from the stay it belongs to, not from a Growth strip.

## What a user sees at the top of `/guests/contacts`

Counted from `app/guests/contacts/page.tsx`:

1. Masthead: logo, Helm, Work, Turnovers, Field, Messaging, Properties, Growth, More, search, user menu (`components/HelmMasthead.tsx`).
2. Growth strip: MARKETING / GUESTS / COMPETITORS (`components/MarketingTabs.tsx:21-27`).
3. Hero: eyebrow "Helm · Guests", 44px headline "The list, kept close.", a sentence about The Weekly (`contacts/page.tsx:61-77`).
4. Guests strip: REVIEWS / CONTACTS / AGREEMENTS / QUOTES (`contacts/page.tsx:79`, `app/guests/GuestsTabBar.tsx:18-26`).
5. Stat strip: Subscribers, Total Contacts, Last 30 Days, Bounced (`contacts/page.tsx:81-96`).
6. Optional flash banner (`contacts/page.tsx:98-130`).
7. Action bar, seven controls: Import CSV →, Sync from Guesty · 2h ago, Campaigns (n), New Campaign, Segments (n), Marketing Memory, + Add Contact (`contacts/page.tsx:132-161`).
8. Filter row: search, status select, Filter, Clear (`contacts/page.tsx:165-186`).
9. Up to eight tag pills (`contacts/page.tsx:189-219`).
10. "Contacts" heading with the match count, then the first row (`contacts/page.tsx:223-231`).

That is three tab rows, a hero between the second and third, and nineteen controls before the first contact. The hero also moves the Guests strip: on `/guests` (Reviews) there is no hero and the strip sits directly under the eyebrow (`app/guests/page.tsx:25-29`), on Contacts, Agreements and Quotes a hero pushes it roughly 180px lower (`contacts/page.tsx:61-79`, `agreements/page.tsx:18-24`, `quotes/page.tsx:17-23`). Clicking between sibling tabs makes the tab bar jump. The strips are rendered by each page, not by a layout: there is no `layout.tsx` under `app/guests`, `app/marketing` or `app/competitors` (only `app/layout.tsx` and `app/work/layout.tsx` exist), so the August rule "strips rendered by layouts" never reached Growth. The Guests strip appears on four of the eighteen `/guests` routes (reviews, contacts, agreements, quotes); every other page replaces it with a "← Guests" or "← Campaigns" eyebrow link.

## What "Guests" means

Five things, depending on where you read it:

- The masthead strip tab "Guests" goes to `/guests`, which is Reviews (`MarketingTabs.tsx:25`, `app/guests/page.tsx:9-30`).
- The registry entry titled "Guests" describes "subscriber list, segments, and campaigns" (`lib/helm-modules.ts:598-608`), so Cmd+K "Guests" lands on reviews while promising subscribers.
- The back links on `/guests/[id]`, `/guests/segments`, `/guests/campaigns` and `/guests/marketing` read "← Guests" and go to `/guests/contacts` (`[id]/page.tsx:35`, `segments/page.tsx:18`, `campaigns/page.tsx:18`, `marketing/page.tsx:37`).
- The Guests strip adds Agreements and Quotes, so "Guests" also means paperwork and pricing (`GuestsTabBar.tsx:21-24`).
- `HelmLoading` for every `/guests/*` route says "Helm · Guests" (`app/guests/loading.tsx:4`), including the quote composer.

## The review-request engine

Absent from Growth. Nothing in `src/app` or `src/lib` reads `review_asks` (grep for `review_asks`, `review-request`, `booking_nudges` across `src/app`, `src/components`, `src/lib` returns only `app/messaging/format.ts:45,63-64`, which labels a Messaging card "Review request"). The Reviews tab is a read-only list of what Guesty synced, so it cannot answer "did we ask this guest", "is the day 7-10 follow-up due", or "which stays got no review". The only nudge is the stat sub-label "review individually" under Below five (`ReviewsTab.tsx:117`), which is text, not a control.

## Campaign composer safety

Yes, a new hire can send The Weekly to every subscriber by accident:

- `createDraftFromBrief` lands the operator on a campaign with subject, preheader and body filled by the model, and the segment defaulting to Insider List when none was picked (`app/guests/campaigns/actions.ts:95-104, 109-122`). Insider List is everyone subscribed (`supabase/migrations/20260507_audience_insider_segments.sql:18-27`).
- The red "Send to N recipients →" button is enabled whenever the saved row has subject, body and segment (`campaigns/[id]/page.tsx:243-249`), which the AI path guarantees on first paint.
- It is a `SubmitButton` with `formAction={sendCampaign}` in the same form as "Send test to me" and "Save draft" (`page.tsx:232-250, 273`). No confirm dialog, no typed count, no second step: `grep confirm(` across the cluster hits only `components/competitors/AddressEditor.tsx:51,59`.
- `sendCampaign` requires only a session (`actions.ts:280-281`). Staff can send.
- Once sent, the loop runs serially inside the server action (`actions.ts:324-361`) with no `maxDuration` under `app/guests` (grep: none). The row is locked to `sending` first (`actions.ts:310-318`) and only unlocked at the end (`actions.ts:363-374`), so a timeout mid-loop leaves a campaign stuck on "Send is in flight. This page will refresh when complete." (`page.tsx:107-113`), and nothing refreshes it: the page imports no AutoRefresh and no poll.

What exists on the good side: the status lock prevents a double send, the just-drafted flash says "send a test to yourself before the real send" (`page.tsx:127`), and test sends carry a [TEST] prefix without locking the draft (`actions.ts:245`).

---

## Pages

### /marketing

**Purpose.** How the two public sites (staycapeann.com, risingtidestr.com) are doing: visits, conversions, sources, page speed.

**Entry points.** Masthead tab Growth (`lib/helm-modules.ts:524-533`); Growth strip tab Marketing (`MarketingTabs.tsx:24`); Cmd+K. No in-page link from any other module (grep for `/marketing` outside the cluster: none).

**Inventory.** HelmHero "How the sites are doing." with a two-sentence description (`app/marketing/page.tsx:58-64`). FilterBar: segmented All / SCA / RT, segmented 7d / 30d / 90d, "Updated 3h ago" (`FilterBar.tsx:50-64`); a text link "AirDNA market data →" (`page.tsx:74-81`). Stat strip of five: Sessions, Users, New users, Conversions, Avg LCP, each with a delta "vs prev period" and an "i" tooltip (`page.tsx:95-126`). "Sessions, daily" line chart (`Charts.tsx:20-77`). Two tables: Top sources, Top pages (`page.tsx:136-163`). "Where unknown traffic lands" table with a tooltip (`page.tsx:165-181`). Core Web Vitals cards per site with LCP / INP / CLS (`page.tsx:183-205`). Controls: 2 segmented groups (6 buttons), 1 link, 6 tooltips. No forms.

**New-hire friction.**
- Jargon everywhere, and the page knows it: six tooltip paragraphs define Sessions, Users, New users, Conversions, LCP and "unknown traffic" (`page.tsx:97, 103, 109, 115, 122, 169`). A page that needs six definitions of its own column headers is a GA4 lesson, not an operational surface.
- The empty chart says "No data yet", then an em dash, then "first cron run is 5am UTC" (`Charts.tsx:36`): a cron time and a house-style violation on an operator screen.
- The site filter uses ids from the DB for labels (`FilterBar.tsx:52`), which is fine, but "RT" vs "SCA" is undefined for someone on day one.
- Density is moderate: 5 stats, 1 chart, 3 tables, 2 vitals cards.
- Mobile: the stat strip carries `rt-helm-stat-strip` and reflows to two columns (`page.tsx:87`, `globals.css:435-447`); the two-up tables carry `rt-two-col` (`page.tsx:138`, `globals.css:395`). Works on a phone.

**Overlap.** None inside Helm. The memory note says per-listing performance was meant to drill in from each property page; no such link exists today.

**Owner vs staff.** Visible to both. Conversions and traffic are not owner money. For staff it is analytics chrome by the audit's own definition: nothing here changes what Delaney does today.

**Proposals.**
- Growth lands owners here and staff nowhere near it: demote Growth to More for staff (S, see verdict above).
- The six "i" tooltips go; the two labels that need it get a plain sub-label ("visits", "people") and the rest read as GA4 reads (S).
- The AirDNA link leaves this page once AirDNA is owner-only (S).

### /marketing/airdna

**Purpose.** Upload AirDNA CSV exports so the public market pages on risingtidestr.com update.

**Entry points.** Text link on `/marketing` (`page.tsx:74-81`); Cmd+K (registered hidden, `helm-modules.ts:536-547`); the AirDNA nudge text to Dotti.

**Inventory.** HelmHero "Update the market data for the towns." with a four-sentence description (`airdna/page.tsx:334-340`). Left card: heading "Pick the AirDNA CSV(s)", an explainer paragraph naming the four export shapes (`:349-357`), a drag-and-drop zone (`:359-423`), "Clear all" (`:427-442`), a market select that appears only for single-metric files (`:445-482`), a per-file preview with warnings (`:484-493`, `:607-712`), "Save to database" (`:495-510`), a result box (`:514-548`). Right card "Current data": per market "Through <month>, N months on file" and "View public page →" to risingtidestr.com, plus "AirDNA publishes the previous month around the 15th. If a market is missing the previous month past the 20th, Helm will text you." (`:553-601`). Controls: 1 dropzone, 1 file input, 1 select, 3 buttons, 2 external links.

**New-hire friction.**
- Upload-first by design: the hero verb is "Update", the primary card is the dropzone, and the only readout is a month and a count. The registry promises "read occupancy, ADR, and revenue benchmarks" (`helm-modules.ts:541`); Helm shows none of them. To see the data you leave Helm for the public site.
- "Helm will text you" is false on a staff screen: the nudge texts `DOTTI_PHONE` (CLAUDE.md, Team notices).
- "Save to database" is a developer's verb (`:509`).
- A second visual language: rounded cards and inputs (`borderRadius: 8` at `:347, :556`; `6` at `:388, :465, :505, :519, :616, :632`), `var(--paper-elevated)` and `var(--ink-muted)` tokens with hard-coded fallbacks (`:347, :352`), double quotes and a different import style. Nothing else in Helm is rounded.
- The page is a client component that fetches `/api/markets/airdna/<slug>` twice on mount (`:208-233`); no loading state, the "Current data" card reads "No data" until the fetch lands (`:573-580`).
- Mobile: `md:grid-cols-3` collapses to one column; fine.

**Overlap.** The public market pages are the consumer. Nothing in Helm reads the uploaded rows except this card.

**Owner vs staff.** Visible to both. It needs an AirDNA login the company holds once, and the reminder goes to the owner. Staff have no reason to be here.

**Proposals.**
- AirDNA becomes owner-only: add `/marketing/airdna` to `OWNER_PATH_PREFIXES` and `access: 'owner'` on the module, and the reminder text already matches (S).
- The page drops the hero paragraph and the shape explainer; the dropzone says "Drop AirDNA CSVs" and the preview names the shape it found (S).
- Square corners and the house tokens, same as every other page (S).

### /guests (Reviews)

**Purpose.** Every guest review Guesty synced, with a window and filters.

**Entry points.** Growth strip tab Guests (`MarketingTabs.tsx:25`); Guests strip tab Reviews (`GuestsTabBar.tsx:21`); home tile Five-Star Reviews → `/guests?days=30` (`app/page.tsx:391`); `/reviews` redirects here with filters preserved (`app/reviews/page.tsx:13-26`); "See all reviews →" on a guest record (`[id]/page.tsx:136-142`).

**Inventory.** Eyebrow "Helm · Guests", no hero (`app/guests/page.tsx:25-28`). Guests strip. "Window" with 7d / 30d / 90d / 1y links (`ReviewsTab.tsx:202-227`). Stat strip: Total reviews, Five-star, Below five, Avg rating (`:101-126`). Filter form: search, rating select (All / Five-star only / Below five), channel select, property select, Filter, Clear (`:132-172`). List "Reviews" with "N matches" or "showing first 100" (`:176-197`); each row: stars, date, guest name (linked to the record when matched), property, public text, private feedback, channel (`:229-297`). Controls: 4 window links, 1 search, 3 selects, 1 submit, 1 clear link. Read-only otherwise.

**New-hire friction.**
- Default window is 7 days (`ReviewsTab.tsx:73`) while the home tile and the registry's Five-Star stat use 30 (`app/page.tsx:391`). Opening Growth > Guests in a quiet week reads "Total reviews 0 / Five-star 0 / Below five 0 / clean run".
- "clean run" and "review individually" as stat sub-labels (`:117`) are the only hint at what to do with a bad review; there is no action on a row (no link to the Guesty thread, no reply, no "ask" state).
- The list caps at 100 with no next page (`:77, :182`).
- The review-request engine is invisible here (see above).
- Mobile: stat strip and filter bar carry the responsive classes (`:93, :134`); the row grid `120px 1fr auto` (`:251`) squeezes the text column to about 150px on a phone but stays readable.

**Overlap.** Guest record page shows the same reviews per guest (`[id]/page.tsx:130-150`). Home tile shows the 30-day five-star count.

**Owner vs staff.** Identical. No money.

**Proposals.**
- Default window 30d so the landing matches the home tile and never opens on zeros (S).
- Each row shows the ask state from `review_asks` via the bridge: not asked / asked on date / follow-up due / sealed. This is where the engine should be visible (M).
- Reviews becomes its own tab in a single Growth strip and the "Guests" word stops meaning reviews (S, part of the strip merge below).

### /guests/contacts

**Purpose.** The subscriber list behind the Stay Cape Ann emails: who is on it, where they came from, and the doors to import, sync, segment and send.

**Entry points.** Guests strip tab Contacts (`GuestsTabBar.tsx:22`); registry entry Guest Contacts (`helm-modules.ts:613-623`, hidden, search only); the "← Guests" links on the four child pages; `next.config.ts:207-211` redirects `/guests?tab=contacts`.

**Inventory.** Listed under "What a user sees" above. Rows: number, name, email and source line, up to four tag chips with "+N", added-date, raw status word (`contacts/page.tsx:318-401`). After the list, a "Recent Campaigns" peek of five with "All →" (`:259-297`). Footer "Source: Helm · Delivery: Resend" (`:300-313`).

**New-hire friction.**
- The hero sentence names "The Weekly" with no definition; the segments that define it are two clicks away (`:72-76`).
- Seven controls in one bar mix destinations (Campaigns, Segments, Marketing Memory), one-off chores (Import CSV) and a live action (Sync from Guesty) with the same ghost-button styling (`:135-157`); only Import CSV is dark. Sync from Guesty also runs daily by cron (`vercel.json:36-37`), so the button is a duplicate of a schedule with no note saying so.
- "Campaigns (n)" counts `listCampaigns()`, capped at 50 (`lib/guests.ts:114-120`); the number is wrong past fifty.
- "+ Add Contact" is a native `<details>` popover (`AddGuestContactForm.tsx:15-18`) anchored to the right edge; on a phone it is 320px wide at `right: 0`.
- Empty state tells the operator to "Run the migration at supabase/migrations/20260504_create_audience.sql in Helm's Supabase SQL Editor" (`:239-245`).
- Flash banners ride query params (`?imported=`, `?synced=`): a reload or a shared link shows "Imported 186 contacts" again (`:99-130`).
- Tags are raw strings formatted by `formatTagLabel`; `proxy_email`, `insider`, `weekly` need a sentence each and get none.
- Density: before the first contact there are 19 controls and 4 stats.
- Mobile: the stat grid is an inline `repeat(4, 1fr)` without the `rt-helm-stat-strip` class (`:88`), so four tiles share 343px; the action bar wraps into three lines of ghost buttons.

**Overlap.** Recent Campaigns peek duplicates `/guests/campaigns`. New Campaign appears here and on the campaigns index. Segment counts appear here, on `/guests/segments` and in the composer's select.

**Owner vs staff.** Identical. Marketing consent is not money, but every send goes to real guests.

**Proposals.**
- The hero goes; the page opens on the stat strip and the list (S).
- One toolbar with two verbs: "Add contact" and "New campaign"; Import CSV, Sync from Guesty, Segments and Marketing Memory move under a single "Manage list" menu, with Sync showing its last run and that the cron does it daily (S).
- The Recent Campaigns peek goes; Campaigns is one tab away (S).
- The empty state says "No contacts yet. Import a CSV or sync from Guesty." (S).

### /guests/[id]

**Purpose.** One guest's record: status, source, tags, stays, reviews, engagement timeline, unsubscribe.

**Entry points.** Row link from Contacts (`contacts/page.tsx:325-327`); guest name on a review row (`ReviewsTab.tsx:266-273`). URL otherwise.

**Inventory.** Eyebrow link "← Guests" (to contacts), name, email (`[id]/page.tsx:33-49`). Meta strip: Status (raw word), Subscribed, Source, Sent / Opened (`:51-66`). Tags (`:68-89`). "Actions": Unsubscribe (red ghost) or Resubscribe, "Send 1:1 email" (a `mailto:` styled as a button) (`:91-110`). Stays with Upcoming flag (`:112-128`). Reviews with "See all reviews →" (`:130-150`). Timeline: datetime, raw `event_type`, and `k=v` metadata in monospace (`:152-193`). Footer with `id: 8 chars` (`:195-209`). Controls: 2 forms, 1 mailto.

**New-hire friction.**
- The timeline prints `manually_added`, `sent`, `unsubscribed` and `source=helm_ui · by=…` as code (`:176-187`): a log, not a record.
- "Send 1:1 email" opens the operator's own mail client, from whatever identity that is, while every other guest message in Helm goes out from a named line. It looks like a Helm action and is not (`:106-108`).
- Unsubscribe has no confirm and no reason field even though the action reads `reason` (`actions.ts:172`): the form never sends one.
- "Sent / Opened" is `total_sent / total_opened` with no window (`:64`).
- Mobile: four-column meta strip and `180px 1fr` timeline grid, no reflow (`:58, :166`).

**Overlap.** Reviews duplicate the Reviews tab filtered by name. Stays duplicate the property calendar.

**Owner vs staff.** Identical.

**Proposals.**
- The timeline becomes sentences ("Added by dotti@ on Oct 3", "Opened The Weekly vol 12") (S).
- "Send 1:1 email" either sends from the GUESTS rail through Helm or is dropped (S to drop).
- The back link says where it goes: "← Contacts" (S).

### /guests/segments

**Purpose.** The saved audience filters campaigns send to.

**Entry points.** "Segments (n)" on Contacts (`contacts/page.tsx:152-154`). Nothing else.

**Inventory.** Back link "← Guests", heading, the sentence "Saved tag-based filters used as send targets. Edit and creation UI lands with the campaign composer." (`segments/page.tsx:27-31`). Rows: name, description, include chips, `!exclude` chips, status chips, recipient count, "system" or "custom" (`:41-79`). No controls at all.

**New-hire friction.**
- The sentence promises an editor "with the campaign composer"; the composer shipped and the editor did not. A read-only page with a promise is a dead end.
- Empty state: "Run the audience migration to seed defaults." (`:37`).
- Chips are raw tags: `insider`, `!proxy_email`, `subscribed` (`:61-69`).
- Footer "Rising Tide ·Guests· Segments" is missing its spaces (`:92`).

**Overlap.** The composer's "Send to" select lists the same names (`CampaignCreationForms.tsx:116-141`); Contacts shows the count.

**Owner vs staff.** Identical.

**Proposals.**
- Delete the page. The two system segments (Insider List, Weekly Subscribers) are the whole model (`20260507_audience_insider_segments.sql`), and the composer's select can carry the recipient count and the one-line description as option text (S).
- If custom segments are wanted later, the editor goes on the composer, as the page itself says.

### /guests/import

**Purpose.** Upload a Squarespace Profiles CSV into the contact list.

**Entry points.** "Import CSV →" on Contacts (`contacts/page.tsx:135-137`).

**Inventory.** Eyebrow "Helm ·Guests· Import" (missing spaces, `import/page.tsx:17`), hero "Bring the list over." with a four-sentence explainer (`:26-30`), one file input, "Import →", Cancel (`:35-82`), a six-row "What we read" column map (`:85-96`), footer "Squarespace → Helm" (`:99-112`). Controls: 1 file input, 1 submit, 1 cancel.

**New-hire friction.**
- A whole page, hero included, for one file field. The column map is documentation on an operator surface.
- Import is a one-time migration from a system the company left (Squarespace); the page lives on as a first-class dark button on Contacts.
- Errors throw from the server action (`actions.ts:117-126`), so a bad file lands on the Next error boundary, not an inline message.

**Overlap.** Sync from Guesty does the ongoing job.

**Owner vs staff.** Identical.

**Proposals.**
- Fold into Contacts: a file input inside the "Manage list" menu with an inline result line; the column map moves to the Playbook (S).

### /guests/marketing (Marketing Memory)

**Purpose.** Per-home selling points the campaign AI reads when drafting.

**Entry points.** "Marketing Memory" on Contacts (`contacts/page.tsx:155-157`). Nothing else; not in the registry.

**Inventory.** Back link, heading "Marketing memory", a four-sentence explainer (`marketing/page.tsx:36-44`). One `<details>` per Cape Ann home: summary shows name, "On the water" eyebrow, tagline preview or "No memory yet" (`MarketingMemoryEditor.tsx:40-52`); inside, Tagline, Primary selling point, Selling points (one per line), On the water, Sleeps, Bedrooms, Best for, Notes, Save (`:73-116`). Controls: N collapsibles, 8 fields and a Save each.

**New-hire friction.**
- The route name collides with `/marketing`: "Marketing" in the Growth strip is site analytics, "Marketing Memory" under Guests is listing copy. Two things called marketing, neither under the other.
- Every home is collapsed; "No memory yet" tells a new hire nothing about whether it matters.
- The fields duplicate facts the property registry already holds (sleeps, bedrooms) and the property page's Guest & listing tab holds the listing copy. A second place to type "sleeps 8" will drift.
- Reads and writes go through the anon client (`marketing/page.tsx:4, 14`; `marketing/actions.ts:5, 39-41`), unlike every other writer in the cluster, which uses the service role. The RLS posture note says the anon key is public, so `property_marketing` must be open for this to work.

**Overlap.** Property page Facts and Guest & listing; Listing Copy Studio (`helm-modules.ts:333-344`, registered under `group: 'growth'`, `section: 'properties'`).

**Owner vs staff.** Identical.

**Proposals.**
- Move the eight fields onto the property page's Guest & listing tab as "How we sell it", drop Sleeps and Bedrooms (the registry has them), and delete this route (M).
- Until then, rename the button "Selling points" so it stops colliding with Marketing (S).

### /guests/campaigns

**Purpose.** Every newsletter and broadcast, draft or sent.

**Entry points.** "Campaigns (n)" and "All →" on Contacts (`contacts/page.tsx:146-148, 266-268`); "← Campaigns" from the composer pages.

**Inventory.** Back link "← Guests", heading, "New Campaign" dark button (`campaigns/page.tsx:17-39`), the sentence "Newsletters and broadcasts. Composer + send-via-Resend lands next; for now this view shows what's been saved or sent." (`:41-43`). Rows: raw status eyebrow, name, subject, recipient count, sent date or "Open →" (`:53-80`). Footer "Rising Tide ·Guests· Campaigns" (`:93`). Controls: 1 link.

**New-hire friction.**
- The description says the composer is not built. It is (`campaigns/new`, `campaigns/[id]`). A new hire reads this and believes sending is impossible, then finds a red send button on the next page.
- Status is the raw column (`draft`, `sending`, `sent`, `failed`) in small caps.
- No filter, no draft/sent split, limit 50 with no note.

**Overlap.** Recent Campaigns on Contacts.

**Owner vs staff.** Identical, including the ability to reach the send button.

**Proposals.**
- Delete the stale sentence (S).
- Two groups, Drafts and Sent, newest first (S).

### /guests/campaigns/new

**Purpose.** Start a campaign from a brief (the model drafts it) or blank.

**Entry points.** "New Campaign" on Contacts and on the campaigns index.

**Inventory.** Back link "← Campaigns", heading, a two-sentence explainer (`new/page.tsx:20-34`). Form: "What's the campaign about?" textarea with a placeholder and a hint (`CampaignCreationForms.tsx:51-80`); Tone as three radio cards (`:82-110`); "Send to" segment select defaulting to Insider List, with the option "No segment yet (pick later)" and a hint (`:112-145`); "Draft with Helm →" which becomes "Drafting (10 to 20 seconds)" (`DraftButton.tsx:36-39`); Cancel. A collapsed "Or start from a blank draft" with a name field and "Blank draft" (`:155-203`). Controls: 1 textarea, 3 radios, 1 select, 2 submits, 1 collapsible, 1 text field.

**New-hire friction.**
- "Send to" on a page that does not send. The word primes the next page's red button.
- The explainer and three hints say the same thing three ways ("you can refine everything on the next page", "you can edit", "you can change this on the composer").
- The AI failure message names an env var: "Check AI Gateway credentials (AI_GATEWAY_API_KEY) in Vercel env." (`actions.ts:89-92`).
- The draft takes 10 to 20 seconds with a spinner; a failure throws to the error boundary unless `useRecoverableAction` catches it (`CampaignCreationForms.tsx:30-33`).

**Overlap.** None.

**Owner vs staff.** Identical.

**Proposals.**
- Label the select "Audience" and keep "Send to" for the page that sends (S).
- One hint, not four (S).

### /guests/campaigns/[id]

**Purpose.** Edit the draft, preview it, test it, send it; after send, read the numbers.

**Entry points.** Row links from the campaigns index and the Contacts peek; the redirect after drafting (`actions.ts:129, 166`).

**Inventory.** Back link, name, status badge (`[id]/page.tsx:65-82`). When sent: five stats Recipients / Delivered / Opened / Clicked / Unsubs and the send time (`:84-105`). "Send is in flight" notice (`:107-113`), failure reason (`:115-121`), just-drafted flash (`:123-130`), test-sent flash (`:132-139`). Two columns: a form with Working name, Subject, Preheader, From name, From email, "Send to (segment)" with "N recipients match this segment right now", a Send block with "Send test to me" and the red "Send to N recipients →", a helper sentence, Body (Markdown) with a syntax hint, "Save draft" (`:145-276`); and a sandboxed iframe preview (`:278-293`). Controls: 7 fields, 3 submits in one form.

**New-hire friction.**
- The send button sits above the body it sends, between the segment select and the Markdown textarea (`:226-269`): the most dangerous control on the page is in the middle of the form, in red, with no confirm.
- "Both buttons use the latest values in this form. No separate Save click needed." (`:252`) is load-bearing and buried in 11px grey.
- From email is a free text field defaulting to `RESEND_FROM_EMAIL` (`actions.ts:19`); anyone can type any sender.
- Preview says "Save before previewing." (`:267`) while the test button does not need a save: two rules on one page.
- After send, the form stays rendered with every field disabled (`disabled={!isDraft}`, `:156-263`): a page of grey inputs under five stats.
- Mobile: `gridTemplateColumns: '1fr 1fr'` (`:143`) halves the editor and the 720px-tall iframe into about 170px each; no responsive rule exists for it.

**Overlap.** None.

**Owner vs staff.** Identical. Sending to the whole list is the one action in Growth with blast radius, and it is not role-gated.

**Proposals.**
- Send becomes a two-step: a "Review and send" button at the bottom of the form opens a panel that names the segment, the live count, the subject and the from address, and the confirm button repeats the count (S).
- Send is owner-only, or a named duty in `team.ts` like `field_pay`, checked in `sendCampaign` (S).
- A stuck `sending` row can be reset or resumed from the page, and the "will refresh" sentence goes until something refreshes (S).
- The sent view hides the form and shows the rendered email under the stats (S).

### /guests/agreements

**Purpose.** Every bespoke Stay Cape Ann rental agreement and where it is in signing.

**Entry points.** Guests strip tab Agreements (`GuestsTabBar.tsx:23`); registry entry Guest Agreements (hidden, `helm-modules.ts:625-635`); `next.config.ts:213-217` redirect from `?tab=agreements`. No link from a stay, a property, a quote or a messaging card (grep for `/guests/agreements` outside the cluster: none).

**Inventory.** HelmHero "Signed, before they check in." (`agreements/page.tsx:18-23`). Guests strip. "N agreements" and "+ New agreement" (`AgreementsTab.tsx:26-47`). Rows: address, guest, dates, rental fee, status word over kind word (`:66-107`). Empty state: a three-sentence explainer (`:49-63`). Controls: 1 link.

**New-hire friction.**
- No search, no filter by status, newest first, capped at 200 with no note (`:17-21`).
- Statuses are Draft / Sent / Signed / Executed / Voided (`lib/agreement-types.ts:83-89`); "Executed" is a lawyer's word for "both sides signed".
- The flow it belongs to (a direct booking or a custom quote) never links here; the operator has to know the tab exists.

**Overlap.** The quote accept flow on staycapeann.com files its own rental agreement (memory: SCA PR "agreement guest copy"); these are the hand-issued ones for direct and mid-term stays.

**Owner vs staff.** Identical. Rental fee and deposit are guest money, not owner payout.

**Proposals.**
- Rows group by what needs a hand: Waiting on guest, Waiting on us (signed, not countersigned), Done (S).
- An agreement is reachable from the stay: a "Rental agreement" line on the booking or quote that created it (M).

### /guests/agreements/new and /[id]/edit

**Purpose.** Fill in the terms of one agreement.

**Entry points.** "+ New agreement"; "Edit" on the detail page (only before the guest signs, `[id]/page.tsx:107-111`; the edit route redirects once signed, `edit/page.tsx:18-20`).

**Inventory.** Back link, heading, a two-sentence explainer (`new/page.tsx:27-42`). `AgreementForm`: Property (Helm property select with "Custom / not in Helm", Address override, City / State), Agreement kind (two radio cards Short-term / Mid-term with two-line descriptions), Guest (name, email, phone, approved occupants), Stay & money (check-in, check-out, total rental fee, deposit kind select of four with parenthetical law notes, deposit amount, sleeps), Policies (check-in time, check-out time, quiet hours, cancellation select of four, custom cutoff, custom refund), Mid-term dials (five utility checkboxes, four policy checkboxes, all "ignored for short-term"), Bespoke clauses (three to eight title+body pairs), Internal notes, "Create agreement" / "Save changes" (`AgreementForm.tsx:43-228`). About 35 inputs, 11 hints.

**New-hire friction.**
- The mid-term block is always visible, with a hint that it is ignored for short-term (`:165`): nine controls that do nothing for the common case.
- Deposit kind options carry legal distinctions in their labels ("Damage deposit (mid-term, not a MA security deposit)", `:117-122`); nobody on day one knows why.
- "Custom (fields →)" points at two fields on the right that are "Only read when Cancellation is Custom" (`:152-160`).
- Errors throw from `parseAgreementForm` (`actions.ts:77-111`) to the error boundary, losing the form.
- Mobile: `grid3` is `repeat(3, 1fr)` with no reflow (`:236-241`); three inputs in 343px.

**Overlap.** Property address and city are retyped from the registry when "Address override" is used.

**Owner vs staff.** Identical.

**Proposals.**
- Kind first; the mid-term block renders only for mid-term (S).
- Option labels say the choice, hints say the law: "Security deposit" with "Held, returned less deductions" underneath (S).
- Inline validation on the page instead of a thrown error (S).

### /guests/agreements/[id]

**Purpose.** Send the signing link, watch the guest sign, countersign, void.

**Entry points.** Row link; redirect after create/edit.

**Inventory.** Back link, address, status chip, guest line (`[id]/page.tsx:46-67`). Meta strip: Kind, Stay, Rental fee, Deposit (`:69-92`). "Document": Open document (dark, new tab), Copy signing link, Download PDF, Edit, "Executed PDF in Drive ↗" (`:94-117`), the signing path in monospace with "Anyone with the link can view and sign this agreement, so share it only with the guest." (`:118-121`). "Workflow", three rows with green ticks: send ("Email signing link" / "Resend email", "Mark as sent", or "Add a guest email (Edit) to send from Helm, or copy the link and text it."), guest signs ("Guest signs at the link (typed-name signature, ESIGN/UETA audit trail)"), countersign ("Countersign as Allie", "Countersign to execute (emails the final PDF + archives to Drive)") (`:124-186`). "Danger zone": "Void agreement" with "Kills the signing link…", or "Voided <date>. The signing link is dead." with "Restore" (`:188-213`). "Audit" in monospace `signed_name:`, `signed_at:`, `ip:` (`:215-240`). Controls: 5 document links/buttons, up to 3 workflow forms, 1 void/restore form.

**New-hire friction.**
- The words: Executed, Countersign, Void, Restore, ESIGN/UETA, Danger zone. Only "Danger zone" is a warning; the rest are legal terms with no plain line beside them except in the workflow sub-labels.
- "Countersign as Allie" signs the document as Allie O'Brien (`lib/agreement-base.ts:50`) for whoever is logged in; the action checks only a session (`actions.ts:314-316`). Delaney can execute a contract in Allie's name with one click.
- "Void agreement" renders whenever `voided_at` is null (`:191-212`), including on an executed, Drive-archived agreement, and `voidAgreement` writes `voided_at` with no state check and no confirm (`actions.ts:389-399`); `agreementStatus` then reads it as Voided because voided wins over executed (`lib/agreement-types.ts:76-77`). The quotes module got this right (`quotes/actions.ts:584-596` refuses an accepted quote); agreements did not.
- Two ways to say "sent": emailing from Helm or "Mark as sent" after texting the link by hand (`:135-154`). Fine, but the second has no field for where it went.
- "Open document" opens `/guests/agreements/<id>/doc` in a new tab: a dark-background paper sheet (`AgreementDocument.tsx:341`) with no Helm chrome and no way back (`doc/page.tsx:15-20`).
- The audit block is snake_case (`:222-227`).
- Mobile: four-column meta strip, no reflow (`:76`). The document itself reflows below 880px (`AgreementDocument.tsx:680-700`); good.

**Overlap.** Download PDF and Executed PDF in Drive are the same document at two stages.

**Owner vs staff.** Identical today. Countersigning a legal document should be an owner act, or at least the act of the person it names.

**Proposals.**
- Countersign is owner-only via `requireOwnerEmail()`, and the button names the signer from the session, with the host name on the document following the signer or staying Allie by explicit choice (S).
- Void refuses an executed agreement and asks once before killing a sent link; "Danger zone" becomes "Cancel this agreement" (S).
- The workflow rows become the page: each row carries its one verb, the Document buttons sit under them, and the audit block reads as two sentences (S).
- The doc preview keeps the Helm masthead on screen and hides it in print (S).

### /guests/quotes (owner-only)

**Purpose.** Every custom Stay Cape Ann quote and where it is: draft, sent, opened, accepted, balance.

**Entry points.** Guests strip tab Quotes (`GuestsTabBar.tsx:24`, shown to staff too); registry Custom Quotes (owner, `helm-modules.ts:625-636`); "Send a price" and the quote context block on messaging cards (`app/messaging/MessagingQueue.tsx:381-391, 1054, 1126`); `lib/rental-inquiry.ts:34` builds the same link for the inquiry panel.

**Inventory.** HelmHero "Quoted, then booked." (`quotes/page.tsx:17-22`). Guests strip. "N quotes" and "+ New quote" (`QuotesTab.tsx:22-40`). Rows: listing title over internal name, guest or "No guest yet", dates and nights, total with "N% deposit", status word with "balance open" (`:61-115`). Empty state: a four-sentence explainer (`:43-58`). Controls: 1 link.

**New-hire friction.**
- Staff see the tab and bounce to `/not-available` (`lib/helm-access.ts:78`, `proxy.ts:272-274`). The not-available page says "The nav never links there for staff" (`app/not-available/page.tsx:8-9`); this tab does.
- No filter; the list is newest-first and capped at 300 (`lib/sca-quotes.ts:61`) with no note. Live work (sent, accepted with a balance) sits among expired and voided rows; the status colour is the only cue.

**Overlap.** Messaging cards show the guest's quotes in a context block.

**Owner vs staff.** Owner-only route; the tab is not.

**Proposals.**
- The Quotes tab renders only for owners: `GuestsTabBar` reads `useHelmRole()` (`components/useHelmRole.ts`) the way the masthead does (S).
- Rows group by Needs a hand (sent and unopened past three days, accepted with balance due, accept failed), Open, Settled (S).

### /guests/quotes/new and /[id]/edit (owner-only)

**Purpose.** Compose the price for one stay. Saving sends nothing.

**Entry points.** "+ New quote"; "Send a price" on messaging cards with property, dates, party size, name, email and phone prefilled (`new/page.tsx:28-48`); "Edit" on the detail page.

**Inventory.** `QuoteComposer.tsx` is 1,032 lines, nine blocks in a two-column layout with a sticky "What the guest sees" summary on the right (`:325, :648-672`):
1. Property: one select; disabled options say "not on Stay Cape Ann yet" or "Guesty listing not sold on Stay Cape Ann" (`:328-346`).
2. Stay: check-in, check-out, guests, the night count, the button "Check dates and pull Guesty's price" / "Check again", a stale warning, then the availability note, up to two override checkboxes ("Book these nights anyway. Never books over an existing reservation.", "Ignore the minimum-night rule"), and a reference box "For reference, never shown to the guest" with Guesty's price, last year's achieved nightly, and "Use Guesty's $X/night" (`:348-402`, `:679-768`).
3. Price: nightly, accommodation total (two views of one number), cleaning, extra lines (label + amount + Remove, "+ Add a line"), discount label, discount, occupancy tax checkbox with the rate (`:404-500`).
4. Payment plan: two radio cards, then deposit mode (Percent / Amount), deposit value, balance due by, the split readout (`:502-564`).
5. Guest: first, last, email, phone (`:566-585`).
6. Message to the guest, with a hint about greetings (`:587-595`).
7. Terms: expiry (datetime-local, default 7 days), cancellation terms textarea, "Reset to the default wording" (`:597-630`).
8. Internal notes (`:632-634`).
9. "Save quote" / "Save changes" and "Saving does not send anything. The detail page has the send buttons." (`:636-644`).

About 24 inputs, 4 to 8 buttons depending on state, 13 hint strings, one server round trip before save.

**New-hire friction (for the owner who uses it daily).**
- Length. A prefilled quote from a card still walks nine blocks top to bottom; the fields that are already known (Guest) sit fifth, below Payment plan.
- The send decision lives on the next page (`:642`). The memory notes record the operator not understanding the two-button card this replaced; the composer solved the card and moved the question one page later: Email quote / Text quote / Email + text / Mark as sent (`[id]/page.tsx:203-238`).
- Two numbers for one price (nightly, total) with an "anchor" rule explained in a hint (`:404`).
- Default expiry of 7 days is wrong for a 2027 stay under negotiation; the memory records a $33k quote expiring with the guest's question unanswered.
- Mobile: `gridTemplateColumns: 'minmax(0, 1fr) 340px'` (`:325`) leaves the form column a few pixels wide at 375px; no responsive rule. The composer is unusable on a phone.

**Overlap.** None; it is the one door for custom pricing.

**Owner vs staff.** Owner-only.

**Proposals.**
- Order by what the operator knows first: Guest, Stay, Price, Plan, Terms; Internal notes and the expiry sit in a short "Options" row at the end (S).
- Expiry defaults to 14 days, or to 30 for a check-in more than six months out (S).
- "Save and email", "Save and text" beside "Save only", with the same guards the detail page has, so the common case is one page (M). Nothing goes out without a named rail.
- A single-column layout under 880px with the summary at the bottom (S).

### /guests/quotes/[id] (owner-only)

**Purpose.** Send the quote, watch the guest open and accept it, chase the balance, and recover when staycapeann.com could not finish.

**Entry points.** Row link; redirect after save; the messaging card's quote block.

**Inventory.** Header with title, status chip, internal name, guest line with source (`[id]/page.tsx:60-83`). Meta strip: Stay, Guests, Total, Plan (`:85-108`). "Guest link": Copy guest link, "Open guest page ↗", Edit, Duplicate, the URL, and a sentence about drafts reading as not found (`:110-133`). "Price" breakdown with Guesty's reference and the override notice (`:135-173`). "Workflow", four rows: send (edited-since-send warning, expired + Extend with a days input, Email quote / Resend email, Text quote, Email + text, Mark as sent, "Good through… Extend"), guest opens (views, declined reason), accepted (reservation ids in monospace, Guesty mismatch banner, accept-error banner, "Mark accepted manually" with three inputs shown on every sent quote), balance (Send balance reminder, Mark balance paid with a note) (`:175-368`). Note and terms (`:370-386`). "Danger zone": Void quote / Restore, or the accepted sentence (`:388-418`). "Audit": about twenty snake_case rows (`:420-453`). Controls: up to 14 forms and buttons.

**New-hire friction.**
- The manual escape hatch ("Mark accepted manually", confirmation code, reservation id, note) renders on every sent quote, not only after a failure (`:305-322`): three inputs the normal path never needs.
- Two Extend forms on one page depending on state (`:196-201, :243-248`).
- The Audit block prints `guesty_listing_id`, `terms_version`, `accept_ip` and the raw `status` with "(reads as expired)" (`:423-446`): debugging on the operator's page.
- Mobile: four-column meta strip, no reflow (`:92`).

**Overlap.** Messaging quote block shows status and amount due.

**Owner vs staff.** Owner-only.

**Proposals.**
- The manual-accept form shows only after an accept error or when the operator opens "The guest paid but Helm did not hear" (S).
- Audit becomes three sentences (created, sent, opened/accepted) with a "Show ids" disclosure for the Guesty and Stripe references (S).

### /reviews

**Purpose.** A redirect to `/guests` that forwards `days`, `rating`, `channel`, `property`, `q` (`app/reviews/page.tsx:13-26`). Fine. Keep it.

### /competitors and /competitors/[id]

**Purpose.** Who else manages Cape Ann rentals, their inventory, and research into which homes they manage and who owns them.

**Entry points.** Growth strip tab Competitors (`MarketingTabs.tsx:26`); Cmd+K (`helm-modules.ts:641-653`). Nothing else.

**Inventory, index.** HelmHero "Who else manages Cape Ann." with a description reading "N competitors tracked, N listings, N guest beds. Helm-native" followed by an em dash and "refreshed by snapshot." (`competitors/page.tsx:27-32`). One row per competitor: number, name, tagline, four cells (Listings, Avg beds, Total sleeps, Pet OK), top towns, "View inventory →" (`:62-155`). A closing paragraph beginning "Phase 1 is inventory only" (em dash) "bedroom counts, bathrooms, sleeps, towns, and pet policy. Phase 2 will add nightly availability and ADR sampling" and ending "Add a competitor by dropping a new file under src/lib/competitors/ and registering it in the index." (`:44-54`). Controls: row links only.

**Inventory, detail.** "← All competitors", hero with "Snapshot <date>" in the eyebrow (`[id]/page.tsx:36-57`). Five stats (`:59-80`). "Address research" card: a percentage "matched to a place", a coverage bar, and a legend of verified / street known / neighborhood guess / not yet researched / owners identified (`:82-116`). "By town" and "By bedroom count" bar lists (`:118-139`). "Browse listings →", "Their homepage →", "Sync inventory now" (`:141-148`). "Recent changes" with NEW / DROPPED / RETURNED / CHANGED / RENAMED chips and "Last sync · 3d ago", or an empty state naming "the weekly cron runs Sunday 8am UTC" (`RecentChanges.tsx:14-45`). "Inventory": search, Town chips, Pets chips, Address chips (All / Verified / Street / Hood / Unknown), "N of M", a nine-column sortable table (Listing, Address with chips "✓ YOU" / VERIFIED / STREET / HOOD and "owned by …", Town, BR, BA, Sleeps, Pets, View →, ✎) (`CompetitorInventory.tsx:93-294`). The ✎ opens an inline "Verify address" form: Full address, Street, Neighborhood, Owner of record (per VGSI), Owner note, Source / evidence, "Open VGSI for <town> →", Save verified address, Cancel, Remove verification (`AddressEditor.tsx:84-243`). Controls: 3 chip groups (up to 12 chips), 1 search, 6 sort headers, 1 sync button, per row 1 link and 1 edit toggle, 6 fields and 3 buttons in the editor.

**Live or parked.** The machinery is live: a weekly cron at Sunday 08:00 UTC (`vercel.json:32-33`), a manual sync that diffs listings and records events, a DB overlay for verified addresses. Two competitors are registered (`lib/competitors/index.ts:11-14`: Atlantic Vacation Homes, Shoreway Management) while the registry description still says "Phase 1 starts with Atlantic Vacation Homes" (`helm-modules.ts:644`) and the page still calls itself Phase 1 and tells the reader to add competitors by editing `src/lib/competitors/`. Whether anyone opens it cannot be read from source; the brief's 132 visits for all of Growth says not often. Call it live by machinery, parked by attention.

**New-hire friction.**
- The address research is prospecting: find the owner of a competitor-managed home (VGSI owner of record, evidence) so Rising Tide can pitch them. Everywhere else in Helm the prospect funnel is owner-only (`OWNER_PATH_PREFIXES` has `/prospects`, `/projections`, `/properties/prospects`). Here it is a staff-visible tab.
- Developer instructions and cron times printed on the page (`page.tsx:53`, `RecentChanges.tsx:35`).
- Chip vocabulary "HOOD", "✓ YOU", "STD" for studio (`CompetitorInventory.tsx:216, :365-367`).
- The sync result line prints competitor ids: "atlantic-vacation-homes: +2 · −1" (`SyncNowButton.tsx:72-89`).
- Two em dashes in page copy (`page.tsx:31, :53`).
- Mobile: a nine-column fixed grid (`CompetitorInventory.tsx:20`), a `160px 1fr 220px` coverage card (`[id]/page.tsx:90`), five stat columns (`:66`), two-column breakdowns (`:121`): none reflow.

**Overlap.** The prospect deck's evidence slide and the AirDNA comps are the other market views, both owner-side.

**Owner vs staff.** Visible to both; should be owner work.

**Proposals.**
- Competitors leaves the Growth strip and becomes owner-only, reached from Prospects, where the owner-of-record research belongs (S for the move, M to link each verified home to a prospect record).
- The page copy drops the phase narrative and the file instructions; the sync result names competitors, not ids (S).
- If it stays parked, mark it `status: 'parked'` so it renders dimmed and sorts last (S).

---

## The five biggest structural problems

1. **Growth lands on analytics and stacks three tab rows and a hero before any work.** Staff tap Growth and get a GA4 mirror with six tooltips (`lib/helm-modules.ts:524-533`, `app/marketing/page.tsx:58-128`). Under Guests, the masthead, the Growth strip, a hero and the Guests strip stack before a stat strip, a seven-button bar and a filter row (`app/guests/contacts/page.tsx:58-220`). The strips are hand-rendered per page, not by a layout, so the second strip appears on 4 of 18 Guests routes and moves vertically between siblings (`app/guests/page.tsx:25-29` vs `agreements/page.tsx:18-24`).

2. **"Guests" means five things and the back links disagree with the tab.** The strip tab lands on Reviews, the registry describes subscribers, the child pages' "← Guests" goes to Contacts, and the strip adds Agreements and Quotes (`MarketingTabs.tsx:25`, `helm-modules.ts:598-608`, `[id]/page.tsx:35`, `GuestsTabBar.tsx:21-24`). A new hire cannot predict where "Guests" goes.

3. **The campaign send is one unconfirmed click, pre-armed, for anyone with a login.** AI drafts arrive with subject, body and the everyone-segment filled (`campaigns/actions.ts:95-122`); the red button is live in the middle of the form with no confirm and no role check (`campaigns/[id]/page.tsx:232-250`, `actions.ts:279-281`); a stuck send has no recovery (`actions.ts:310-318`, `page.tsx:107-113`).

4. **Legal-document actions are unguarded.** Any session countersigns as Allie O'Brien (`agreements/[id]/page.tsx:181`, `actions.ts:314-316`, `lib/agreement-base.ts:50`); any executed agreement can be voided with one click and no state check (`page.tsx:191-212`, `actions.ts:389-399`, `lib/agreement-types.ts:76-77`).

5. **Operator surfaces carry developer copy, raw audit dumps and a second design language.** Migration paths and cron times in empty states (`contacts/page.tsx:239-245`, `segments/page.tsx:37`, `RecentChanges.tsx:35`), "lands next" promises on shipped features (`campaigns/page.tsx:42`, `segments/page.tsx:30`), file-system instructions (`competitors/page.tsx:53`), snake_case audit blocks (`agreements/[id]/page.tsx:222-227`, `quotes/[id]/page.tsx:423-446`, `guests/[id]/page.tsx:176-187`), and a rounded-card AirDNA page with its own tokens (`airdna/page.tsx:347-352`).

## Vocabulary a new hire meets here

| Term | Meaning (from the code) | Defined in the UI? |
|---|---|---|
| Growth | The masthead label for the Marketing module (`helm-modules.ts:529`) | No |
| Marketing | Site analytics on `/marketing`; also "Marketing Memory" under Guests | No; the collision is unexplained |
| Guests | Reviews, subscribers, contacts, agreements or quotes depending on page | No |
| Reviews, Window, Five-star, Below five | Guesty-synced reviews over 7/30/90/365 days (`ReviewsTab.tsx:26-27`) | Partly (stat labels) |
| Private feedback | The channel's host-only note (`feedbackLabel`) | Label only |
| Subscribers, Contacts, Bounced, Pending | `audience_contacts.status` values | No; raw words |
| The Weekly, Insider List, Weekly Subscribers | Two seeded segments: everyone subscribed, and the editorial opt-in (`20260507_audience_insider_segments.sql`) | No |
| Segment | A saved tag filter used as a send target (`segments/page.tsx:30`) | One sentence |
| Tags, proxy_email, insider, weekly | Array column on a contact; `proxy_email` marks Booking.com relay addresses (`actions.ts:31, 75`) | No |
| Campaign, Draft, Sending, Sent, Failed | `audience_campaigns.status` | No; raw words |
| Brief, Tone (Editorial / Insider / Warm) | Inputs to the AI draft (`lib/ai/brand-voice`) | Tone cards carry a line each |
| Preheader | Inbox preview text | Yes (`page.tsx:172`) |
| Marketing Memory | Per-home selling points the campaign AI reads | One paragraph |
| Agreement, Short-Term, Mid-Term | Guest rental agreement kinds (`agreement-types.ts:91-94`) | Radio cards carry a line each |
| Security / Damage / Hold deposit | Three legal deposit characterizations | Option labels only |
| Sent, Signed, Executed, Voided | Agreement lifecycle (`agreement-types.ts:73-89`) | No |
| Countersign | Staff signing after the guest, which emails the PDF and archives to Drive | Workflow sub-label |
| ESIGN / UETA, Certificate of Completion | Electronic-signature law and the audit page | No |
| Quote, Sent, Accepted, Declined, Expired, Voided | `sca_quotes` lifecycle (`sca-quotes-types.ts:148-155`) | No |
| Split plan, Deposit, Balance, Balance due by | Two-charge payment plan when check-in is 60+ days out | Radio card text |
| Check dates, Reference, Achieved nightly | The composer's one round trip: calendar, Guesty's price, last year's rate | Hints |
| Override calendar / terms | Book closed or unreleased nights; ignore min-nights | Checkbox text |
| Pre-release, unreleased | 2027 dates not yet open on SCA | No |
| Tax exempt | No occupancy tax over 31 nights | Hint |
| Mark as sent, Mark accepted manually, Duplicate, Extend, Restore | Escape hatches on the detail pages | Partly |
| AirDNA, Market Metrics Monthly, single-metric export | Comp data vendor and its CSV shapes | Paragraph |
| Competitor, Snapshot, Inventory | A scraped listing roster and its dated diff | Eyebrow |
| VGSI, Owner of record, Evidence | Massachusetts assessor database and the research fields | Placeholders |
| Verified / Street / Hood / Unknown, ✓ YOU | Address confidence levels | No |
| Sessions, Users, New users, Conversions, LCP, INP, CLS | GA4 and Speed Insights metrics | Tooltips |

## Pages to merge, demote or delete

- **Demote Growth to More for staff.** Keep it a masthead tab for owners. Needs a visibility flag distinct from `access: 'owner'` (see verdict).
- **Merge the two strips into one.** Marketing / Reviews / Contacts / Agreements / Quotes / Competitors as one `SectionTabs` strip rendered by a Growth layout, role-aware so staff never see Quotes. The heroes on Contacts, Agreements and Quotes go with it.
- **Delete `/guests/segments`.** Two system segments; the composer's select carries them.
- **Delete `/guests/import` as a page.** A file input under "Manage list" on Contacts.
- **Move `/guests/marketing` onto the property page** as "How we sell it" and retire the route; the name collides with `/marketing`.
- **Delete the Recent Campaigns peek** on Contacts.
- **AirDNA to owner-only** and off the staff Marketing page.
- **Competitors to owner-only under Prospects**, or `status: 'parked'`.
- **Keep** `/reviews` (redirect), the guest record, the agreement and quote detail pages.

## Plain bugs

1. **Staff see the Quotes tab and bounce.** `GuestsTabBar.tsx:24` lists Quotes for every role; `lib/helm-access.ts:78` gates `/guests/quotes`; `proxy.ts:272-274` redirects to `/not-available`, whose copy claims "The nav never links there for staff" (`app/not-available/page.tsx:8-9`).
2. **"Send a price" on messaging cards is not role-gated** and links staff into the same bounce (`app/messaging/MessagingQueue.tsx:381-391`; no `useHelmRole` in that file). Outside this cluster, lands in it.
3. **Add Contact silently re-subscribes.** `manuallyAddContact` upserts on email with `status: 'subscribed'` and `marketing_consent: true` (`guests/actions.ts:265-283`) and mirrors to Resend (`:288-292`), so adding an address that had unsubscribed or bounced flips it back with no warning.
4. **An executed agreement can be voided, then restored.** `voidAgreement` has no state check and no confirm (`agreements/actions.ts:389-399`); the button renders on executed rows (`[id]/page.tsx:191-212`); `agreementStatus` reads voided before executed (`lib/agreement-types.ts:76-77`).
5. **Countersign has no role check and names a fixed signer** (`agreements/[id]/page.tsx:181`, `actions.ts:314-316`, `lib/agreement-base.ts:50`).
6. **A campaign stuck in `sending` has no recovery** and the page promises a refresh that does not exist (`campaigns/[id]/page.tsx:107-113`; lock at `actions.ts:310-318`; no AutoRefresh import; no `maxDuration` under `app/guests`).
7. **Stale copy.** "Composer + send-via-Resend lands next" (`campaigns/page.tsx:42`); "Edit and creation UI lands with the campaign composer" (`segments/page.tsx:30`); "Phase 1 starts with Atlantic Vacation Homes" with two competitors registered (`helm-modules.ts:644` vs `lib/competitors/index.ts:11-14`); the Phase 1 / Phase 2 paragraph with file-system instructions (`competitors/page.tsx:53`).
8. **Developer copy on operator surfaces.** Migration path in the Contacts empty state (`contacts/page.tsx:239-245`); "Run the audience migration" (`segments/page.tsx:37`); cron time (`RecentChanges.tsx:35`, `Charts.tsx:36`); env var in an error (`campaigns/actions.ts:89-92`); "Save to database" (`airdna/page.tsx:509`).
9. **Em dashes in UI copy** against house style: `Charts.tsx:36`, `competitors/page.tsx:31, 53`, `airdna/page.tsx:487`, and the guest-facing certificate title (`AgreementDocument.tsx:211`).
10. **Missing spaces in footers and eyebrows**: "Rising Tide ·Guests· Segments" (`segments/page.tsx:92`), "Helm ·Guests· Import" (`import/page.tsx:17, 107`), "·Guests· Campaigns" (`campaigns/page.tsx:93`).
11. **"← Guests" links go to Contacts, not the Guests tab** (`[id]/page.tsx:35`, `segments/page.tsx:18`, `campaigns/page.tsx:18`, `marketing/page.tsx:37`).
12. **Flash banners persist in the URL**: `?imported=`, `?synced=` on Contacts (`contacts/page.tsx:99-130`); `?drafted=1`, `?test_sent=` on a campaign (`[id]/page.tsx:30-31, 123-139`). A reload says "Test sent to …" again.
13. **"Campaigns (n)" is capped at 50** (`contacts/page.tsx:147`, `lib/guests.ts:114-120`).
14. **Lists cap silently**: agreements at 200 (`AgreementsTab.tsx:21`), quotes at 300 (`lib/sca-quotes.ts:61`), with no "showing first N" unlike Reviews and Contacts.
15. **No phone layout** for the quote composer (`QuoteComposer.tsx:325`), the agreement form (`AgreementForm.tsx:236-241`), the campaign editor (`campaigns/[id]/page.tsx:143`), the competitor table and detail grids (`CompetitorInventory.tsx:20`, `competitors/[id]/page.tsx:66, 90, 121`), and the four-column meta strips on Contacts, the guest record, the agreement and the quote (`contacts/page.tsx:88`, `[id]/page.tsx:58`, `agreements/[id]/page.tsx:76`, `quotes/[id]/page.tsx:92`). `globals.css` has no rule for any of them.
16. **Marketing Memory reads and writes through the anon client** (`guests/marketing/page.tsx:4, 14`; `marketing/actions.ts:5, 39-41`), the only writer in the cluster that does; the RLS posture note says the anon key is public.
17. **"Helm will text you" on AirDNA texts the owner's phone**, not the reader (`airdna/page.tsx:596-599`; CLAUDE.md, Team notices).
18. **Unsubscribe reads a `reason` the form never sends** (`guests/actions.ts:172`, `[id]/page.tsx:96-99`).
