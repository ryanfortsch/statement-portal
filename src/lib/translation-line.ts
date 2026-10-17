/**
 * What the English line under a guest card shows. The concierge answers a
 * guest in the language they wrote in and sends the English alongside
 * (guest_text_english / draft_english); while it is being made the card
 * says so in place. Text that was already English shows nothing.
 */
export const TRANSLATING_TEXT = 'Translating, a moment…';

export function englishLineText(
  text: string | null | undefined,
  translating: boolean | null | undefined,
): string | null {
  const english = (text || '').trim();
  if (english) return english;
  if (translating) return TRANSLATING_TEXT;
  return null;
}
