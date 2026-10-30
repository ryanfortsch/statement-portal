import { operatingDate } from './operating-date.ts';

export type DraftTiming = { createdAt: string | null | undefined; text: string };

/** A relative day belongs to the day the draft was written, in Gloucester.
 * Never expire an evergreen repair or an unresolved obligation just for age.
 * This is a conservative send guard, not an extractor of arbitrary dates. */
export function draftValidity({ createdAt, text }: DraftTiming, now = new Date()): {
  context?: string; blocked?: string;
} {
  const relative = /(?<!\p{L})(today|tonight|tomorrow|this (?:morning|afternoon|evening)|hoje|amanh[ãa])(?!\p{L})/iu.exec(text);
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(m => m[1])
    .filter(d => !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d);
  const today = operatingDate(now);
  if (relative) {
    const created = createdAt ? new Date(createdAt) : null;
    if (!created || Number.isNaN(created.getTime())) return { blocked: 'The date behind this time-sensitive draft is unavailable. Refresh the draft before sending.' };
    const writtenDay = operatingDate(created);
    const tomorrow = /^(tomorrow|amanh[ãa])$/iu.test(relative[0]);
    const eventDay = tomorrow ? new Date(Date.parse(`${writtenDay}T12:00:00Z`) + 86400000).toISOString().slice(0, 10) : writtenDay;
    return {
      context: `“${relative[0]}” refers to ${eventDay} (Eastern time).`,
      ...(today !== writtenDay ? { blocked: `This draft's relative date is out of date. Check what happened, then refresh the draft before sending.` } : {}),
    };
  }
  if (dates.length) {
    const last = [...dates].sort().at(-1)!;
    return { context: `Date mentioned: ${last}.`, ...(last < today ? { blocked: 'The date mentioned in this draft has passed. Check what happened, then refresh or edit the draft before sending.' } : {}) };
  }
  return {};
}
