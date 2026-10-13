# Calderwood message schedule rehearsal

Review-only model and preview panel for six known workflows. Uses the existing
relative timing and Eastern local-time helpers. No contacts, message bodies,
delivery, automation rule writes or saved hold mutations are involved.

For a standard 4 PM arrival: confirmation is 30 minutes after the actual
confirmation; key code is 3 PM on arrival day; cleaner arrival reminder is 9 AM.
The day-before arrival, day-before checkout and 10-day cleaner reminder each
retain their known calendar date with an unconfirmed clock time. No default
clock is substituted. The user was asked to supply or retain the existing times.

Synthetic checks cover winter/summer, both DST transition dates, calendar-day
rather than elapsed-day offsets, a nonexistent spring-forward local time,
missing confirmation, bad dates, late imports, operator holds, moved dates,
cancellation, and already-sent suppression. Held rows retain a held disposition;
the new time displayed is a proposal, not a write or permission to release.

Validation October 13, 2026: all 1,873 tests passed, nonincremental TypeScript,
targeted ESLint and diff checks passed. Hosted panel acceptance passed on source `243f4e60`, deployment
`DhnWZ7FS6PQGV9qcw2vD6JhBTgQR`: winter and summer retain 3 PM / 9 AM, moved
dates keep the code held, cancellation blocks all six, late entries require
review, and an already-sent confirmation is suppressed. Three unknown clocks
remain visibly unconfirmed. This browser check did not send messages.

This does not prove the complete operational schedule: global workflows, exact
channel exclusions, existing Guesty sent/queued handoff, access-code provisioning,
booking-channel delivery and cleaner SMS delivery remain prerequisites. Unknown
send times remain unresolved rather than being treated as activation-ready.

## Existing Guesty settings verified October 13

User instruction: keep Guesty's existing times. Inspected the live Calderwood
Messaging and Cleaning updates - Luana edit views without saving changes. The
three previously unresolved entries have day offsets and no extra scheduling
or message conditions configured. They are not missing independent clocks.

Guesty's official scheduling documentation states that reservation ETA/ETD
anchors these offsets, falling back to listing check-in/checkout times:
https://help.guesty.com/hc/en-gb/articles/9365081186205-Managing-automated-messages-for-guests-owners-and-team-members

For the verified standard 4 PM arrival / 11 AM departure, the model now shows:
- Pre-arrival: 4 PM the preceding day.
- Checkout reminder: 11 AM the preceding day.
- Cleaner advance reminder: 4 PM ten days before arrival.
- Code: 3 PM arrival day; cleaner arrival reminder: 9 AM.
- Confirmation: 30 minutes after confirmation.

These are derived standard times, not fixed overrides. Reservation-specific times
shift the messages; the preview includes an 18:00 arrival / 12:00 departure case.
Exact Guesty queued timestamps around DST still need parity verification. Late
import review remains intentional: it must not be confused with Guesty's immediate
send behavior for a genuinely new last-minute confirmation.

Guest workflow excludes exactly Website, Manual, and Direct - stay cape ann.
Cleaner workflow applies to all channels/sources, any advance notice and duration.
These display labels still need canonical source mapping before dispatch. This
review-only schedule does not implement delivery or the separate direct workflow.

Updated validation: 1,874 tests passed, including default and ETA/ETD timing.
