import { auth } from '@/auth';
import { stagingBoardEnabled } from '@/lib/channex-staging/board';
import { createWorkerHealthStore } from '@/lib/channex-staging/worker-health-store';
import { workerHealthStatus } from '@/lib/channex-staging/worker-health';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
 const session=await auth();
 if(!session?.user?.email?.endsWith('@risingtidestr.com') || !stagingBoardEnabled(process.env) || process.env.VERCEL_ENV!=='preview' || process.env.VERCEL_GIT_COMMIT_REF!=='codex/channex-staging-pilot')return Response.json({error:'unavailable'},{status:403,headers});
 try{
  const health=await createWorkerHealthStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'').read();
  return Response.json({health,status:workerHealthStatus(health),checkedAt:new Date().toISOString()},{headers});
 }catch{return Response.json({error:'Worker health unavailable'},{status:503,headers});}
}
