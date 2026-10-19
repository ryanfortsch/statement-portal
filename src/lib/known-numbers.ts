/**
 * Who a phone number is, as Helm already knows them.
 *
 * The New numbers card asked about people Helm had on file (2026-10-19):
 * two owners texting the OWNERS line and the incoming operations manager
 * on the 24/7 line. The CRM had both households with an email and no
 * phone, and the only check was `contacts.phone`. Their numbers sat one
 * table over: the Quo address book named all three, the owners registry
 * carried one owner's, and the Field roster carried the manager's. Of 193
 * numbers waiting that day, 45 were people Helm knew.
 *
 * One resolver, read by three places: the Quo webhook (a text from a
 * household files onto it), the nightly sweep after the address-book pass
 * (attachKnownNumbers in known-numbers-server.ts), and the card (anyone
 * left is named, with the contact picked).
 *
 * Pure: no database, no clock. The server module loads the directory.
 */
import { normalizePhone } from './quo-lines.ts';
import type { ContactType } from './crm.ts';

export type DirectoryContact = {
  id: string;
  name: string;
  type: ContactType;
  phone: string | null;
  linked_property_ids: string[] | null;
};

/** stay-concierge's owner registry (`owners`), joined to homes by properties.owner_id. */
export type DirectoryOwner = {
  id: string;
  name_full: string | null;
  name_greeting: string | null;
  name_last: string | null;
  phones: string[] | null;
};

export type DirectoryProperty = {
  id: string;
  owner_id: string | null;
  owner_full: string | null;
  owner_greeting: string | null;
  owner_last: string | null;
};

export type DirectoryEntry = { phone: string | null; name: string };

export type NumberDirectory = {
  contacts: DirectoryContact[];
  owners: DirectoryOwner[];
  properties: DirectoryProperty[];
  /** Field roster (contractors, employees among them), not archived. */
  field: DirectoryEntry[];
  /** Trade vendors (both lines), not archived. */
  trades: DirectoryEntry[];
  /** Prospects with a phone on their projection. */
  prospects: DirectoryEntry[];
  /** Quo address-book names Helm has no contact for (pending add_contact suggestions). */
  addressBook: DirectoryEntry[];
};

export type KnownSource = 'contact' | 'owner' | 'field' | 'trade' | 'prospect' | 'quo';

export type KnownNumber = {
  /** The person, as the source names them: "Dana Hale". */
  name: string;
  source: KnownSource;
  /** The CRM contact this number belongs to, when Helm can tell. `fillsPhone`
   *  is true when that contact has no phone yet, so attaching makes this
   *  number the one future texts are recognized by. */
  contact?: { id: string; name: string; fillsPhone: boolean };
  /** Not a new number at all: already on a contact, or someone Helm keeps
   *  outside the CRM (the Field roster, a trade vendor). Off the card. */
  settled: boolean;
};

export type NumberIndex = {
  resolve(phone: string | null | undefined): KnownNumber | null;
};

/** Words a household's name carries that are not anybody's name. */
const NOT_NAMES = new Set(['the', 'family', 'and', 'of', 'llc', 'trust', 'inc', 'co', 'mr', 'mrs', 'ms', 'dr']);

/** Lowercase name words, punctuation and filler dropped: "The O'Hale Family" -> ["ohale"]. */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1 && !NOT_NAMES.has(t));
}

type Household = {
  contact: DirectoryContact;
  /** Every name word the household is known by. */
  words: Set<string>;
  /** The family names, from the registry when it has one. */
  surnames: Set<string>;
};

function households(dir: NumberDirectory): Household[] {
  const ownerById = new Map(dir.owners.map((o) => [o.id, o]));
  const propertyById = new Map(dir.properties.map((p) => [p.id, p]));
  const out: Household[] = [];
  for (const c of dir.contacts) {
    if (c.type !== 'owner') continue;
    const words = new Set(nameTokens(c.name));
    const surnames = new Set<string>();
    for (const pid of c.linked_property_ids ?? []) {
      const p = propertyById.get(pid);
      if (!p) continue;
      const o = p.owner_id ? ownerById.get(p.owner_id) : undefined;
      for (const t of [...nameTokens(p.owner_full), ...nameTokens(p.owner_greeting), ...nameTokens(o?.name_full), ...nameTokens(o?.name_greeting)]) words.add(t);
      for (const t of [...nameTokens(p.owner_last), ...nameTokens(o?.name_last)]) {
        words.add(t);
        surnames.add(t);
      }
    }
    // No registry surname: the last word of the contact's own name is.
    const own = nameTokens(c.name);
    if (surnames.size === 0 && own.length > 0) surnames.add(own[own.length - 1]);
    out.push({ contact: c, words, surnames });
  }
  return out;
}

/**
 * The one owner contact a name belongs to, or null.
 *
 * Strict on purpose, the same rule stay-concierge links owner phones by
 * (contacts.link_phone_to_owner): the name needs a given name AND a
 * surname, the surname must be the household's family name, every word
 * must be one the household is known by, and two candidates is no answer.
 * "Dana Hale" is The Hale Family (greeting "Dana and Mark"); "James
 * Hale" is nobody, because the household says Jim.
 */
export function householdForName(name: string, homes: Household[]): Household | null {
  const words = nameTokens(name);
  if (words.length < 2) return null;
  const surname = words[words.length - 1];
  const hits = homes.filter((h) => h.surnames.has(surname) && words.every((w) => h.words.has(w)));
  return hits.length === 1 ? hits[0] : null;
}

/** The owner contact a registry owner's phone belongs to: the one owner
 *  contact linked to that owner's homes, else the one whose name is the
 *  registry's household name. Two candidates is no answer. */
function householdForOwner(owner: DirectoryOwner, dir: NumberDirectory, homes: Household[]): Household | null {
  const homeIds = new Set(dir.properties.filter((p) => p.owner_id === owner.id).map((p) => p.id));
  const linked = homes.filter((h) => (h.contact.linked_property_ids ?? []).some((pid) => homeIds.has(pid)));
  if (linked.length === 1) return linked[0];
  if (linked.length > 1) return null;
  const full = nameTokens(owner.name_full).join(' ');
  if (!full) return null;
  const named = homes.filter((h) => nameTokens(h.contact.name).join(' ') === full);
  return named.length === 1 ? named[0] : null;
}

function ownerPersonName(owner: DirectoryOwner): string {
  const greeting = (owner.name_greeting ?? '').trim();
  const last = (owner.name_last ?? '').trim();
  // "Jim" + "Hale"; a greeting naming two people reads as the household.
  if (greeting && last && !/\band\b|&/i.test(greeting)) return `${greeting} ${last}`;
  return (owner.name_full ?? '').trim() || last || greeting;
}

function fromHousehold(h: Household, name: string, source: KnownSource): KnownNumber {
  return { name, source, contact: { id: h.contact.id, name: h.contact.name, fillsPhone: !h.contact.phone }, settled: false };
}

/**
 * Build the lookup once per directory. Order is what wins when one number
 * sits in two places: a contact that already has it, then the owner
 * registry, then an address-book name that is unmistakably a household,
 * then the Field roster and trade vendors (known, but not CRM people),
 * then a prospect, then a bare address-book name.
 */
export function buildNumberIndex(dir: NumberDirectory): NumberIndex {
  const homes = households(dir);

  const byContactPhone = new Map<string, DirectoryContact>();
  for (const c of dir.contacts) {
    const n = normalizePhone(c.phone);
    if (n && !byContactPhone.has(n)) byContactPhone.set(n, c);
  }

  const owners = new Map<string, DirectoryOwner[]>();
  for (const o of dir.owners) {
    for (const p of o.phones ?? []) {
      const n = normalizePhone(p);
      if (!n) continue;
      owners.set(n, [...(owners.get(n) ?? []), o]);
    }
  }

  const listed = (entries: DirectoryEntry[]) => {
    const m = new Map<string, string[]>();
    for (const e of entries) {
      const n = normalizePhone(e.phone);
      const name = e.name?.trim();
      if (!n || !name) continue;
      m.set(n, [...(m.get(n) ?? []), name]);
    }
    return m;
  };
  const field = listed(dir.field);
  const trades = listed(dir.trades);
  const prospects = listed(dir.prospects);
  const addressBook = listed(dir.addressBook);

  return {
    resolve(phone) {
      const n = normalizePhone(phone);
      if (!n || n.length !== 10) return null;

      const contact = byContactPhone.get(n);
      if (contact) return { name: contact.name, source: 'contact', contact: { id: contact.id, name: contact.name, fillsPhone: false }, settled: true };

      const registry = owners.get(n) ?? [];
      if (registry.length === 1) {
        const h = householdForOwner(registry[0], dir, homes);
        if (h) return fromHousehold(h, ownerPersonName(registry[0]), 'owner');
      }

      const quoNames = addressBook.get(n) ?? [];
      for (const name of quoNames) {
        const h = householdForName(name, homes);
        if (h) return fromHousehold(h, name, 'quo');
      }

      const crew = field.get(n);
      if (crew) return { name: crew[0], source: 'field', settled: true };
      const trade = trades.get(n);
      if (trade) return { name: trade[0], source: 'trade', settled: true };

      // Known by name, with no contact to put the number on yet.
      if (registry.length === 1) {
        const name = ownerPersonName(registry[0]);
        if (name) return { name, source: 'owner', settled: false };
      }
      const prospect = prospects.get(n);
      if (prospect) return { name: prospect[0], source: 'prospect', settled: false };
      if (quoNames.length > 0) return { name: quoNames[0], source: 'quo', settled: false };
      return null;
    },
  };
}

/** What the card says before the name: "Owner", "Prospect", "Quo". */
export function knownSourceLabel(source: KnownSource): string {
  switch (source) {
    case 'contact': return 'Contact';
    case 'owner': return 'Owner';
    case 'field': return 'Field';
    case 'trade': return 'Trade';
    case 'prospect': return 'Prospect';
    case 'quo': return 'Quo';
  }
}
