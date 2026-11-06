type Named = { id: string; name: string };
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** "seven sumac" reads as "7 sumac", "fifty three" as "53": the crew
 *  often spells the house number out. Runs on normalized text. */
function spelledNumbers(body: string): string {
  return body
    .replace(new RegExp(`\\b(${TENS.filter(Boolean).join('|')}) (${ONES.slice(1, 10).join('|')})\\b`, 'g'), (_, t: string, o: string) => String(TENS.indexOf(t) * 10 + ONES.indexOf(o)))
    .replace(new RegExp(`\\b(${TENS.filter(Boolean).join('|')})\\b`, 'g'), (t: string) => String(TENS.indexOf(t) * 10))
    .replace(new RegExp(`\\b(${ONES.slice(1).join('|')})\\b`, 'g'), (o: string) => String(ONES.indexOf(o)));
}

const STREET_WORD = '(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|court|ct|place|pl|terrace|ter|circle|cir)';

function textBody(text: string): string {
  return ` ${spelledNumbers(normalize(text.replace(/\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b/g, ' ')))} `;
}

/** Suggestions only. A full numbered street phrase is evidence (the number
 * may be spelled out); a date, bare house number, partial street or
 * unmatched unit is not. Multiple matches remain visible but are never
 * preselected. */
export function suggestedHouses(text: string, properties: Named[]): Named[] {
  const body = textBody(text);
  return properties.filter(p => {
    const name = normalize(p.name);
    return /^\d+\s+[a-z]{3}/.test(name) && body.includes(` ${name} `);
  });
}

/**
 * The houses a text points at, and how. A house named in full wins. Failing
 * that, a street named WITH its street word ("Enon Street", "Horton St")
 * points at the one house on it, and only when exactly one house in the
 * list sits on that street: "Rocky Neck Ave" names three and suggests none.
 */
export function houseSuggestions(text: string, properties: Named[]): { houses: Named[]; by: 'house' | 'street' | null } {
  const houses = suggestedHouses(text, properties);
  if (houses.length > 0) return { houses, by: 'house' };
  const body = textBody(text);
  const names = properties.map(p => ({ p, name: normalize(p.name) }));
  const onStreet = names.filter(({ name }) => {
    const street = /^\d+\s+([a-z][a-z ]{2,})$/.exec(name)?.[1];
    if (!street) return false;
    if (!new RegExp(` ${street} ${STREET_WORD} `).test(body)) return false;
    // Unique: no other house's name carries the same street.
    return names.filter(o => ` ${o.name} `.includes(` ${street} `)).length === 1;
  });
  return onStreet.length === 1 ? { houses: [onStreet[0].p], by: 'street' } : { houses: [], by: null };
}

/** Only a unique exact directory name or an explicit self-introduction.
 * Never turn a mention of another person into their identity. */
export function suggestedContact(text: string, knownName: string | undefined, contacts: Named[]): { contact: Named; evidence: string } | null {
  const introduced = /\b(?:this is|my name is|i am|i'm)\s+([\p{L}'’-]+\s+[\p{L}'’-]+)\b/iu.exec(text)?.[1];
  const name = knownName || introduced;
  if (!name || normalize(name).split(' ').length < 2) return null;
  const matches = contacts.filter(c => normalize(c.name) === normalize(name));
  return matches.length === 1 ? { contact: matches[0], evidence: knownName ? `Directory name: ${knownName}` : `They introduced themselves as “${introduced}”` } : null;
}
