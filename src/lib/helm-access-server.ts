import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { canDispatch, effectiveRole, helmView, VIEW_AS_COOKIE, type HelmRole, type HelmView } from '@/lib/helm-access';

/**
 * The session-side half of `helm-access.ts`: what role is signed in right
 * now. Server components and server actions only (it reads the request's
 * session). The pure role rules stay in `helm-access.ts` so the proxy and
 * client nav can share them without pulling in Auth.js.
 *
 * Every role here is the EFFECTIVE one (`effectiveRole`): an owner who
 * chose View as staff is staff to every page, action and route that asks,
 * and is refused exactly as a staff login would be. Only the switch itself
 * (`src/app/view-as-actions.ts`) reads the login's own role.
 */

async function viewAsCookie(): Promise<string | undefined> {
  return (await cookies()).get(VIEW_AS_COOKIE)?.value;
}

/** The signed-in role, or null with no session. */
export async function sessionRole(): Promise<HelmRole | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return effectiveRole(email, await viewAsCookie());
}

/** True for an owner session. Staff and anonymous are both false. */
export async function isOwnerSession(): Promise<boolean> {
  return (await sessionRole()) === 'owner';
}

/** The role and the View as staff switch, for the root layout to hand the client chrome. */
export async function sessionView(): Promise<HelmView> {
  const session = await auth();
  return helmView(session?.user?.email, await viewAsCookie());
}

/**
 * The email of the signed-in OWNER, or a throw. The guard for any server
 * action that moves money or reveals a contractor's pay or tax details:
 * Next treats a server action like a public endpoint, so the page a staff
 * login cannot open is not enough on its own.
 */
export async function requireOwnerEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error('Not signed in');
  if (effectiveRole(email, await viewAsCookie()) !== 'owner') throw new Error('Owners only');
  return email;
}

/** True when the signed-in person holds the dispatch duty, in their own view. */
export async function sessionDispatches(): Promise<boolean> {
  const session = await auth();
  return canDispatch(session?.user?.email, await viewAsCookie());
}

/**
 * The email of the signed-in DISPATCHER, or a throw: the guard on a server
 * action that creates, publishes or hands out a Field packet. The walk
 * actions ask `sessionDispatches()` and answer in words instead, since the
 * grid shows the reason on the cell.
 */
export async function requireDispatchEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error('Not signed in');
  if (!canDispatch(email, await viewAsCookie())) throw new Error('Dispatch only');
  return email;
}
