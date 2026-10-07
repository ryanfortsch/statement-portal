export type SaveConfirmation = { ok: boolean; error?: string; uncertain?: boolean };
export const UNCERTAIN_SAVE = 'Could not confirm the save. Your details are kept. Retry to check and safely finish the same submission.';
async function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Save confirmation timed out')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
/** A timeout does not cancel a server write. Confirm it; never silently send another one. */
export async function confirmedSave<T extends SaveConfirmation>(
  save: () => Promise<T>, confirm: () => Promise<SaveConfirmation>,
  options: { timeoutMs?: number; checkReturnedFailure?: boolean } = {},
): Promise<T | SaveConfirmation> {
  const timeout = options.timeoutMs ?? 15_000;
  try {
    const result = await bounded(save, timeout);
    if (result.ok || (!result.uncertain && !options.checkReturnedFailure)) return result;
  } catch { /* A lost response says nothing about whether the write landed. */ }
  try {
    const result = await bounded(confirm, timeout);
    if (result.ok) return result;
  } catch { /* Keep the attempt and allow a deliberate retry. */ }
  return { ok: false, uncertain: true, error: UNCERTAIN_SAVE };
}
