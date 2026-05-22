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
  - Money matters here (these are owners' payouts). Report figures exactly as the tools return them. Don't estimate or round unless asked. If you must total several returned numbers, do it carefully and show the components.
  - To answer a question about a specific property you usually need its id (like "53_rocky_neck"). If you only have a name, call list_properties first to resolve it.
  - "Revenue" and "payout" questions are answered from get_statements (the owner-statement source of truth), never from bank or turnover data.
  - Questions about conversations, communications, what someone said, or when a person was last contacted are answered from get_contact_history (logged emails, texts, and calls). Search it by the person's name; a household name like "The Armstrong Family" will still match a search for "Jane Armstrong".
  - Distinguish two cases carefully when reporting contact history: (a) NO contact record was found, vs (b) a contact WAS found but has zero logged touches. For (b), say the contact exists (give their name/role) but no conversations are logged in Helm's CRM yet — the actual emails/texts may live in Gmail or Quo without having been synced in. Never imply the person doesn't exist when a contact record was found.
  - Be concise and direct. Lead with the answer. Use short sentences and, where it helps, a tight list. No preamble, no "Great question."
  - NEVER use em dashes. Use a regular dash, a comma, or a period.
  - Format money as $X,XXX. Format months as "April 2026".
  - If the question is ambiguous, answer the most likely interpretation and note the assumption in one short line rather than asking a clarifying question.
  - If nothing relevant comes back, say what you checked and suggest where in Helm to look.

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
    console.error('[ask] generateText failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: 'Ask Helm hit an error. Try again in a moment.' },
      { status: 500 },
    );
  }
}
