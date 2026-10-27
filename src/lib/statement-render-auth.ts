import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isOwnerSession } from './helm-access-server';
import { STATEMENT_RENDER_HEADER, verifyStatementRenderToken } from './statement-render-token';

/** Runs before any statement data is read, including requests bypassing the proxy. */
export async function requireStatementRenderAccess(id: string, month: string): Promise<void> {
  if (await isOwnerSession()) return;
  const token = (await headers()).get(STATEMENT_RENDER_HEADER);
  if (!verifyStatementRenderToken(token, id, month, process.env.AUTH_SECRET)) notFound();
}
