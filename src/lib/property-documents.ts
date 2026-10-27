/**
 * Per-property documents (Documents tab on /properties/[id]).
 * Files live in Vercel Blob; this is the metadata + URL.
 *
 * The executed management contract auto-files here on promote
 * (source = 'contract-auto'); everything else is operator-uploaded
 * (source = 'upload').
 */

export type DocumentCategory =
  | 'contract'
  | 'insurance'
  | 'tax'
  | 'inspection'
  | 'financial'
  | 'other';

export const DOCUMENT_CATEGORIES: Array<{ id: DocumentCategory; label: string }> = [
  { id: 'contract', label: 'Contract' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'tax', label: 'Tax' },
  { id: 'inspection', label: 'Inspection' },
  { id: 'financial', label: 'Financial' },
  { id: 'other', label: 'Other' },
];

export type PropertyDocument = {
  id: string;
  property_id: string;
  label: string;
  category: DocumentCategory;
  file_url: string;
  file_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  source: 'upload' | 'contract-auto';
  uploaded_by_email: string | null;
  created_at: string;
};

/** Human-readable file size. */
export function formatBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
