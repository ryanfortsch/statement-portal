import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { loadPilotInbox } from '@/lib/calderwood-inbox.server';
import { PilotInbox } from './PilotInbox';
export const dynamic = 'force-dynamic';
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ conversation?: string; booking?: string }> }) {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com')) redirect('/auth/signin?callbackUrl=%2Fchannels%2Fpilot%2Finbox');
  const params = await searchParams;
  const bookingId = typeof params.booking === 'string' ? params.booking : undefined;
  const conversationId = typeof params.conversation === 'string' ? params.conversation : undefined;
  return <PilotInbox data={await loadPilotInbox(conversationId, bookingId)} bookingId={bookingId} />;
}
