import { generateObject } from 'ai';
import { z } from 'zod';
import type { CustomClause } from '@/lib/projections-types';

/**
 * AI polish for per-deal custom Rider clauses (Prospects form, Section 07).
 *
 * The operator types rough notes ("owner buys cleaning supplies up to $50/mo,
 * we front it and deduct"); this returns the same terms rewritten in the
 * contract's own voice. Companion to the redline engine in
 * projection-redlines.ts and deliberately smaller: it never targets the
 * contract body, never invents terms, and never persists anything — the
 * polished text lands back in the form's editable fields for the operator
 * to review before Save.
 */

const PolishedClause = z.object({
  title: z
    .string()
    .describe(
      "Short noun-phrase label for the clause, no trailing colon or period. Renders numbered on the Rider page, e.g. '01. Cleaning Supply Allowance'.",
    ),
  body: z
    .string()
    .describe(
      'Full clause text in contract language. Plain text only, no markdown. Separate paragraphs with a blank line.',
    ),
});

export async function polishCustomClause(args: {
  clause: CustomClause;
  ownerName: string | null;
  propertyAddress: string | null;
}): Promise<CustomClause> {
  const { clause, ownerName, propertyAddress } = args;

  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: PolishedClause,
    system: `You polish per-deal custom clauses for the Rider page of a Rising Tide STR management contract. The operator types rough notes; you return the same terms in clean contract language consistent with the rest of the Agreement.

THE AGREEMENT'S DEFINED TERMS — use these, never casual references:
- "Property Manager" = Rising Tide STR, LLC. Never "we", "us", "Rising Tide", "the company".
- "Owner" = the property owner. Never "you", "the client", or the owner's personal name.
- "the Property", "the Parties", "this Agreement", "Gross Rental Income" where they apply.

HARD RULES
1. Preserve the operator's meaning exactly. Never add an obligation, dollar amount, percentage, date, deadline, or condition that is not in the input, and never drop one that is.
2. If something in the input is vague, keep it at the same level of specificity. Do not resolve ambiguity by inventing detail.
3. Plain text only. No markdown — asterisks and underscores render literally on the Rider page. Separate paragraphs with a blank line.
4. Keep it tight. Rough notes become one or two clean sentences, not a page of boilerplate.
5. If the input is already clean contract language, return it unchanged or nearly so. Do not rewrite for the sake of rewriting.
6. If the title is empty, derive one from the body. If the body is empty, write the minimal clause the title implies and nothing more.`,
    prompt: `DEAL CONTEXT (for correct defined-term usage only — refer to the Parties by defined term, never by these names)
Owner: ${ownerName || '(unfilled)'}
Property: ${propertyAddress || '(unfilled)'}

OPERATOR'S CLAUSE
Title: ${clause.title || '(none)'}
Body:
${clause.body || '(none)'}

Return the polished clause.`,
  });

  return object;
}
