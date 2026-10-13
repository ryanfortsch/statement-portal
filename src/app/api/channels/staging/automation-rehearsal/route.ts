import { createClient } from '@supabase/supabase-js';
import { auth } from '@/auth';
import { persistentHoldEnvironment, validPersistentHoldRequest } from '@/lib/channex-staging/hold-rehearsal';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
async function actor() {
 if (!persistentHoldEnvironment(process.env)) return null;
 const session = await auth();
 return session?.user?.email?.endsWith('@risingtidestr.com') ? session.user.email : null;
}
function db() {
 if (!persistentHoldEnvironment(process.env) || !process.env.CHANNEX_STAGING_DB_SERVICE_KEY) throw new Error('Unavailable');
 return createClient(process.env.CHANNEX_STAGING_DB_URL!, process.env.CHANNEX_STAGING_DB_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function GET() {
 if (!await actor()) return Response.json({error:'Unavailable'}, {status:403,headers});
 try {
  const {data,error} = await db().rpc('helm_pilot_hold_read');
  if (error || !data) throw new Error('Unavailable');
  return Response.json(data,{headers});
 } catch { return Response.json({error:'Persistent rehearsal storage is unavailable.'},{status:503,headers}); }
}
export async function POST(request: Request) {
 const email = await actor();
 if (!email) return Response.json({error:'Unavailable'},{status:403,headers});
 // Match the configured preview origin, never a client-supplied Host header.
 if (!process.env.AUTH_URL || request.headers.get('origin') !== new URL(process.env.AUTH_URL).origin)
  return Response.json({error:'Origin rejected'},{status:403,headers});
 try {
  const body: unknown = await request.json();
  if (!validPersistentHoldRequest(body)) return Response.json({error:'Invalid request'},{status:400,headers});
  const {data,error} = await db().rpc('helm_pilot_hold_change',{
   p_hold:body.hold,p_expected_updated_at:body.expectedUpdatedAt,p_actor:email,
  });
  if (error || typeof data !== 'boolean') throw new Error('Uncertain');
  if (!data) return Response.json({error:'Another change won. Refresh and review before trying again.'},{status:409,headers});
  return Response.json({ok:true},{headers});
 } catch { return Response.json({error:'Change not confirmed. Refresh before trying again.'},{status:503,headers}); }
}
