import { createHmac, timingSafeEqual } from 'node:crypto';

export type ProtectedPropertyDocument = 'home-guide' | 'wifi-placard';
export const PROPERTY_RENDER_HEADER = 'x-helm-property-render';
const TOKEN_TTL_SECONDS = 120;

export function isProtectedPropertyDocument(type: string): type is ProtectedPropertyDocument {
  return type === 'home-guide' || type === 'wifi-placard';
}

function signature(propertyId: string, type: ProtectedPropertyDocument, expires: number, secret: string): string {
  // Domain separation keeps these signatures distinct from other AUTH_SECRET uses.
  return createHmac('sha256', secret)
    .update(JSON.stringify(['helm-property-document-v1', propertyId, type, expires]))
    .digest('hex');
}

/** Server-to-server access to ONE printable document, never a staff session. */
export function createPropertyDocumentToken(
  propertyId: string,
  type: ProtectedPropertyDocument,
  secret: string | undefined,
  now = Date.now(),
): string {
  if (!secret) throw new Error('AUTH_SECRET is required to render protected property PDFs');
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  return `${expires}.${signature(propertyId, type, expires, secret)}`;
}

export function verifyPropertyDocumentToken(
  token: string | null | undefined,
  propertyId: string,
  type: ProtectedPropertyDocument,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  if (!secret || !token) return false;
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + TOKEN_TTL_SECONDS) return false;
  return timingSafeEqual(
    Buffer.from(match[2], 'hex'),
    Buffer.from(signature(propertyId, type, expires, secret), 'hex'),
  );
}
