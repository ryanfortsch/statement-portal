import { createHash, randomBytes } from 'node:crypto';

/**
 * Staff documents: an offer letter or other agreement a team member signs
 * online in Helm. Same shape as the owner-contract flow (/contract/<token>):
 *
 *   draft     an owner wrote it at /staff-documents; nothing has gone out
 *   sent      the body is frozen and the signing link is live
 *   signed    the recipient typed their name at /sign/<token>
 *   executed  an owner countersigned; the PDF went to Drive and the signer
 *   void      withdrawn; the link shows that and nothing can be signed
 *
 * The body is Markdown (headings, paragraphs, lists, tables, **bold**),
 * pasted in by an owner. Its sha256 is taken when it is sent, and the
 * signing form carries it back, so nobody signs a version they did not
 * see. Pure: no database, no session.
 */

export type StaffDocumentStatus = 'draft' | 'sent' | 'signed' | 'executed' | 'void';

export type StaffDocumentRow = {
  id: string;
  token: string;
  title: string;
  recipient_name: string;
  recipient_email: string;
  body_md: string;
  body_digest: string;
  status: StaffDocumentStatus;
  created_by_email: string | null;
  created_at: string;
  sent_at: string | null;
  sent_by_email: string | null;
  signed_at: string | null;
  signed_name: string | null;
  signed_ip: string | null;
  signed_user_agent: string | null;
  signed_digest: string | null;
  countersigned_at: string | null;
  countersigned_by_email: string | null;
  countersigned_name: string | null;
  drive_url: string | null;
  executed_email_sent_at: string | null;
  voided_at: string | null;
  updated_at: string;
};

export const STAFF_DOCUMENT_STATUS_LABEL: Record<StaffDocumentStatus, string> = {
  draft: 'Draft',
  sent: 'Waiting for signature',
  signed: 'Signed, waiting for countersign',
  executed: 'Fully signed',
  void: 'Withdrawn',
};

const TOKEN_RE = /^[a-f0-9]{32}$/;

export function isSigningToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

export function newSigningToken(): string {
  return randomBytes(16).toString('hex');
}

/** Line endings and trailing space are not part of what was agreed. */
export function normalizeBody(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

export function staffDocumentDigest(md: string): string {
  return createHash('sha256').update(normalizeBody(md), 'utf8').digest('hex');
}

/** A signer may sign only a live document whose text is the one they saw. */
export function signingRefusal(
  row: Pick<StaffDocumentRow, 'status' | 'body_digest'>,
  shownDigest: string,
): string | null {
  if (row.status === 'void') return 'This document was withdrawn.';
  if (row.status === 'draft') return 'This document has not been sent yet.';
  if (row.status !== 'sent') return 'This document is already signed.';
  if (shownDigest !== row.body_digest) return 'The document changed while it was open. Please read the current version.';
  return null;
}

/** A typed signature: the full name, at least two words. */
export function signatureRefusal(typedName: string, agreed: boolean): string | null {
  if (!agreed) return 'Check the box to agree before signing.';
  const name = typedName.trim().replace(/\s+/g, ' ');
  if (name.split(' ').length < 2 || name.length < 4) return 'Type your full name to sign.';
  return null;
}

export function staffDocumentFilename(row: Pick<StaffDocumentRow, 'title' | 'recipient_name'>, executedOn?: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  const tail = executedOn ? ` - Executed ${executedOn}` : '';
  return `${clean(row.recipient_name)} - ${clean(row.title)}${tail}.pdf`;
}

// ── Markdown, the small subset a letter uses ──────────────────────────────

export type LetterBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const TABLE_RULE_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/**
 * Blocks, in order. Anything it does not recognise reads as a paragraph,
 * so pasted text never disappears. Rendered as React elements, never as
 * HTML, so a document cannot inject markup into the signing page.
 */
export function parseLetter(md: string): LetterBlock[] {
  const lines = normalizeBody(md).split('\n');
  const blocks: LetterBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2].trim() });
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_RULE_RE.test(lines[i + 1].trim())) {
      const header = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(re.exec(lines[i])![1].trim());
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !lines[i].trim().startsWith('|')
    ) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length === 0) {
      // A stray table-looking line with no rule under it.
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

export type InlineRun = { text: string; bold: boolean };

/**
 * Undo what an exporter escapes: numeric entities (`&#32;`), the common
 * named ones, and backslash escapes (`\_`). Text only, so nothing here can
 * become markup.
 */
export function decodeText(text: string): string {
  return text
    .replace(/&#(\d{1,7});/g, (m, n) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : m))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, '$1');
}

/** `**bold**` runs; everything else is plain text. */
export function inlineRuns(raw: string): InlineRun[] {
  const text = decodeText(raw);
  const runs: InlineRun[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs.filter((r) => r.text.length > 0);
}
