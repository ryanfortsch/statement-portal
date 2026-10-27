import { createHmac, timingSafeEqual } from 'node:crypto';

export const STATEMENT_RENDER_HEADER = 'x-helm-statement-render';
const TTL_SECONDS = 120;

function signature(id: string, month: string, expires: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(['helm-statement-render-v1', id, month, expires]))
    .digest('hex');
}

/** Short-lived access to one statement and month, never a user session. */
export function createStatementRenderToken(id: string, month: string, secret: string | undefined, now = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is required to render statement PDFs');
  const expires = Math.floor(now / 1000) + TTL_SECONDS;
  return `${expires}.${signature(id, month, expires, secret)}`;
}

export function verifyStatementRenderToken(token: string | null | undefined, id: string, month: string, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || !token) return false;
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + TTL_SECONDS) return false;
  return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(signature(id, month, expires, secret), 'hex'));
}
