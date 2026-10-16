import { handleCleanerReceipt } from '@/lib/calderwood-rehearsal/cleaner-receipt-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export async function POST(request: Request) {
  return handleCleanerReceipt(request, { env: process.env });
}
