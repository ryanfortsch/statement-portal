/**
 * A home's name in operator copy, never its id. "21_horton:" printed on the
 * Team inbox's guest-notes rows (walk of 2026-10-18); a property id is a key,
 * and the people reading Helm say "21 Horton".
 *
 * Import-free, so a server page, a client panel and a test can share it.
 */

/** "17_beach_back" -> "17 Beach Back": an id with no name on hand still reads as an address. */
export function prettyPropertyId(id: string): string {
  return String(id ?? '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The registry name when there is one, else the id made readable. */
export function homeLabel(id: string, names?: ReadonlyMap<string, string | null | undefined>): string {
  const name = names?.get(id)?.trim();
  return name || prettyPropertyId(id);
}
