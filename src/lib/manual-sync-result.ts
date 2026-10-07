/** Interpret the manual sync API contracts without turning missing data into zero. */
export type ManualSyncKind = 'gmail' | 'quo' | 'contacts';
export type ManualSyncResult = { message: string; warning: boolean; refresh: boolean };

const invalid = () => new Error('Could not confirm the sync result. Check the latest activity before retrying.');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid();
  return value;
}
function errors(value: unknown): number {
  if (!Array.isArray(value)) throw invalid();
  return value.length;
}

export function summarizeManualSync(kind: ManualSyncKind, value: unknown): ManualSyncResult {
  const data = record(value);
  if (data.ok !== true) throw invalid();
  if (kind === 'gmail') {
    const inserted = count(data.inserted), scanned = count(data.scanned), skipped = count(data.skipped);
    const failed = errors(data.errors), contacts = count(data.contacts);
    if (!Array.isArray(data.mailboxes)) throw invalid();
    if (failed) return {
      message: `Gmail sync incomplete: ${inserted} new replies captured; ${failed} error${failed === 1 ? '' : 's'}. Some replies may be missing.`,
      warning: true, refresh: inserted > 0,
    };
    if (!data.mailboxes.length || !contacts) return {
      message: !data.mailboxes.length ? 'Gmail was not scanned: no mailboxes are configured.' : 'Gmail was not scanned: no contacts have email addresses.',
      warning: true, refresh: false,
    };
    return {
      message: `${inserted ? `Captured ${inserted} new ${inserted === 1 ? 'reply' : 'replies'}` : 'No new replies'} (${scanned} scanned, ${skipped} already on file).`,
      warning: false, refresh: inserted > 0,
    };
  }
  if (kind === 'quo') {
    const summary = record(data.summary);
    const inserted = count(summary.messages_inserted) + count(summary.calls_inserted);
    const cleanings = count(summary.cleaning_completions_inserted), failed = errors(summary.errors);
    if (failed) return {
      message: `Quo sync incomplete: ${inserted} new touches and ${cleanings} cleaning signals captured; ${failed} error${failed === 1 ? '' : 's'}. Some activity may be missing.`,
      warning: true, refresh: inserted > 0 || cleanings > 0,
    };
    const parts: string[] = [];
    if (inserted) parts.push(`${inserted} new ${inserted === 1 ? 'touch' : 'touches'}`);
    if (cleanings) parts.push(`${cleanings} cleaning ${cleanings === 1 ? 'signal' : 'signals'}`);
    return { message: parts.length ? `Captured ${parts.join(', ')}.` : 'No new activity from Quo (last 14 days).', warning: false, refresh: !!parts.length };
  }
  const generated = count(data.suggestionsGenerated), inserted = count(data.inserted);
  if (inserted !== generated) return {
    message: `Contact sync incomplete: ${inserted} of ${generated} suggestions saved. Check the suggestion list before retrying.`,
    warning: true, refresh: true,
  };
  return { message: inserted ? `${inserted} suggestion${inserted === 1 ? '' : 's'} generated.` : 'No new suggestions.', warning: false, refresh: true };
}
