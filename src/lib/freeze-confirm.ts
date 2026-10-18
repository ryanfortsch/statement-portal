'use client';

/**
 * Client half of the sent-statement freeze (src/lib/statement-finality.ts).
 *
 * Gated routes answer 409 { frozen: true, error } when a write would move a
 * statement the operator already marked sent. These helpers turn that into
 * one consistent UX: show the server's explanation in a confirm, and retry
 * with force on an explicit yes. A cancel returns { cancelled: true } so the
 * caller can quietly stand down instead of alerting an "error".
 */

export type FreezeAwareResult = { res: Response; cancelled: boolean };

/**
 * How the override question is asked. /statements passes its own modal
 * (ConfirmDialog's `ask`); without one, the browser's confirm() asks.
 */
export type FreezeAsk = (o: {
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'danger';
}) => Promise<boolean>;

const nativeAsk: FreezeAsk = async (o) => confirm(`${o.title}\n\n${o.body}`);

function confirmOverride(error: string | undefined, ask: FreezeAsk = nativeAsk): Promise<boolean> {
  return ask({
    title: error || 'This statement is frozen (already sent to the owner).',
    body: 'The override is recorded on the statement as a flag, and the owner\'s copy may no longer match Helm until you re-send.',
    confirmLabel: 'Override and save',
    tone: 'danger',
  });
}

async function frozenPayload(res: Response): Promise<{ frozen?: boolean; error?: string } | null> {
  if (res.status !== 409) return null;
  const data = await res.clone().json().catch(() => null) as { frozen?: boolean; error?: string } | null;
  return data?.frozen ? data : null;
}

/** JSON POST/PATCH with the freeze confirm-and-retry flow. */
export async function jsonWithFreezeRetry(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: Record<string, unknown>,
  ask?: FreezeAsk,
): Promise<FreezeAwareResult> {
  const send = (b: Record<string, unknown>) => fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  const first = await send(body);
  const frozen = await frozenPayload(first);
  if (!frozen) return { res: first, cancelled: false };
  if (!(await confirmOverride(frozen.error, ask))) return { res: first, cancelled: true };
  return { res: await send({ ...body, force: true }), cancelled: false };
}

/** FormData POST with the freeze confirm-and-retry flow. */
export async function formWithFreezeRetry(url: string, fd: FormData, ask?: FreezeAsk): Promise<FreezeAwareResult> {
  const first = await fetch(url, { method: 'POST', body: fd });
  const frozen = await frozenPayload(first);
  if (!frozen) return { res: first, cancelled: false };
  if (!(await confirmOverride(frozen.error, ask))) return { res: first, cancelled: true };
  fd.set('force', 'true');
  return { res: await fetch(url, { method: 'POST', body: fd }), cancelled: false };
}

/** URL-parameter variant (DELETE routes take force on the query string). */
export async function deleteWithFreezeRetry(url: string, ask?: FreezeAsk): Promise<FreezeAwareResult> {
  const first = await fetch(url, { method: 'DELETE' });
  const frozen = await frozenPayload(first);
  if (!frozen) return { res: first, cancelled: false };
  if (!(await confirmOverride(frozen.error, ask))) return { res: first, cancelled: true };
  const sep = url.includes('?') ? '&' : '?';
  return { res: await fetch(`${url}${sep}force=true`, { method: 'DELETE' }), cancelled: false };
}
