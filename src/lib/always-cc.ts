/** Every owner-facing and vendor-facing draft copies these two. */
export const ALWAYS_CC = [
  'allie@risingtidestr.com',
  'ryan@risingtidestr.com',
];

/** ALWAYS_CC for a mail someone sends themself: never copy the sender. */
export function alwaysCcFor(senderEmail: string | null | undefined): string[] {
  const me = (senderEmail || '').trim().toLowerCase();
  return ALWAYS_CC.filter((e) => e.toLowerCase() !== me);
}
