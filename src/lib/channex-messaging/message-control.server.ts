import 'server-only';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PRODUCTION_DB_URL } from '@/lib/channex-production-runtime';
import { messageControlRequest, messageControlSchema, messageControlResultSchema } from './message-control';
const production = () => process.env.VERCEL_ENV === 'production'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === PRODUCTION_DB_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
export async function readMessageControl(sendId: string) {
  await requireOwnerEmail();
  if (!production()) throw Error('Controls unavailable');
  const { data, error } = await supabaseAdmin.rpc('helm_channex_message_control_read', { p_send_id: sendId }).abortSignal(AbortSignal.timeout(10_000));
  if (error) throw Error('Controls unavailable');
  if (data === null) return null;
  const value = messageControlSchema.parse(data);
  if (value.sendId !== sendId) throw Error('Controls unavailable');
  return value;
}
export async function changeMessageControl(raw: unknown) {
  const actor = await requireOwnerEmail(), input = messageControlRequest.parse(raw);
  if (!production()) throw Error('Controls unavailable');
  const { data, error } = await supabaseAdmin.rpc('helm_channex_message_control', {
    p_send_id: input.sendId, p_expected: input.expected, p_hold: input.held, p_actor: actor,
  }).abortSignal(AbortSignal.timeout(10_000));
  if (error) throw Error('Hold outcome uncertain');
  const result = messageControlResultSchema.parse(data);
  if (result.control && result.control.sendId !== input.sendId
    || result.state === 'changed' && (!result.control || result.control.held !== input.held || result.control.token === input.expected)) throw Error('Hold outcome uncertain');
  return result;
}
