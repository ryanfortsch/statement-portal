/**
 * Background-check disclosure + authorization text shown during contractor
 * onboarding. Plain constants (NOT server-only) so the client onboarding form
 * and the server action can both import it.
 *
 * IMPORTANT: this is standard FCRA-style boilerplate, not legal advice. Have
 * the wording reviewed, or paste your screening provider's (e.g. Checkr's)
 * own vetted FCRA disclosure + authorization language here. When you change the
 * text, bump BG_DISCLOSURE_VERSION so the audit trail records which version a
 * given contractor signed.
 *
 * FCRA note: the disclosure is meant to be "clear and conspicuous" and stand on
 * its own. In the onboarding form it lives in its own dedicated, bordered card
 * with its own authorization checkbox + signature, separate from the contractor
 * agreement, to keep it from being commingled.
 */

export const BG_DISCLOSURE_VERSION = '2026-06-30-v1';

export const BG_DISCLOSURE_TITLE = 'Background check authorization';

/** The disclosure: what we may obtain and why. */
export const BG_DISCLOSURE_TEXT =
  'Rising Tide STR may obtain a consumer report (a background check) about you, ' +
  'and may obtain additional reports during your engagement, for the purpose of ' +
  'evaluating you as an independent contractor who enters guests’ and owners’ homes. ' +
  'The report may include criminal history, sex-offender-registry status, and identity ' +
  'verification, obtained through a third-party consumer reporting agency.';

/** The authorization the contractor agrees to by checking the box. */
export const BG_AUTHORIZATION_TEXT =
  'I have read and understand the disclosure above. I authorize Rising Tide STR ' +
  'and its designated consumer reporting agency to obtain a background check about ' +
  'me for these purposes.';
