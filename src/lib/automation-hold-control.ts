/** Pure transport boundary for the reviewed hold RPC. No send or retry path. */
export type HoldRequest = {
  propertyId: string; sendId: string; actor: string; hold: boolean; expectedUpdatedAt: string;
};
export type HoldResult = { ok: true; status: 'held' | 'scheduled' } | { ok: false; error: string };
export type HoldRpc = (args: {
  p_send_id: string; p_property_id: string; p_actor: string; p_hold: boolean;
  p_expected_updated_at: string;
}) => Promise<{ data: unknown; error: unknown }>;

export async function changeAutomationHold(request: HoldRequest, enabled: boolean, rpc: HoldRpc): Promise<HoldResult> {
  if (!enabled) return { ok: false, error: 'Hold controls are not enabled in this environment.' };
  if (!request.propertyId.trim() || !request.actor.trim()
    || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.sendId)
    || typeof request.hold !== 'boolean'
    || !Number.isFinite(Date.parse(request.expectedUpdatedAt))) {
    return { ok: false, error: 'Invalid hold request. Refresh the message list.' };
  }
  try {
    const result = await rpc({ p_send_id: request.sendId, p_property_id: request.propertyId,
      p_actor: request.actor, p_hold: request.hold, p_expected_updated_at: request.expectedUpdatedAt });
    if (result.error || typeof result.data !== 'boolean') {
      return { ok: false, error: 'Could not verify the change. Refresh the message before trying again.' };
    }
    if (!result.data) return { ok: false, error: 'Not changed: the message or reservation changed, or it is already sending. Refresh and review it.' };
    return { ok: true, status: request.hold ? 'held' : 'scheduled' };
  } catch {
    return { ok: false, error: 'Could not verify the change. Refresh the message before trying again.' };
  }
}

/** Display preflight only. The atomic RPC remains authoritative at click time. */
export function holdReleaseBlockReason(
  send: { property_id: string; planned_check_in: string; planned_check_out: string },
  booking: { property_id: string; status: string; duplicate_of: string | null; check_in: string; check_out: string } | undefined,
): string | null {
  if (!booking) return 'Booking could not be verified. Refresh before releasing this message.';
  if (booking.property_id !== send.property_id) return 'Booking property changed. Review this message before release.';
  if (booking.status === 'cancelled') return 'Booking cancelled. This message remains held and cannot be released.';
  if (booking.status !== 'confirmed') return 'Booking is not confirmed. This message cannot be released.';
  if (booking.duplicate_of) return 'This is a duplicate booking. Review the current booking instead.';
  if (booking.check_in !== send.planned_check_in || booking.check_out !== send.planned_check_out)
    return 'Booking dates changed. This message remains held pending review of its timing and content.';
  return null;
}

/** Pilot-only: a preview label never proves the ordinary Helm client is isolated. */
export function automationHoldsEnabled(env: {
  HELM_AUTOMATION_HOLDS_ENABLED?: string; NEXT_PUBLIC_SUPABASE_URL?: string;
  VERCEL_ENV?: string; NODE_ENV?: string;
}): boolean {
  if (env.HELM_AUTOMATION_HOLDS_ENABLED !== 'true') return false;
  const preview = env.VERCEL_ENV === 'preview';
  const local = (!env.VERCEL_ENV || env.VERCEL_ENV === 'development') && env.NODE_ENV !== 'production';
  if (!preview && !local) return false;
  // Exact approved isolated project. Do not retarget the shared preview's core DB.
  return env.NEXT_PUBLIC_SUPABASE_URL === 'https://jgkblfozftcvymvwhhii.supabase.co';
}
