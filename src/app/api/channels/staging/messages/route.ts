import {auth} from '@/auth';
import {stagingBoardEnabled} from '@/lib/channex-staging/board';
import {ChannexStagingClient,StagingApiError} from '@/lib/channex-staging/client';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
 const session=await auth();
 if(!session?.user?.email?.endsWith('@risingtidestr.com')||!stagingBoardEnabled(process.env)||process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='codex/channex-staging-pilot')return Response.json({error:'Unavailable'},{status:403,headers});
 const params=new URL(request.url).searchParams,unit=params.get('unit'),thread=params.get('thread')??undefined;
 if((unit!=='front'&&unit!=='back')||(thread&&!/^[0-9a-f-]{36}$/i.test(thread)))return Response.json({error:'Invalid pilot selection'},{status:400,headers});
 try{
  const data=await new ChannexStagingClient(process.env.CHANNEX_STAGING_API_KEY??'').readMessages(unit,thread);
  return Response.json({...data,checkedAt:new Date().toISOString(),mode:'read-only'},{headers});
 }catch(error){return Response.json({error:error instanceof StagingApiError&&error.status===403?'Messaging access unavailable for this staging property.':'Message snapshot unavailable. No messages or channel settings were changed.'},{status:503,headers});}
}
