/**
 * Owner-facing link tokens (`/contract/<token>`, `/onboarding/<token>`) are
 * 32 lowercase hex characters. They are pasted by hand into owner emails,
 * and a mail client linkifies whatever touches the token: on 2026-10-15 a
 * Gmail reply read "…/contract/<token>– This contains the terms…" with no
 * space before the en dash, so the link John was sent carried the dash and
 * the page said not found for a contract that existed.
 *
 * `cleanLinkToken` recovers the token from a route param that may have
 * punctuation glued to its end: the clean token itself, or null when the
 * param does not start with one. The page then redirects to the clean path
 * when the two differ, so the owner lands on the URL we meant to send.
 */
const LEADING_TOKEN_RE = /^([a-f0-9]{32})(?![a-f0-9])/;

export function cleanLinkToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // A stray lone "%" is not a token anyway; match on the raw value.
  }
  const m = LEADING_TOKEN_RE.exec(value);
  return m ? m[1] : null;
}
