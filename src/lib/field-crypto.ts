/**
 * Symmetric encryption for the one truly-sensitive value Helm stores: a
 * contractor's TIN/SSN on their W-9. AES-256-GCM (authenticated) with a key
 * derived from a server-only secret. Defense-in-depth on top of the
 * RLS-locked, service-role-only contractor_w9 table.
 *
 * Key material: a dedicated FIELD_W9_KEY if set, else the service-role key
 * (always present, server-only, never shipped to the browser). A dedicated key
 * is preferable long-term — set FIELD_W9_KEY to a random 32+ char secret.
 */
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function key(): Buffer {
  const material = process.env.FIELD_W9_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!material) throw new Error('No W-9 encryption key (set FIELD_W9_KEY)');
  return createHash('sha256').update(material).digest(); // 32 bytes
}

/** Returns "iv.tag.ciphertext", all base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB, tagB, ctB] = payload.split('.');
  if (!ivB || !tagB || !ctB) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
