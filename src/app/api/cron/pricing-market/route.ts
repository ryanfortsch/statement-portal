import {priceLabsCronResponse} from '@/lib/pricelabs-market-refresh.server';

export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request){
  // No signed-in-member fallback: only the scheduled job/operator secret.
  return priceLabsCronResponse(request);
}
