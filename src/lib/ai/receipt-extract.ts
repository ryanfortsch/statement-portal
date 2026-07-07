/**
 * AI receipt extraction for the property-expense capture flow.
 *
 * The operator photographs a paper receipt (Home Depot run, smoke
 * detectors, a new door lock) on the Statements dashboard; this module
 * reads the image and prefills the review form: vendor, grand total,
 * printed date, a short owner-facing note, and a category guess.
 *
 * ASSIST ONLY -- nothing here writes anywhere. The extraction lands on an
 * editable review form and the operator explicitly Confirms before
 * POST /api/receipts commits a row. A hallucination costs one operator
 * glance, never a wrong owner payout.
 *
 * Model + transport mirror lib/ai/photo-captions.ts: Claude via the Vercel
 * AI Gateway, the image forwarded as a base64 data-URL content part.
 * Haiku is the repo's existing cheap tier (triage-emails, screen-applicant);
 * bump the string to 'anthropic/claude-sonnet-4.5' if extraction quality
 * disappoints -- one-line change.
 */

import { generateObject } from 'ai';
import { z } from 'zod';

const MODEL = 'anthropic/claude-haiku-4.5';

export const ReceiptExtractSchema = z.object({
  vendor: z
    .string()
    .nullable()
    .describe('The merchant / store name as printed on the receipt, e.g. "Home Depot". Null if unreadable.'),
  amount: z
    .number()
    .nullable()
    .describe('The GRAND TOTAL in dollars, including tax -- the final amount actually paid. Never a subtotal, never a line item. Null if the total is not clearly printed.'),
  expense_date: z
    .string()
    .nullable()
    .describe("The printed transaction date in 'YYYY-MM-DD' format. Null if no date is legible."),
  category: z
    .enum(['repairs', 'supplies', 'other'])
    .nullable()
    .describe('Best guess from what was purchased: repairs = parts/hardware/service for fixing something; supplies = consumables and household stock; other = anything else. Null if unclear.'),
  note: z
    .string()
    .nullable()
    .describe('A 5-8 word owner-facing description of what was bought, e.g. "Replacement smoke detectors and batteries". Plain, concrete, no store name. Null if the items are unreadable.'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('Overall read confidence: high = crisp receipt, total and date certain; low = blurry / partial / guessing.'),
});

export type ReceiptExtract = z.infer<typeof ReceiptExtractSchema>;

const SYSTEM = `You read a photo of a single paper receipt for a property-management bookkeeper and extract only what is LITERALLY PRINTED on it.

Hard rules:
- Never guess an amount. If the grand total is not clearly legible, return null for amount. A wrong dollar figure is worse than no figure.
- The amount is the final total paid (including tax), not a subtotal or line item.
- Dates come from the printed transaction date only, formatted YYYY-MM-DD. Do not infer a date from context.
- Null any field you cannot read with confidence. Partial reads are fine -- a vendor with a null amount is a valid answer.
- The note describes what was purchased in 5-8 plain words for a property owner's statement. No hype, no store name, no em dashes.`;

const INSTRUCTION =
  'Extract the vendor, grand total, printed date, a short owner-facing note, and a category from this receipt photo. Null anything you cannot read clearly.';

/**
 * Extract structured fields from a receipt image. `imageDataUrl` is a
 * base64 data URL (data:image/jpeg;base64,...). Throws on transport /
 * gateway errors -- the /api/receipts/extract route catches everything and
 * degrades to manual entry.
 */
export async function extractReceipt(imageDataUrl: string): Promise<ReceiptExtract> {
  const { object } = await generateObject({
    model: MODEL,
    schema: ReceiptExtractSchema,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: INSTRUCTION },
          { type: 'image', image: imageDataUrl },
        ],
      },
    ],
  });
  return object;
}
