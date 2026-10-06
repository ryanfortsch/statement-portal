import 'server-only';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { quoFromNumber, sendMessage } from '@/lib/quo';
import { deliverRequestAlert, REQUEST_ALERT_TO } from './airbnb-request-alerts';
import type { RequestNotification, RequestReview } from './airbnb-request-notifications';

export async function notifyReviewedRequest(source: RequestNotification, review: RequestReview) {
  const from = quoFromNumber('ops');
  return deliverRequestAlert(process.env.AIRBNB_REQUEST_ALERTS_ENABLED === 'true', from, source, review, Date.now(), {
    async claim() {
      const { error } = await db.from('airbnb_request_alerts').insert({ message_id: review.message_id, from_number: from, to_number: REQUEST_ALERT_TO });
      if (error?.code === '23505') return false;
      if (error) throw new Error('Alert storage unavailable');
      return true;
    },
    async send(content) {
      const message = await sendMessage({ from, to: REQUEST_ALERT_TO, content });
      return message.id;
    },
    async record(status, providerId) {
      const { data, error } = await db.from('airbnb_request_alerts').update({ status, provider_message_id: providerId, updated_at: new Date().toISOString() }).eq('message_id', review.message_id).select('message_id').single();
      if (error || !data) throw new Error('Alert status unavailable');
    },
  });
}
