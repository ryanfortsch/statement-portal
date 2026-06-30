/**
 * Quo address book vs. Helm CRM reconciliation.
 *
 * Runs daily (cron) or on demand. Pulls all Quo contacts, matches them
 * against Helm contacts by phone, and writes suggestions to
 * contact_reconcile_suggestions for the operator to review.
 *
 * Pending suggestions are replaced on every run. Accepted / dismissed
 * rows survive because they're filtered by status != 'pending' in the
 * delete step.
 */
import 'server-only';
import { supabaseAdmin as sb } from '@/lib/supabase-admin';
import { listAllContacts, quoContactFields, normalizePhone } from '@/lib/quo';

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
      });
    }
  }

  // Replace all pending suggestions. Accepted/dismissed are keyed by status
  // so they survive the delete.
  await sb.from('contact_reconcile_suggestions').delete().eq('status', 'pending');

  let inserted = 0;
  if (suggestions.length > 0) {
    const { error } = await sb.from('contact_reconcile_suggestions').insert(suggestions);
    if (error) throw new Error(`Failed to insert suggestions: ${error.message}`);
    inserted = suggestions.length;
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
};
