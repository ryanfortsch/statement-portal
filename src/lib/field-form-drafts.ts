/** Device-only form storage. Never submits work or stores authentication data. */
export type DraftFields = Record<string, string | boolean>;
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const formDraftKey = (scope: string) => `helm:field-form:v1:${scope}`;
export function readFormDraft<T extends DraftFields>(storage: DraftStorage, scope: string, defaults: T): { value: T; raw: string | null } {
  const raw = storage.getItem(formDraftKey(scope));
  if (!raw) return { value: defaults, raw: null };
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid draft');
  const value = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const entry = (parsed as Record<string, unknown>)[key];
    if (typeof entry !== typeof defaults[key]) throw new Error('Invalid draft field');
    value[key as keyof T] = entry as T[keyof T];
  }
  return { value, raw };
}
/** A late successful submit must not erase another tab's newer draft. */
export function clearFormDraft(storage: DraftStorage, scope: string, expected: string | null) {
  if (expected !== null && storage.getItem(formDraftKey(scope)) === expected) storage.removeItem(formDraftKey(scope));
}

/** Redirecting maintenance actions are cleared only by their completed page. */
export function markFormDraftSubmitted(storage: DraftStorage, scope: string, value: DraftFields) {
  storage.setItem(formDraftKey(scope) + ':submitted', JSON.stringify(value));
}
export function clearSubmittedFormDraft(storage: DraftStorage, scope: string) {
  const key = formDraftKey(scope) + ':submitted';
  clearFormDraft(storage, scope, storage.getItem(key));
  storage.removeItem(key);
}
