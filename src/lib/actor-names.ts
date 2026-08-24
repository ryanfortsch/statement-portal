/**
 * Display names for actor emails that may belong to someone off the team
 * roster — specifically field contractors.
 *
 * `displayNameForEmail` resolves the three Rising Tide addresses and falls
 * back to the local part for everyone else, which is fine for a pill but
 * reads badly in an activity feed ("delaneyjordan marked X done"). Now that
 * the field portal and packet approval stamp `work_slips.closed_by_email`
 * with the contractor who did the work, the feeds need the real name.
 *
 * `contractors` is RLS-locked, so this reads through the service-role field
 * client — the same pattern the /work board already uses to say
 * "flagged by Delaney". Server-only, and deliberately failure-tolerant: a
 * lookup that errors degrades to the local-part fallback rather than
 * taking the whole feed down.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { displayNameForEmail, getTeamMember } from '@/lib/team';

export type ActorNameLookup = (email: string | null | undefined) => string;

/** Anything with an actor email and a slot to write the resolved name into. */
type Stampable = { actor: string | null; actorName?: string | null };

/**
 * Resolve a batch of actor emails in one round trip. Returns a lookup
 * function so call sites read as `nameFor(event.actor)` inline in JSX.
 */
export async function resolveActorNames(
  emails: Array<string | null | undefined>,
): Promise<ActorNameLookup> {
  const byEmail = new Map<string, string>();
  const unknown = new Set<string>();

  for (const raw of emails) {
    const email = (raw ?? '').trim().toLowerCase();
    if (!email || byEmail.has(email) || unknown.has(email)) continue;
    if (getTeamMember(email)) byEmail.set(email, displayNameForEmail(email));
    else unknown.add(email);
  }

  if (unknown.size > 0) {
    try {
      const { data } = await fieldDb()
        .from('contractors')
        .select('email, full_name')
        .in('email', [...unknown]);
      for (const c of (data ?? []) as Array<{ email: string | null; full_name: string | null }>) {
        const key = (c.email ?? '').trim().toLowerCase();
        const name = (c.full_name ?? '').trim();
        if (key && name) byEmail.set(key, name);
      }
    } catch {
      /* fall through to the local-part fallback below */
    }
  }

  return (email) => {
    const key = (email ?? '').trim().toLowerCase();
    if (!key) return displayNameForEmail(email);
    return byEmail.get(key) ?? displayNameForEmail(email);
  };
}

/**
 * In-place convenience over resolveActorNames for the activity feeds: one
 * round trip for the whole batch, then every row carries its own display
 * name so the renderer stays synchronous.
 */
export async function stampActorNames(events: Stampable[]): Promise<void> {
  if (events.length === 0) return;
  const nameFor = await resolveActorNames(events.map((e) => e.actor));
  for (const e of events) e.actorName = e.actor ? nameFor(e.actor) : null;
}
