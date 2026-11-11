import { HelmFooter } from './HelmFooter';

/**
 * The Messaging footer. It carries no link to Delivery & sync: the
 * disclosure at the foot of every inbox page (InboxBottomTools) is the one
 * door, so the footer stopped being a third one (UX audit 2026-11-07,
 * Messaging finding 5).
 */
export function MessagingFooter() {
  return <HelmFooter left="Rising Tide · Messaging" right="Message imports and background work" />;
}
