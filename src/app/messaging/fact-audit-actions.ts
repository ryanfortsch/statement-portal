'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { refreshFactAudit, explainError, type FactAudit } from '@/lib/stay-concierge';

export type RefreshFactAuditResult =
  | { ok: true; data: FactAudit }
  | { ok: false; error: string };

/** Recompute the weekly fact-base health report on demand (runs the LLM
 * integrity scan on the service). Triggered by the Refresh button on the
 * /messaging fact-base health card. */
export async function refreshFactAuditAction(): Promise<RefreshFactAuditResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const res = await refreshFactAudit();
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging');
  return { ok: true, data: res.data };
}
