import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { loadCalderwoodWorkspace } from '@/lib/calderwood-workspace.server';
import { CalderwoodWorkspace } from './CalderwoodWorkspace';
export const dynamic = 'force-dynamic';
export default async function PilotPage({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com')) redirect('/auth/signin?callbackUrl=%2Fchannels%2Fpilot');
  const params = await searchParams;
  return <CalderwoodWorkspace data={await loadCalderwoodWorkspace()} initialBookingId={typeof params.booking === 'string' ? params.booking : undefined} />;
}
