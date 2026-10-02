import { auth } from '@/auth';
import { stagingBoardEnabled } from '@/lib/channex-staging/board';
import { createSharedOwnershipStore } from '@/lib/channex-staging/shared-ownership-store';
import { saveObservedRevisions } from '@/lib/channex-staging/shared-feed';
import { ChannexStagingClient } from '@/lib/channex-staging/client';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
async function allowed(){const session=await auth();return session?.user?.email?.endsWith('@risingtidestr.com') && stagingBoardEnabled(process.env) && process.env.VERCEL_ENV==='preview' && process.env.VERCEL_GIT_COMMIT_REF==='codex/channex-staging-pilot';}
function store(){return createSharedOwnershipStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'');}
export async function POST(request:Request){
 if(!await allowed())return Response.json({error:'unavailable'},{status:403,headers});
 if(!process.env.AUTH_URL||request.headers.get('origin')!==new URL(process.env.AUTH_URL).origin)return Response.json({error:'origin'},{status:403,headers});
 try{
  const db=store();await db.read();
  const client=new ChannexStagingClient(process.env.CHANNEX_STAGING_API_KEY??'');
  await client.inspect();
  const revisions=await client.readRevisions();
  const result=await saveObservedRevisions(db,revisions);
  return Response.json({...result,received:revisions.length,version:(await db.read()).version},{headers});
 }catch{return Response.json({error:'Import incomplete; saved history retained. No acknowledgements or calendar writes.'},{status:503,headers});}
}
