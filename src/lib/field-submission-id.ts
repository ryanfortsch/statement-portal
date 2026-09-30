import { createHash } from 'node:crypto';
/** A random client attempt is namespaced by the authenticated contractor. */
export function fieldSubmissionId(contractorId: string, attempt: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt)) return null;
  const hex = createHash('sha256').update(JSON.stringify(['field-report', contractorId, attempt])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
