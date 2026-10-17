import Link from 'next/link';
import { HelmFooter } from './HelmFooter';

/** `self` is the Delivery & sync page itself, which must not link to itself. */
export function MessagingFooter({ self = false }: { self?: boolean } = {}) {
  if (self) return <HelmFooter left="Rising Tide · Messaging" right="Message imports and background work" />;
  return <HelmFooter left="Rising Tide · Messaging" right={<Link href="/messaging/status" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontStyle: 'normal', textDecoration: 'underline' }}>Delivery &amp; sync</Link>} />;
}
