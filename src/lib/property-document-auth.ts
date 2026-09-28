import 'server-only';
import { auth } from '@/auth';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  PROPERTY_RENDER_HEADER,
  verifyPropertyDocumentToken,
  type ProtectedPropertyDocument,
} from './property-document-token';

/** Guard before any property/access read. A property slug is not authorization. */
export async function requirePropertyDocumentAccess(propertyId: string, type: ProtectedPropertyDocument) {
  if ((await auth())?.user) return;
  const token = (await headers()).get(PROPERTY_RENDER_HEADER);
  if (!verifyPropertyDocumentToken(token, propertyId, type, process.env.AUTH_SECRET)) {
    notFound();
  }
}
