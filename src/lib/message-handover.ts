/**
 * Which homes carry a message handover review, and where it lives.
 *
 * The review compares a home's Guesty message workflows with Helm's own
 * rules before the home leaves Guesty. The channel hub links it for owners on
 * every home listed here (audit 2026-11-07, finding 2: the link used to be
 * written for one house). Today only 65 Calderwood has handover data
 * (src/lib/channex-messaging/preparation-timing.ts), and its page keeps its
 * own route while the Channex pilot work on it is live. A second home gets
 * one entry here once its review exists.
 */
const MESSAGE_HANDOVER_HREF: Readonly<Record<string, string>> = {
  '65_calderwood': '/channels/65_calderwood/message-preparation',
};

export function messageHandoverHref(propertyId: string): string | null {
  return Object.prototype.hasOwnProperty.call(MESSAGE_HANDOVER_HREF, propertyId) ? MESSAGE_HANDOVER_HREF[propertyId] : null;
}
