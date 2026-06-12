/**
 * US phone formatting. House style: "(781) 223-1091".
 *
 * formatUsPhone normalizes any 10-digit (or 11-digit with leading 1)
 * input into that shape; anything else (international, extensions,
 * free text like "call Allie first") passes through untouched so we
 * never mangle a value we don't understand.
 *
 * Used at SAVE time in the property edit action (so the DB converges
 * to the pretty format) and at DISPLAY time everywhere phones render
 * (so legacy raw values like "7812231091" read correctly without a
 * backfill).
 */
export function formatUsPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  const ten =
    digits.length === 10 ? digits :
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) :
    null;
  if (!ten) return trimmed;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Digits-only form for tel: links. Keeps a leading + when present. */
export function telHref(raw: string | null | undefined): string {
  if (!raw) return '';
  return `tel:${raw.replace(/[^+\d]/g, '')}`;
}
