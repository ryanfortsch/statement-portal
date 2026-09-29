import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { loadCalderwoodWorkspace } from '@/lib/calderwood-workspace.server';
import { CalderwoodWorkspace } from './CalderwoodWorkspace';
export const dynamic = 'force-dynamic';
export default async function PilotPage() {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com')) redirect('/auth/signin?callbackUrl=%2Fchannels%2Fpilot');
  return <CalderwoodWorkspace data={await loadCalderwoodWorkspace()} />;
}
