import 'server-only';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getGuestyToken } from '@/lib/guesty-client';
import { requireProductionInspectionEnvironment } from '@/lib/channex-production-runtime';
import { timingReviewOverviewSchema, timingReviewRequestSchema } from './timing-review-contract';
import { createChannexTimingBindingStore } from './timing-binding-store';
import { reviewCalderwoodTimingBinding } from './timing-provider-review';

const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await supabaseAdmin.rpc(name, args); return { data, error };
};

export async function loadTimingReviewOverview() {
  await requireOwnerEmail();
  requireProductionInspectionEnvironment(process.env);
  const result = await rpc('helm_channex_timing_review_overview', {});
  if (result.error) throw Error('Timing review unavailable');
  return timingReviewOverviewSchema.parse(result.data);
}

export async function saveTimingReview(raw: unknown) {
  const actor = await requireOwnerEmail();
  const { action: _action, ...request } = timingReviewRequestSchema.parse(raw); void _action;
  requireProductionInspectionEnvironment(process.env);
  return reviewCalderwoodTimingBinding(request, actor, {
    load: async ({ captureId, bookingId }) => {
      const result = await rpc('helm_channex_timing_review_snapshot', { p_capture_id: captureId, p_booking_id: bookingId });
      if (result.error) throw Error('Timing review unavailable');
      return result.data;
    },
    credentials: async () => ({ guestyToken: await getGuestyToken(), channexKey: process.env.CHANNEX_PRODUCTION_API_KEY! }),
    store: createChannexTimingBindingStore(rpc, { enabled: true }),
  }, { enabled: true });
}
