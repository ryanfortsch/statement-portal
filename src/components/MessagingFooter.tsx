import Link from 'next/link';
import { HelmFooter } from './HelmFooter';

export function MessagingFooter() {
  return <HelmFooter left="Rising Tide · Messaging" right={<Link href="/messaging/status" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontStyle: 'normal', textDecoration: 'underline' }}>Delivery &amp; sync</Link>} />;
}
