/**
 * Quo address book vs. Helm CRM reconciliation.
 *
 * Runs daily (cron) or on demand. Pulls all Quo contacts, matches them
 * against Helm contacts by phone, and writes suggestions to
 * contact_reconcile_suggestions for the operator to review.
 *
 * Pending suggestions are replaced on every run. Accepted / dismissed
 * rows survive because they're filtered by status != 'pending' in the
 * delete step, and a dismissed one is never suggested again: Skip used to
 * last one night, because the rebuild re-inserted it as pending.
 *
 * Each row carries the Quo contact's own last edit (quo_contact_updated_at)
 * so /crm can fold an old address-book entry under "Older"
 * (src/lib/triage-age.ts); the row's created_at is always tonight's.
 */
import 'server-only';
import { supabaseAdmin as sb } from '@/lib/supabase-admin';
import { listAllContacts, quoContactFields, normalizePhone } from '@/lib/quo';
import { selectAllPaged } from '@/lib/paged-select';

type HelmContact = {
  id: string;
  name: string;
  emails: string[] | null;
  phone: string | null;
  organization: string | null;
};

export type ReconcileSuggestion = {
  quo_contact_id: string;
  suggestion_type: 'add_contact' | 'fill_email' | 'fill_org';
  helm_contact_id: string | null;
  phone: string | null;
  suggested_name: string | null;
  suggested_emails: string[];
  suggested_org: string | null;
  reason: string;
  /** The Quo contact's updatedAt (else createdAt), for the age fold. */
  quo_contact_updated_at: string | null;
};

export type ReconcileRun = {
  quoTotal: number;
  suggestionsGenerated: number;
  inserted: number;
};

export async function runReconcile(): Promise<ReconcileRun> {
  const [quoContacts, { data: helmRows }] = await Promise.all([
    listAllContacts(),
    sb.from('contacts').select('id, name, emails, phone, organization'),
  ]);

  const helmContacts = (helmRows ?? []) as HelmContact[];

  // phone (normalized 10-digit) -> Helm contact
  const byPhone = new Map<string, HelmContact>();
  for (const c of helmContacts) {
    if (c.phone) {
      const norm = normalizePhone(c.phone);
      if (norm) byPhone.set(norm, c);
    }
  }

  const suggestions: ReconcileSuggestion[] = [];

  for (const qc of quoContacts) {
    const { name, emails, phones, company } = quoContactFields(qc);
    const quoUpdatedAt = qc.updatedAt ?? qc.createdAt ?? null;

    // Skip contacts with no usable data.
    if (!name && phones.length === 0) continue;

    // Try to match by phone.
    let matched: HelmContact | null = null;
    let matchedPhone: string | null = null;
    for (const p of phones) {
      const norm = normalizePhone(p);
      const hit = norm ? byPhone.get(norm) : undefined;
      if (hit) {
        matched = hit;
        matchedPhone = p;
        break;
      }
    }

    if (matched) {
      const helmEmails = matched.emails ?? [];

      // Suggest emails Helm is missing.
      const newEmails = emails.filter((e) => !helmEmails.includes(e));
      if (helmEmails.length === 0 && newEmails.length > 0) {
        suggestions.push({
          quo_contact_id: qc.id,
          suggestion_type: 'fill_email',
          helm_contact_id: matched.id,
          phone: matchedPhone,
          suggested_name: name || null,
          suggested_emails: newEmails,
          suggested_org: null,
          reason: `"${matched.name}" has no email in Helm; Quo has ${newEmails.join(', ')}`,
          quo_contact_updated_at: quoUpdatedAt,
        });
      }

      // Suggest org if Helm is blank.
      if (company && !matched.organization) {
        suggestions.push({
          quo_contact_id: qc.id,
          suggestion_type: 'fill_org',
          helm_contact_id: matched.id,
          phone: matchedPhone,
          suggested_name: name || null,
          suggested_emails: [],
          suggested_org: company,
          reason: `"${matched.name}" has no org in Helm; Quo has "${company}"`,
          quo_contact_updated_at: quoUpdatedAt,
        });
      }
    } else {
      // No Helm contact for this Quo person. Only suggest add if they have
      // a name and at least one phone (so we can link them later).
      if (!name || phones.length === 0) continue;
      const primaryPhone = phones[0];
      suggestions.push({
        quo_contact_id: qc.id,
        suggestion_type: 'add_contact',
        helm_contact_id: null,
        phone: primaryPhone,
        suggested_name: name,
        suggested_emails: emails,
        suggested_org: company,
        reason: `"${name}" (${primaryPhone}) is in your Quo address book but not in Helm`,
        quo_contact_updated_at: quoUpdatedAt,
      });
    }
  }

  // A Skip is a decision: the same suggestion about the same Quo contact is
  // never offered again. Read before the delete, which only touches pending.
  const skipped = await selectAllPaged<{ quo_contact_id: string; suggestion_type: string }>((from, to) =>
    sb
      .from('contact_reconcile_suggestions')
      .select('quo_contact_id, suggestion_type')
      .eq('status', 'dismissed')
      .order('id')
      .range(from, to),
  );
  const skippedKeys = new Set(skipped.map((r) => `${r.quo_contact_id}|${r.suggestion_type}`));
  const fresh = suggestions.filter((sg) => !skippedKeys.has(`${sg.quo_contact_id}|${sg.suggestion_type}`));

  // Replace all pending suggestions. Accepted/dismissed are keyed by status
  // so they survive the delete.
  await sb.from('contact_reconcile_suggestions').delete().eq('status', 'pending');

  let inserted = 0;
  if (fresh.length > 0) {
    const { error } = await sb.from('contact_reconcile_suggestions').insert(fresh);
    if (error) throw new Error(`Failed to insert suggestions: ${error.message}`);
    inserted = fresh.length;
  }

  return { quoTotal: quoContacts.length, suggestionsGenerated: suggestions.length, inserted };
}

export type ContactReconcileSuggestionRow = {
  id: string;
  quo_contact_id: string;
  suggestion_type: 'add_contact' | 'fill_email' | 'fill_org';
  helm_contact_id: string | null;
  phone: string | null;
  suggested_name: string | null;
  suggested_emails: string[];
  suggested_org: string | null;
  reason: string;
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: string;
  /** The Quo contact's last edit; null before the column was filled. */
  quo_contact_updated_at?: string | null;
};
