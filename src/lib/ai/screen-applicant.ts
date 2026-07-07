/**
 * AI first-pass screening for Field applications.
 *
 * Scores each applicant against the Vacation Rental Specialist profile and
 * returns an advisory recommendation the Applicants page sorts by. This is a
 * triage aid, NOT a decision -- the operator still clicks Invite / Decline. We
 * deliberately lean fair: a short-but-qualified application (local + vehicle)
 * should not be punished for brevity, and keyword-stuffing should not be
 * rewarded.
 *
 * One Haiku call per batch, same shape as triage-emails. On any failure we
 * return no verdicts so the page still renders (the row stays "unscreened" and
 * the Screen button can retry).
 */

import { generateObject } from 'ai';
import { z } from 'zod';

export type ScreenRecommendation = 'reach_out' | 'maybe' | 'pass';

export type ScreenVerdict = {
  recommendation: ScreenRecommendation;
  score: number; // 0-100
  reason: string;
};

/** The signals we screen on. Mirrors the columns on contractor_applications. */
export type ScreenInput = {
  id: string;
  full_name: string;
  area: string | null;
  has_transport: boolean | null;
  availability: string | null;
  about: string | null;
  heard_about: string | null;
  video_url: string | null;
  trade: string;
};

const ItemSchema = z.object({
  index: z
    .number()
    .int()
    .describe('The 1-based number of the applicant in the list, exactly as labeled. Return one entry per applicant.'),
  recommendation: z
    .enum(['reach_out', 'maybe', 'pass'])
    .describe(
      'reach_out = strong fit worth contacting. maybe = some fit but a real gap or thin signal. pass = a disqualifier or almost no signal.',
    ),
  score: z
    .number()
    .min(0)
    .max(100)
    .describe('Overall fit 0-100. reach_out ~ 70-100, maybe ~ 40-69, pass ~ 0-39. Drives the sort.'),
  reason: z
    .string()
    .describe(
      'One tight sentence naming the deciding factors (location, vehicle, experience, effort). Plain English, under 22 words. No "This applicant".',
    ),
});

const BatchSchema = z.object({ items: z.array(ItemSchema) });

const SYSTEM_PROMPT = `You are screening applicants for Rising Tide STR, a vacation rental management company on Cape Ann, Massachusetts (Gloucester, Rockport, Manchester-by-the-Sea, Essex, Magnolia, plus nearby Beverly, Ipswich, Hamilton, Wenham).

Each applicant states a role (the "role:" line). Score each against THAT role's profile, not the others. All roles are 1099, local, and prize consistent five-star quality and people who take pride in their work.

Role profiles:
- inspection (Vacation Rental Specialist): drives to 2-5 homes per trip between guests to confirm each home is flawless and guest-ready, flag maintenance, and check supplies. A reliable vehicle is effectively required (it is a driving route) and location weighs heavily. Relevant background: property, hospitality, cleaning, home maintenance, customer service, caretaking.
- maintenance (Maintenance Tech): repairs and upkeep between guests. A vehicle is effectively required (tools + driving to homes). Relevant background: handyman, trades, general contracting, property maintenance.
- creative (Social Media Contributor): shoots and edits short video and photos at the homes for the company's Instagram/Pinterest. Judge mostly on a real portfolio or social handles, a warm/editorial/authentic aesthetic, and the ability to shoot AND edit (phone is fine). Local to Cape Ann matters (they drive to homes); a vehicle helps but is not the route-critical factor it is for the other roles. Ignore lack of "property/cleaning" experience for this role.
- cleaning (Turnover Cleaner): resets homes to five-star condition between guests on a tight same-day clock. A vehicle and reliability matter; cleaning/housekeeping background is a plus.

Buckets:
- reach_out: clearly fits the stated role's profile with the role-critical factors present.
- maybe: some fit but a real gap or thin signal for that role.
- pass: a disqualifier for that role or almost no signal (empty / throwaway application, or based well outside the area).

Be fair and concrete:
- Judge against the applicant's OWN role. A creative applicant with no cleaning experience is not a negative; a strong portfolio is the point.
- Do NOT punish a short application that still shows the basics for its role. Brevity is not a red flag.
- Do NOT reward keyword-stuffing or generic enthusiasm with no substance.
- You CANNOT watch the intro video or open portfolio links. Treat their presence only as a motivation/effort signal; never judge or assume their content.
- A referral ("heard about us" naming a person) is a meaningful positive.

reason: one tight sentence naming the deciding factors, under 22 words, plain English. State the call, e.g. "Local Gloucester, has a vehicle, cleaning background -- strong fit." or "Editorial IG portfolio, shoots and edits, Rockport local -- strong creative fit."`;

/** Screen a batch of applications in one call. Returns a map keyed by the
 *  application id. Results are matched back by the 1-based list index we
 *  control (NOT by asking the model to echo a UUID, which it mangles), so the
 *  mapping is robust. A dropped or out-of-range index is simply skipped and
 *  that row stays unscreened. */
export async function screenApplications(apps: ScreenInput[]): Promise<Map<string, ScreenVerdict>> {
  const out = new Map<string, ScreenVerdict>();
  if (!apps.length) return out;

  const lines = apps.map((a, i) => {
    const vehicle = a.has_transport == null ? 'not answered' : a.has_transport ? 'yes' : 'no';
    return [
      `Applicant ${i + 1}:`,
      `   role: ${a.trade}`,
      `   based: ${a.area || '(blank)'}`,
      `   reliable vehicle: ${vehicle}`,
      `   availability: ${a.availability || '(blank)'}`,
      `   heard about us: ${a.heard_about || '(blank)'}`,
      `   intro video submitted: ${a.video_url ? 'yes' : 'no'}`,
      `   about (their words): ${a.about ? a.about.slice(0, 600) : '(blank)'}`,
    ].join('\n');
  });

  try {
    const { object } = await generateObject({
      model: 'anthropic/claude-haiku-4.5',
      schema: BatchSchema,
      system: SYSTEM_PROMPT,
      prompt: `Screen these ${apps.length} applicant(s). Return exactly one entry per applicant, using its number (1 to ${apps.length}) as the index.\n\n${lines.join('\n\n')}`,
    });
    for (const item of object.items) {
      const target = apps[item.index - 1];
      if (!target) continue;
      out.set(target.id, {
        recommendation: item.recommendation,
        score: Math.max(0, Math.min(100, Math.round(item.score))),
        reason: item.reason.trim(),
      });
    }
    console.log(`[screen-applicant] in=${apps.length} verdicts=${out.size}`);
  } catch (err) {
    console.error('[screen-applicant]', err);
  }
  return out;
}

/** Convenience for the single applicant the submit action just received. */
export async function screenApplication(app: ScreenInput): Promise<ScreenVerdict | null> {
  const map = await screenApplications([app]);
  return map.get(app.id) ?? null;
}
