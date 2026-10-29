/** Approval wording is derived only from enabled proposals, never the draft. */
type Action = { kind: string; start?: string; end?: string };
const DAY = 86_400_000;
function nightCount(action: Action): number | null {
  if (!action.start || !action.end) return null;
  const a = Date.parse(`${action.start}T00:00:00Z`), b = Date.parse(`${action.end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || new Date(a).toISOString().slice(0, 10) !== action.start || new Date(b).toISOString().slice(0, 10) !== action.end) return null;
  const count = (b - a) / DAY + 1;
  return Number.isInteger(count) && count > 0 && count <= 366 ? count : null;
}
function day(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
export function ownerStayLabel(action: Action): string {
  const count = nightCount(action);
  if (!count) return 'Review owner-stay dates';
  const dates = action.start === action.end ? day(action.start!) : `${day(action.start!)} through ${day(action.end!)}`;
  return `Guesty: block ${dates} · ${count} night${count === 1 ? '' : 's'}`;
}
export function ownerApprovalPlan(actions: Action[], channel: string): { label: string; summary: string; pending: string } | undefined {
  const stays = actions.filter(a => a.kind === 'owner_stay');
  if (!stays.length) return;
  const counts = stays.map(nightCount);
  if (counts.some(n => n === null)) return { label: 'Review dates & send', summary: 'Review the owner-stay dates before approving.', pending: 'Checking dates' };
  const nights = counts.reduce<number>((sum, n) => sum + n!, 0);
  return { label: `Block ${nights} night${nights === 1 ? '' : 's'} & send`,
    summary: `Block and verify these nights in Guesty, then send the ${channel === 'SMS' ? 'SMS' : 'email reply'}. A failed block stops the reply.`,
    pending: 'Checking Guesty & sending' };
}
