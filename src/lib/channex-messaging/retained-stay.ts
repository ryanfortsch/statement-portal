import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { createCalderwoodScheduleInputReader } from './schedule-inputs.ts';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import { inspectCalderwoodTimingProviders } from './timing-provider-review.ts';
import type { MessageRpc } from './store.ts';

export const retainedStayRequestSchema = z.object({ bookingId: z.uuid(), bindingId: z.uuid(),
  templateCaptureId: z.uuid(), templateDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type RetainedStayRequest = z.infer<typeof retainedStayRequestSchema>;
type Inputs = NonNullable<Awaited<ReturnType<ReturnType<typeof createCalderwoodScheduleInputReader>['load']>>>;
function fixedInputs(inputs: Inputs) {
  const { observedAt: _at, ledger: _ledger, ...snapshot } = inputs.snapshot;
  void _at; void _ledger;
  return { context: inputs.context, snapshot };
}
/** Private fresh snapshot shared by scheduling and dispatch. The caller supplies
 * a bounded clock/RPC/fetcher. No discovery, capture, release, binding or send.
 * The output contains secrets and must never cross an HTTP/client boundary. */
export async function loadVerifiedRetainedStay(request: RetainedStayRequest, deps: {
  rpc: MessageRpc; now: () => number; credentials: () => Promise<{ guestyToken: string; channexKey: string }>;
  fetcher: typeof fetch;
}) {
  const { rpc, now, fetcher } = deps, bookingId = request.bookingId;
  const reader = createCalderwoodScheduleInputReader(rpc, { enabled: true });
  const templates = createCalderwoodTemplateCaptureReader(rpc, { enabled: true });
  const before = await reader.load(bookingId, request.bindingId, now);
  if (!before) throw Error();
  const archive = await templates.load(request.templateCaptureId, request.templateDigest, now());
  if (!archive) throw Error();
  const evidence = before.snapshot.timingEvidence;
  const inspected = await inspectCalderwoodTimingProviders({ bookingId, captureId: evidence.captureId }, {
    clock: now, fetcher,
    credentials: async () => { now(); const keys = await deps.credentials(); now(); return keys; },
    load: async ({ captureId }) => {
      const response = await rpc('helm_channex_timing_review_snapshot', { p_capture_id: captureId, p_booking_id: bookingId });
      if (!response || response.error !== null || !response.data) throw Error();
      // Pin the existing bound thread. Never discover a replacement and attach
      // it to old review evidence during a background scheduling read.
      const s = z.object({ route: z.object({ remoteBookingId: z.uuid(), threadId: z.uuid().optional(), revisionId: z.uuid() }).strict() })
        .passthrough().parse(response.data);
      if (s.route.remoteBookingId !== before.snapshot.route.remoteBookingId
        || (s.route.threadId && s.route.threadId !== before.snapshot.route.threadId)) throw Error();
      return { ...s, route: { ...s.route, threadId: before.snapshot.route.threadId } };
    },
  }, { enabled: true });
  if (inspected.state !== 'verified' || !isDeepStrictEqual(inspected.snapshot.context, before.context)
    || !isDeepStrictEqual(inspected.snapshot.capture.row, evidence.row)
    || inspected.snapshot.capture.id !== evidence.captureId
    || inspected.threadId !== before.snapshot.route.threadId) throw Error();
  const after = await reader.load(bookingId, request.bindingId, now);
  if (!after || !isDeepStrictEqual(fixedInputs(before), fixedInputs(after))) throw Error();
  // Use the newly read ledger, including holds/cancellation/other registrations
  // that arrived while provider reads were in progress. The coordinator then
  // rechecks context and reconciles this history before its one atomic write.
  return { scope: inspected.snapshot.scope, snapshot: { ...after.snapshot, capturedRules: archive.capturedRules } };
}
