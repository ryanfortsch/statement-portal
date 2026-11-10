import {NextResponse} from 'next/server';
import {authorizeCron} from '@/lib/cron-auth';
import {isOwnerSession} from '@/lib/helm-access-server';
import {runDailyPricingCapture} from '@/lib/dynamic-pricing-observations-server';

export const dynamic='force-dynamic';
export const maxDuration=120;
export async function GET(request:Request) {
  const denied=await authorizeCron(request);if(denied)return denied;
  const secret=process.env.CRON_SECRET;
  if(!(secret&&request.headers.get('authorization')===`Bearer ${secret}`)&&!await isOwnerSession())return NextResponse.json({error:'Owners only'},{status:403});
  try {
    const result=await runDailyPricingCapture(process.env.HELM_PRICING_CAPTURE_ENABLED==='true'&&process.env.VERCEL_ENV==='production');
    return NextResponse.json(result,{status:result.failed||result.deferred?503:200,headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Pricing comparison capture failed'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
