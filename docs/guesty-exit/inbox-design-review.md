# Calderwood inbox: reference review and next design pass

Research date: September 29, 2026, America/New_York. Reviewed implementation: `b5de6d49` on `codex/calderwood-design`. This is a design brief, not evidence of production readiness or approved channel migration.

## Decision

Keep a familiar guest conversation workspace. Use Front for the organization of the inbox, Linear for consistent hierarchy and alignment, Attio for structured guest and reservation context, and Superhuman for focused scanning. Guesty's supplied screenshots remain the domain reference for stay dates, property identity, channel and message provenance.

The next improvement should remove competing information and inconsistent styling. Further blanket reductions in padding or font size are unlikely to resolve the user's objection. The implementation below is a hypothesis to verify in the rendered interface, not a claim that a particular product's styling will solve Helm's problem.

## What was actually reviewed

Public first-party documentation was read for Front, Linear, Intercom, Attio, Superhuman and Mews. Published Front and Linear product screenshots were visually inspected in the browser. Intercom, Attio, Superhuman and Mews findings below are documentation-based; their full working interfaces were not tested. Direct image endpoints for Attio and Intercom were blocked, and were not bypassed. The Linear redesign article is from March 2024; it is a design-process reference, not evidence of Linear's exact September 2026 interface.

Helm evidence is the user's supplied screenshots and source inspection of the current branch. Browser policy still prevents viewing the local Helm preview. Passing code tests, contrast calculations or a synthetic build cannot substitute for looking at the rendered UI.

## Reference findings

| Reference | Observed or documented pattern | Application to Helm | Boundary |
| --- | --- | --- | --- |
| [Front's inbox refresh](https://help.front.com/en/articles/3889728) | Compact conversation header; expandable metadata; collapsible navigation; visible filters and explicit work states. Published screenshots distinguish the selected conversation while ordinary rows remain quieter. | One clear conversation identity, one concise stay summary, and secondary metadata behind details. Search and filter state belong beside the list they affect. | Do not copy its full support sidebar or crowded expanded tag strip. Open/Later/Done would require reliable workflow state Helm does not yet have. |
| [Linear's redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) | Navigation, content and properties have different visual weight. The team discusses alignment, neutral surfaces and testing complete views and states. The inspected full interface uses subdued panel divisions and a compact selected row. | Align list and thread headers, use a small set of neutral surfaces, and judge long/sparse/error views together. Put color where it communicates selection, sender or a real exception. | Do not imitate its tiny issue metadata or assume an issue-tracking row is a good guest-message row. Preserve readable hospitality messages. |
| [Intercom Inbox](https://www.intercom.com/helpdesk/inbox) and [Inbox guide](https://www.intercom.com/help/en/articles/6258745-the-inbox-explained) | Conversation history, customer context and actions share a workspace. The documentation describes an expandable context sidebar, keyboard access and a table overview for managers. | Keep the message thread primary. Make reservation context easy to reveal without navigating away. Preserve clear sender and automated-message distinctions. | Its AI panels, assignment tools, composer and integrations are capabilities, not visual decorations to copy into a read-only pilot. |
| [Attio record pages](https://attio.com/help/reference/managing-your-data/records/configure-record-pages) | Attributes, relationship tabs and record sections can be organized around the object being viewed. | Use one stable reservation facts section with labels and values. Keep guest, stay and source evidence conceptually distinct. A date discrepancy belongs beside dates. | Do not repeat full booking details in the list, header and inspector. Do not introduce a configurable CRM or arbitrary extra tabs. |
| [Superhuman Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox) | A small set of intentional sections supports focused processing, with counts and keyboard navigation. | Keep the pilot's supported stay filters predictable and easy to scan. Preserve selection and search while inspecting a conversation. | A stay-state filter is not a response-priority queue. Do not label conversations unread, urgent or awaiting reply without trustworthy data. |
| [Mews reservation management](https://www.mews.com/en-gb/products/reservation-management) | Reservation work is organized around a timeline and operational context. | Keep arrival, departure, nights and property easy to reach from the inbox; retain exact reservation links. | Mews's live availability and rate operations do not establish that Helm's imported calendar is authoritative. No connector or provider recommendation is made here. |

Additional rationale: [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports moving less frequent details out of the primary view. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) sets a 24 CSS pixel minimum with specified exceptions. For this pilot, prefer larger touch hit areas rather than shrinking controls to achieve density.

### Visual references inspected

- [Front navigation and conversation selection](https://usw1.frontkb-cdn.com/attachments/11/1/5d6d107c-3768-448a-9aee-b90590ec381d.png). Reference the relative hierarchy and ordinary-row treatment. The red annotation boxes are documentation marks, not product UI.
- [Front expanded conversation header](https://usw1.frontkb-cdn.com/attachments/11/1/088e88a5-d428-4a0c-af71-642fef5705f7.png). Reference the ability to disclose details, not the number of tags displayed in this example.
- [Linear full interface after its redesign](https://webassets.linear.app/images/ornj730p/production/9b91020243984487b4e0cbe72278dd1acd7f9c57-2352x1380.png?auto=format&dpr=2&q=95). Reference panel hierarchy, alignment and selective emphasis. This is a historical published example.

## Current Helm diagnosis

These are source-supported findings and design judgments, not a fresh browser review of `b5de6d49`.

1. **Styling has accumulated without a firm scale.** `inbox.module.css` contains 14 distinct pixel font sizes, from 8 to 25, and 119 distinct hexadecimal color literals, including alpha variants. These counts do not prove bad design, but they make coherent refinement harder. Tiny text and near-identical neutral colors deserve consolidation.
2. **Too many visual boundaries compete.** The inset work surface, active row shadow, bordered bubbles, status pills and button shadows each make sense separately. Together they can make a small panel feel assembled from boxes. Remove a boundary when alignment and space already identify the group.
3. **Reservation context is repeated.** The selected guest, channel, dates, status and reference appear in combinations across the row, conversation header and reservation pane. The header should answer who/where/when; the inspector should hold the fuller record and evidence.
4. **The details pane appears abruptly at 1380px.** Below that breakpoint it becomes a dialog; above it the pane is compulsory and its toggle disappears. Give the operator control and preserve a minimum useful message width. Crossing a breakpoint should not unexpectedly close an active inspector or lose focus.
5. **Density is partly achieved through tiny metadata.** Some timestamps, avatars and footer text remain 8-10px. Raise supporting text to a consistent 11-12px where practical; recover space through simpler content and fewer stacked bars.
6. **The single-property scope is repeated in the interface.** The global property identity should be sufficient for list rows while the pilot contains only Calderwood. Future multi-property rows will need property identity again; do not lose that requirement when generalizing later.
7. **The synthetic scene can mislead.** A six-message conversation looks richer than a one-message thread even with identical CSS. Sparse conversations must still look intentional. Never pad a live conversation with invented content.
8. **Perceived speed needs its own review.** Selection uses a router transition. The current code preserves content and exposes a pending indicator, but actual delay, focus and scroll behavior have not been measured in the browser. Do not claim the interface feels fast because a build succeeds.

## Chosen direction

One restrained operations workspace, with a useful conversation list and a generous reading area. Preserve Helm's identity; concentrate it in the application navigation and active state. Use neutral text and surfaces throughout the working area.

The recurring visual hierarchy should be: guest and last message first; stay context second; source and synchronization evidence third. Data problems remain visible when they affect interpretation. The pilot remains explicitly read-only, but the same warning does not need to be repeated in every region.

### Screen composition

- **Application bar:** keep the compact 48px height established in v9. Use one property identity and supported navigation. Avoid another shell rewrite as the first step.
- **Conversation list:** target 280-320px at ordinary desktop widths. Use predictable text alignment, a quiet selected surface and minimal row chrome. Keep guest name, preview, channel and dates; avoid decorative avatars competing with names. Use genuine counts only.
- **Conversation header:** target roughly 72-88px including stay context. Guest identity and controls share the first line. One secondary line holds channel and compact stay dates. Full confirmation code belongs in details unless needed to distinguish otherwise identical threads.
- **Message thread:** 14px body text with a comfortable line-height; a bounded reading width. Keep sender labels and timestamps legible. Use sender grouping where accurate, without hiding attribution or breaking chronological order. Automated content stays expandable and searchable. Avoid a shadow on every message.
- **Reservation context:** show a concise stay summary and a structured label/value list. Reveal the full inspector on demand; an open inspector may dock when enough width exists and become a dialog at smaller sizes. Maintain one content implementation. Date mismatch evidence must remain visible.
- **Read-only action:** a single clear route to existing guest messaging, with an honest read-only explanation. Do not draw a disabled fake composer or suggest this view can send.

### Proposed design rules to validate

These are Helm targets, not dimensions measured from another product.

| System | Rule |
| --- | --- |
| Typography | 20px view title, 16-18px selected identity, 14px message body, 13px list name, 12px previews/controls, 11px secondary metadata. Prefer weights 400, 500 and 600. Make exceptions deliberate. |
| Spacing | Base steps 4, 8, 12, 16, 24. Let line-height and grouping do the work. Keep optical exceptions documented rather than forcing every value into a grid. |
| Surfaces | Workspace, list and conversation surfaces; use additional elevation for a floating dialog only. Avoid nested decorative cards. |
| Color | Named scoped tokens for text, secondary text, divider, surface, selected state, guest/team content and warnings. Preserve channel identity with text as well as color. Check contrast on actual backgrounds. |
| Corners | Small controls around 6px, message and selected surfaces around 8px, dialog around 12px. Circular identity marks remain circular. These are initial targets, not a universal border-radius rule. |
| Icons | One stroke style; 16px common controls and 14px inline metadata. Do not use a custom symbol when a familiar label is clearer. |
| Interaction | Visible hover/focus/pressed/disabled states. Respect reduced motion. Add no animation unless it explains a transition. Preserve native links, modifier-click and browser history. |
| Responsive layout | Design explicitly for the user's approximately 760px side panel as well as a full window. At 390px, use list/detail navigation with a clear back action. Avoid crushing both into two narrow columns. |

## Implementation order

1. **Consolidate and simplify:** introduce pilot-scoped tokens and a deliberate type scale; flatten unnecessary borders/shadows; align headings and row baselines. Preserve the existing data model and navigation behavior.
2. **Clarify information hierarchy:** remove redundant reservation facts from the header when the same facts are visible in context. Keep one concise stay summary and a reliable details control. Make the context pane user-controlled with correct responsive focus behavior.
3. **Audit real-use states:** sparse and long threads, automation expansion, search results, source error, unmatched booking, cancellation/date warning, loading and narrow layouts. Make targeted fixes supported by an identifiable defect.
4. **Prepare morning handoff:** exact commit/files, preview route, passed checks, unresolved issues and visual evidence status. Stop when the bounded pass is complete. Do not keep generating cosmetic variants without evidence.

## Acceptance criteria

| Check | Acceptance |
| --- | --- |
| Narrow panel | At 760x900, guest names, timestamps, dates and the primary action fit. Message reading remains comfortable; no horizontal page scroll. |
| Full desktop | At 1440x900, reservation details can open and close without losing the selected conversation or search. Headers align and the thread retains useful width. |
| Phone | At 390x844, list and thread are separate useful views. Back navigation and details dismiss correctly, with appropriate focus restoration. |
| Sparse thread | One short message looks intentional without a fabricated summary, fake composer or decorative filler. |
| Long thread | Long names, confirmation codes, unbroken text, multiple days and long automated messages remain readable. Sender attribution stays clear. |
| Search and filters | Existing guest/message search and channel/stay filters continue to work. Empty results differ from source failure. Filter state is visible. |
| Data integrity | Mismatched dates, no unique booking match, incomplete source history and read-only status remain truthful. No inferred unread, priority or response status. |
| Keyboard | All supported controls are reachable; Escape and focus return work for dialogs; modifier-click links retain normal behavior. No trap outside an active dialog. |
| Accessibility | Verify contrast, zoom/reflow and hit areas; do not rely on color alone. A numerical CSS audit does not establish compliance. |
| Scope | No loader/auth changes, external sends, mark-read writes, channel changes, customer-data access, production deploy or unrelated Helm edits. |

Visual rows in this table remain unverified until rendered evidence is available through an authorized surface. The existing browser-policy block must not be bypassed using another browser, proxy, raw browser protocol, screenshot mechanism or alternate local host. Continue source/documentation work, but label visual acceptance as pending.

## Overnight execution and handoff

Use this brief as the fixed direction for a bounded overnight pass ending the morning of September 30, 2026. Work only in `/Users/maguire/.codex/worktrees/calderwood-readonly/statement-portal`, branch `codex/calderwood-design`. Do not touch the shared checkout or another agent's worktree. No sub-agents are authorized. Preserve PR #1695 for review; no merge or production deployment.

Before code changes, read the relevant installed Next.js guide and current repository instructions. Use synthetic preview fixtures only. If code changes, run required tests and TypeScript, plus focused checks for changed behavior. Do not rerun unrelated suites repeatedly or claim historical checks as current validation. A CSS-only change does not need a new behavior test. For this documentation-only change, full diff and link/path inspection plus `git diff --check` are sufficient.

Reviewed base: `5586f569`. Current `origin/main` verified during research at `9902f7b0`; the design worktree has not been rebased or merged with it. Latest UI commit: `b5de6d49`. PR: https://github.com/ryanfortsch/statement-portal/pull/1695. Local synthetic preview: http://127.0.0.1:3114/channels/pilot/inbox?conversation=c2.

### Run ledger

- Research pass: completed first-party reference review, inspected Front/Linear screenshots, audited current CSS and composition, and established the direction and acceptance criteria above.
- Implementation pass: pending.
- Final audit and morning handoff: pending.
