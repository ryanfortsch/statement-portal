import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  crmCandidateFilter,
  emailVariants,
  gatherPeople,
  oneCrmContact,
  oneGuestListRecord,
  phoneLikePattern,
  phoneQueryDigits,
  resolveGuestMatches,
  type CrmLinkRow,
  type GuestListLinkRow,
  type GuestListSearchRow,
  type GuestMatch,
  type HelmGuestSearchRow,
} from '@/lib/person-record-link';

/**
 * The reads behind the Guest list / CRM cross-links and guests in search.
 * Every one fails quiet: an error or a slow answer is no link (or no guest
 * rows), and the page renders exactly as it did before. Each lookup is one
 * read with a short deadline, run beside the page's own reads.
 */
const LOOKUP_MS = 2500;

/** `/crm/<id>` for the one CRM contact holding this guest's email, or null. */
export async function crmContactHrefForGuest(email: string | null | undefined): Promise<string | null> {
  const variants = emailVariants([email]);
  if (variants.length === 0) return null;
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, emails, phone')
      .overlaps('emails', variants)
      .limit(5)
      .abortSignal(AbortSignal.timeout(LOOKUP_MS));
    if (error) return null;
    const id = oneCrmContact({ emails: [email ?? ''], phones: [] }, (data ?? []) as CrmLinkRow[]);
    return id ? `/crm/${encodeURIComponent(id)}` : null;
  } catch {
    return null;
  }
}

/** `/guests/<id>` for the one Guest list record holding one of this contact's emails, or null. */
export async function guestListHrefForContact(emails: string[] | null | undefined): Promise<string | null> {
  const variants = emailVariants(emails ?? []);
  if (variants.length === 0) return null;
  try {
    const { data, error } = await supabase
      .from('audience_contacts')
      .select('id, email')
      .in('email', variants)
      .limit(5)
      .abortSignal(AbortSignal.timeout(LOOKUP_MS));
    if (error) return null;
    const id = oneGuestListRecord(emails ?? [], (data ?? []) as GuestListLinkRow[]);
    return id ? `/guests/${encodeURIComponent(id)}` : null;
  } catch {
    return null;
  }
}

/**
 * Guests matching a search by name, email or phone, each opening its CRM
 * contact when one matches exactly, else its Guest list record. Both pages
 * are open to staff, so this returns nothing a staff login cannot open.
 */
export async function searchGuests(q: string, limit: number): Promise<GuestMatch[]> {
  const trimmed = (q ?? '').trim();
  if (trimmed.length < 2) return [];
  const escaped = trimmed.replace(/[%_,()*]/g, ' ').trim();
  if (!escaped) return [];
  const like = `%${escaped}%`;
  const signal = AbortSignal.timeout(LOOKUP_MS);

  // A full name ("Jane Smith") matches first and last name together.
  const words = escaped.split(/\s+/).filter(Boolean);
  const listOr = [`first_name.ilike.${like}`, `last_name.ilike.${like}`, `email.ilike.${like}`];
  if (words.length === 2) listOr.push(`and(first_name.ilike.%${words[0]}%,last_name.ilike.%${words[1]}%)`);

  const digits = phoneQueryDigits(trimmed);
  const helmOr = [`full_name.ilike.${like}`, `email.ilike.${like}`];
  if (digits) helmOr.push(`phone_e164.ilike.%${digits}%`, `phone.ilike.${phoneLikePattern(digits)}`);

  try {
    const [listRes, helmRes] = await Promise.all([
      supabase
        .from('audience_contacts')
        .select('id, email, first_name, last_name')
        .or(listOr.join(','))
        .order('last_name', { ascending: true, nullsFirst: false })
        .limit(limit)
        .abortSignal(signal),
      supabase
        .from('guests')
        .select('email, phone, phone_e164, first_name, last_name, full_name')
        .or(helmOr.join(','))
        .limit(limit)
        .abortSignal(signal),
    ]);
    const people = gatherPeople(
      listRes.error ? [] : ((listRes.data ?? []) as GuestListSearchRow[]),
      helmRes.error ? [] : ((helmRes.data ?? []) as HelmGuestSearchRow[]),
    );
    if (people.length === 0) return [];

    const emails = people.flatMap((p) => p.emails);
    const phones = people.flatMap((p) => p.phones);
    // A Helm-native guest found by phone or name reaches the Guest list by email.
    const missing = emailVariants(people.filter((p) => !p.guestListId).flatMap((p) => p.emails));
    const crmFilter = crmCandidateFilter(emails, phones);
    const [extraRes, crmRes] = await Promise.all([
      missing.length > 0
        ? supabase.from('audience_contacts').select('id, email').in('email', missing).limit(limit * 2).abortSignal(signal)
        : Promise.resolve({ data: [] as GuestListLinkRow[], error: null }),
      crmFilter
        ? supabase.from('contacts').select('id, emails, phone').or(crmFilter).limit(limit * 4).abortSignal(signal)
        : Promise.resolve({ data: [] as CrmLinkRow[], error: null }),
    ]);
    return resolveGuestMatches(
      people,
      extraRes.error ? [] : ((extraRes.data ?? []) as GuestListLinkRow[]),
      crmRes.error ? [] : ((crmRes.data ?? []) as CrmLinkRow[]),
      limit,
    );
  } catch {
    return [];
  }
}
