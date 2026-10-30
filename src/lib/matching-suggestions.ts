type Named = { id: string; name: string };
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Suggestions only. A full numbered street phrase is evidence; a date,
 * bare house number, partial street or unmatched unit is not. Multiple
 * matches remain visible but are never preselected. */
export function suggestedHouses(text: string, properties: Named[]): Named[] {
  const body = ` ${normalize(text.replace(/\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b/g, ' '))} `;
  return properties.filter(p => {
    const name = normalize(p.name);
    return /^\d+\s+[a-z]{3}/.test(name) && body.includes(` ${name} `);
  });
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
