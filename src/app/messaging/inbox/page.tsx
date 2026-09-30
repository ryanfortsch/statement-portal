import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { loadGuestInbox } from '@/lib/guest-inbox.server';
import { guestInboxHref, inboxWindow } from '@/lib/guest-inbox-core';
import { PilotInbox } from '@/app/channels/pilot/inbox/PilotInbox';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'Guest inbox preview | Helm' };

type Query = { conversation?: string | string[]; property?: string | string[]; days?: string | string[] };
const single = (value: string | string[] | undefined) => typeof value === 'string' && value.length <= 256 ? value : undefined;

export default async function GuestInboxPage({ searchParams }: { searchParams: Promise<Query> }) {
  const params = await searchParams;
  const options = { conversation: single(params.conversation), property: single(params.property), days: single(params.days) };
  const session = await auth();
  // The route also remains behind the default proxy gate. No reads before auth.
  if (!session?.user?.email?.endsWith('@risingtidestr.com')) {
    const callback = guestInboxHref({ ...options, days: inboxWindow(options.days) });
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callback)}`);
  }
  const data = await loadGuestInbox(options);
  return <PilotInbox data={data} portfolio={{ properties: data.properties, propertyId: data.propertyId, days: data.days }} openConversation={!!options.conversation} />;
}
