import { auth } from '@/auth';
import { stagingBoardEnabled } from '@/lib/channex-staging/board';
import { createSharedOwnershipStore } from '@/lib/channex-staging/shared-ownership-store';
import { reconcileObservedBookings } from '@/lib/channex-staging/shared-reconcile';
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
  const first=await client.readSnapshot();
  const second=await client.readSnapshot();
  const ordered=(rows:typeof first.bookings)=>JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)));
  if(ordered(first.bookings)!==ordered(second.bookings))throw new Error('Bookings changed during reconciliation');
  if(second.inventory.length!==240||second.inventory.some(n=>n.stopSell!==true||n.minStay!==20))throw new Error('Pilot restrictions changed');
  return Response.json({...await reconcileObservedBookings(db,second.bookings),scope:'synthetic staging journal only',providerOwnershipVerified:false},{headers});
 }catch{return Response.json({error:'Import incomplete; saved history retained. No acknowledgements or calendar writes.'},{status:503,headers});}
}
