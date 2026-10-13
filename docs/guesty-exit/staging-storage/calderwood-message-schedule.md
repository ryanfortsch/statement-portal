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
