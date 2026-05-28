import { NextResponse, type NextRequest } from 'next/server';
import { generateText, stepCountIs } from 'ai';
import { auth } from '@/auth';
import { createAskTools } from '@/lib/ask/tools';

/**
 * Ask Helm — Claude-powered natural-language Q&A over Helm's data.
 *
 * Flow: the operator types a question in the Cmd+K palette's "Ask" mode,
 * we run Claude (via the Vercel AI Gateway) with a set of read-only
 * query tools, and return a plain-language answer plus the source
 * records it touched.
 *
 * Safety:
 *  - Auth-guarded: signed-in @risingtidestr.com staff only (same gate
 *    as the rest of Helm).
 *  - Read-only tools: no tool writes; the model can only query.
 *  - Numbers come from the tools (real DB aggregations), not the model's
 *    arithmetic — the system prompt is explicit about this.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Ask Helm, the assistant inside Helm — the internal operations hub for Rising Tide STR, a vacation-rental management company in Gloucester, MA. You answer staff questions about the business by calling the provided read-only tools and narrating what they return.

Rules:
  - ALWAYS get facts from the tools. Never invent a number, date, name, or status. If a tool doesn't return what's needed, say so plainly.
  - Try hard to be useful. Reach for the tools, chain several when needed, and don't stop at a bare label: once you find the thing, give the status plus the context the asker most likely wants next (for a prospect: its status, when the proposal went out, the obvious next step; for a property: latest payout and any open work). If the exact thing isn't found, surface the closest match you DID find instead of a dead end.
  - Money matters here (these are owners' payouts). Report figures exactly as the tools return them. Don't estimate or round unless asked. If you must total several returned numbers, do it carefully and show the components.
  - To answer a question about a specific property you usually need its id (like "53_rocky_neck"). If you only have a name, call list_properties first to resolve it.
  - "Where are we with X", "what's the status of X", "who is X", or any lookup where you're unsure whether X is a property, prospect, or person: call search_helm FIRST. It checks managed properties, the prospect pipeline, and CRM contacts in one shot and returns ids. Then drill in with the specific tool (get_statements for money, get_contact_history for conversations, list_prospects for deal detail). A question can name two things (a person and a property); look up each one.
  - "Revenue" and "payout" questions are answered from get_statements (the owner-statement source of truth), never from bank or turnover data.
  - Forward-looking questions about a SPECIFIC property (next few months, what's on the books, booking pacing, how is summer looking, is July light, any gaps, owner meeting prep) are answered with get_upcoming_bookings. It returns per-month rollups (paid nights, owner-blocked nights, open nights, occupancy %, payout on the books) plus every upcoming reservation. ALWAYS call it before answering a "what does the calendar look like" or "pacing" question; don't punt by telling the operator to "pull the Guesty calendar".
  - When a property's forward calendar looks thin, distinguish two cases EXPLICITLY: (a) the owner has blocked the dates for themselves (channel "block" or channel "direct" with $0 payout — surfaced as ownerBlocks / nightsOwnerBlocked) so there is nothing to sell, vs (b) the dates are open and unsold (nightsOpen > 0 with low occupancyPctOfAvailable) which is real pacing softness. Naming the owner-block case is often the whole answer for an owner pacing meeting.
  - Questions about conversations, communications, what someone said, or when a person was last contacted are answered from get_contact_history (logged emails, texts, and calls). Search it by the person's name; a household name like "The Armstrong Family" will still match a search for "Jane Armstrong".
  - Distinguish two cases carefully when reporting contact history: (a) NO contact record was found, vs (b) a contact WAS found but has zero logged touches. For (b), say the contact exists (give their name/role) but no conversations are logged in Helm's CRM yet — the actual emails/texts may live in Gmail or Quo without having been synced in. Never imply the person doesn't exist when a contact record was found.
  - Be concise and direct. Lead with the answer. Use short sentences and, where it helps, a tight list. No preamble, no "Great question."
  - NEVER use em dashes. Use a regular dash, a comma, or a period.
  - Format money as $X,XXX. Format months as "April 2026".
  - If the question is ambiguous, answer the most likely interpretation and note the assumption in one short line rather than asking a clarifying question.
  - Do the looking yourself. NEVER tell the user to "check the Prospects pipeline / Statements / Work board" or any other Helm surface a tool already covers. Call that tool instead. Only point the user elsewhere for data no tool can reach, like an unsynced Gmail thread or Quo text. When you genuinely find nothing after checking the relevant tools, state specifically what you searched, e.g. 'No prospect, property, contact, or statement in Helm matches "Bethany".'

Today's date: ${new Date().toISOString().slice(0, 10)}.`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let question = '';
  try {
    const body = await req.json();
    question = String(body?.question ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: 'Question is too long.' }, { status: 400 });
  }

  const { tools, getSources } = createAskTools();

  try {
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4.5',
      system: SYSTEM_PROMPT,
      prompt: question,
      tools,
      // Allow several tool calls in sequence (resolve a name, then pull
      // its statements, then maybe cross-check work) before the final
      // narration.
      stopWhen: stepCountIs(8),
    });

    const answer = (text ?? '').trim();
    if (!answer) {
      return NextResponse.json(
        { error: 'No answer came back. Try rephrasing.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ answer, sources: getSources() });
  } catch (err) {
    // Surface enough detail to diagnose AI-Gateway / model / tool failures
    // from the log line itself, without having to bisect by hand. The
    // generic "generateText failed" we had before told us nothing about
    // whether it was an auth issue, a missing model, a tool throw, or a
    // schema reject.
    console.error('[ask] generateText failed:', describeAskError(err, question));

    // Vercel AI Gateway returns a 403 GatewayInternalServerError when the
    // team's free-tier credits don't cover the requested model (Anthropic
    // models in particular are paid-only). The generic "try again" message
    // we showed before was actively misleading — retrying won't help; the
    // operator needs to top up. Surface the billing case explicitly with
    // a direct link to the Vercel AI Gateway top-up modal.
    const billing = detectBillingError(err);
    if (billing) {
      return NextResponse.json(
        {
          error:
            'Ask Helm is out of AI Gateway credits for this model. Top up at Vercel and try again.',
          topUpUrl: billing.topUpUrl,
          kind: 'gateway-billing',
        },
        { status: 402 },
      );
    }

    return NextResponse.json(
      { error: 'Ask Helm hit an error. Try again in a moment.' },
      { status: 500 },
    );
  }
}

/**
 * Detect the "AI Gateway billing / quota" failure shape. The SDK throws
 * a GatewayInternalServerError (or an AI_APICallError) with statusCode
 * 402/403 and a message mentioning "free tier" or "credits". When that
 * pattern matches, returns a top-up URL so the UI can render a useful
 * call to action; otherwise returns null and the caller falls through to
 * the generic 500.
 */
function detectBillingError(err: unknown): { topUpUrl: string } | null {
  if (!(err instanceof Error)) return null;
  const status = (err as unknown as { statusCode?: number }).statusCode;
  const msg = err.message || '';
  const looksBilling =
    (status === 402 || status === 403) &&
    /free tier|credits|upgrade|payment|quota/i.test(msg);
  if (!looksBilling) return null;
  // The Gateway's own error message embeds the team-scoped top-up URL,
  // e.g. https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dtop-up.
  // Prefer it when present; otherwise fall back to the generic deep link.
  const urlMatch = msg.match(/https?:\/\/vercel\.com\/[^\s)"']+/);
  return {
    topUpUrl:
      urlMatch?.[0] ||
      'https://vercel.com/dashboard/ai',
  };
}

/**
 * Flatten an AI-SDK / fetch / generic Error into a single log-friendly
 * object. The AI SDK throws several distinct error classes (AI_APICallError,
 * AI_NoSuchModelError, AI_LoadAPIKeyError, AI_InvalidArgumentError,
 * AI_NoOutputGeneratedError, AI_ToolExecutionError, etc.) and each has its
 * own useful fields; we grab them best-effort.
 */
function describeAskError(err: unknown, question: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    question: question.length > 200 ? question.slice(0, 200) + '…' : question,
  };
  if (!(err instanceof Error)) {
    out.error = String(err);
    return out;
  }
  out.name = err.name;
  out.message = err.message;
  // Optional AI-SDK fields. Use `unknown` indexing so we don't pull in the
  // entire SDK type surface just to capture diagnostics.
  const anyErr = err as unknown as Record<string, unknown>;
  for (const key of [
    'url',
    'statusCode',
    'responseHeaders',
    'responseBody',
    'modelId',
    'modelType',
    'toolName',
    'parameter',
    'value',
    'isRetryable',
    'data',
  ]) {
    if (anyErr[key] !== undefined) out[key] = anyErr[key];
  }
  if (err.cause) {
    out.cause =
      err.cause instanceof Error
        ? { name: err.cause.name, message: err.cause.message, stack: err.cause.stack?.split('\n').slice(0, 5).join('\n') }
        : String(err.cause);
  }
  if (err.stack) {
    // First few frames are usually enough to pinpoint the throw site.
    out.stack = err.stack.split('\n').slice(0, 6).join('\n');
  }
  return out;
}
