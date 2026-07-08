'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  dismissProposedPropertyUpdate,
  markProposedPropertyUpdateApplied,
  explainError,
} from '@/lib/stay-concierge';
import {
  parsePropertyCaptureAction,
  applyPropertyCaptureAction,
} from '@/app/properties/actions';
import { captureColumn, type CaptureItem } from '@/lib/property-capture-catalog';
import { ACCESS_COLUMNS } from '@/lib/property-access';

/**
 * Server actions behind the "Proposed property updates" card on
 * /owner-messaging. A candidate is a durable property fact an owner shared in
 * a message (wifi, a code, trash day), surfaced by the stay-concierge owner
 * extractor.
 *
 * Applying a candidate routes its text through Helm's EXISTING Quick Capture
 * parse + apply (parsePropertyCaptureAction / applyPropertyCaptureAction), so
 * the proven sensitive-data routing is reused verbatim: a wifi password lands
 * in the RLS-locked property_access table, a wifi name on properties, a quirk
 * as a property note. This module never re-implements that routing; it only
 * orchestrates parse -> review -> apply and then tells stay-concierge the
 * candidate is resolved so it stops surfacing.
 */

type ParseResult =
  | {
      ok: true;
      items: CaptureItem[];
      currentValues: Record<string, string | null>;
      unrouted: string | null;
    }
  | { ok: false; error: string };

async function requireEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

/**
 * Parse a candidate's fact text into a reviewable routing proposal against the
 * chosen property. Writes nothing. propertyId may be corrected by the operator
 * in the UI before this is called (slug drift / unattributed candidates).
 */
export async function parseProposedUpdate(
  propertyId: string,
  factText: string,
): Promise<ParseResult> {
  if (!(await requireEmail())) return { ok: false, error: 'Not signed in.' };
  if (!propertyId) return { ok: false, error: 'Pick a property first.' };
  const res = await parsePropertyCaptureAction(propertyId, factText);
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    items: res.proposal.items,
    currentValues: res.currentValues,
    unrouted: res.proposal.unrouted,
  };
}

type ApplyResult =
  | { ok: true; columns: number; notes: number; skipped: string[]; warning?: string }
  | { ok: false; error: string };

// Credential-bearing extractor categories. Facts in these categories carry a
// literal secret (a wifi password, a door / gate / lock code), so they may
// only ever be filed into a SECURED field (the RLS-locked property_access
// table), never into an anon-readable property note or an anon-readable
// non-secured column.
const CREDENTIAL_CATEGORIES = new Set(['wifi', 'access_code']);
const ACCESS_SET = new Set<string>(ACCESS_COLUMNS);
// The non-secret halves of a wifi credential legitimately live on the
// anon-readable properties table (SSID + unit label); only the password
// halves are in ACCESS_COLUMNS.
const WIFI_NONSECRET = new Set(['wifi_name', 'wifi_label', 'wifi_name_2', 'wifi_label_2']);

/**
 * Server-side credential guard. The shared Quick Capture routing is
 * destination-driven (the model picks the table); a mis-route of a credential
 * to a note or a non-secured column would publish it to the anon-readable
 * Supabase surface. Because we KNOW this fact came from a credential-category
 * candidate, we fail closed: every applied item must be a column, and that
 * column must be a secured (property_access) field, with the only exception
 * being the non-secret wifi SSID/label columns. Returns an operator-facing
 * error string when a credential would land somewhere readable, else null.
 */
function credentialRoutingViolation(category: string, items: CaptureItem[]): string | null {
  if (!CREDENTIAL_CATEGORIES.has(category)) return null;
  for (const it of items) {
    if (it.target !== 'column' || !it.column) {
      return 'This came from a credential an owner shared, so it can only be filed into a secured property field, not a note. Uncheck the note item (or route it to the secured access field), then file again.';
    }
    const okColumn =
      category === 'wifi'
        ? ACCESS_SET.has(it.column) || WIFI_NONSECRET.has(it.column)
        : ACCESS_SET.has(it.column);
    if (!okColumn) {
      const label = captureColumn(it.column)?.label ?? it.column;
      return `A credential cannot be filed into "${label}", which is readable outside the team. Route it to a secured access field (Wi-Fi password, smart lock / gate / garage code) instead.`;
    }
  }
  return null;
}

/**
 * Apply the operator-approved items to the property, then mark the candidate
 * applied in stay-concierge so it leaves the queue. The two property
 * revalidations keep the property page fresh; the owner-messaging revalidation
 * drops the resolved card.
 *
 * `category` is the extractor's classification of the source fact. It gates the
 * credential routing guard so an owner-shared secret can never reach an
 * anon-readable surface, even if the parser mis-routes it.
 */
export async function applyProposedUpdate(
  candidateId: string,
  propertyId: string,
  items: CaptureItem[],
  category: string,
): Promise<ApplyResult> {
  if (!(await requireEmail())) return { ok: false, error: 'Not signed in.' };
  if (!propertyId) return { ok: false, error: 'Pick a property first.' };
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Nothing checked to apply.' };
  }

  // Fail closed if this credential fact would be filed anywhere readable.
  const violation = credentialRoutingViolation(category, items);
  if (violation) return { ok: false, error: violation };

  const applied = await applyPropertyCaptureAction(propertyId, items);
  if (!applied.ok) return { ok: false, error: applied.error };

  // Best-effort: tell the extractor this candidate is handled. A failure here
  // does not undo the write that already succeeded. We surface it as a warning
  // so the operator knows the card may reappear on a hard reload (and a
  // re-apply of a note-bearing candidate could duplicate the note).
  let warning: string | undefined;
  const marked = await markProposedPropertyUpdateApplied(candidateId);
  if (!marked.ok) {
    console.error('[applyProposedUpdate] mark-applied failed', explainError(marked.error));
    warning = 'Filed, but could not clear it from the queue. If it reappears, dismiss it rather than filing again.';
  }

  // All three messaging pages render this card (owner-sourced candidates on
  // /owner-messaging, cleaner-sourced on /cleaner-messaging, contractor-sourced
  // on /contractor-messaging) through the same actions, so revalidate all
  // three; the extra ones are no-ops.
  revalidatePath('/owner-messaging');
  revalidatePath('/cleaner-messaging');
  revalidatePath('/contractor-messaging');
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/edit`);
  return { ok: true, columns: applied.columns, notes: applied.notes, skipped: applied.skipped, warning };
}

export type DismissResult = { ok: true } | { ok: false; error: string };

export async function dismissProposedUpdate(candidateId: string): Promise<DismissResult> {
  if (!(await requireEmail())) return { ok: false, error: 'Not signed in.' };
  const res = await dismissProposedPropertyUpdate(candidateId);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  revalidatePath('/cleaner-messaging');
  revalidatePath('/contractor-messaging');
  return { ok: true };
}
