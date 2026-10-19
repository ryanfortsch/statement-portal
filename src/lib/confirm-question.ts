/**
 * Pure helpers for ConfirmDialog (src/components/ConfirmDialog.tsx), kept out
 * of the component so the rules are tested without a browser.
 */

/**
 * Split a one-string confirm ("Retire Pat? They move to the Retired list.")
 * into the modal's title (the question) and body (what it does). The house
 * wording asks first and explains after (src/lib/irreversible-confirms.ts),
 * so the first "? " is the seam. A string with no question mark mid-way is
 * all title.
 */
export function askFromSentence(text: string): { title: string; body?: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  const seam = clean.indexOf('? ');
  if (seam < 0) return { title: clean };
  const body = clean.slice(seam + 2).trim();
  return body ? { title: clean.slice(0, seam + 1), body } : { title: clean };
}

/** The typed-word gate: case and surrounding spaces do not count. */
export function typedWordMatches(typed: string | null | undefined, word: string): boolean {
  if (typed == null) return false;
  return typed.trim().toLowerCase() === word.trim().toLowerCase() && word.trim() !== '';
}
