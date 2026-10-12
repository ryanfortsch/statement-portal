import { auth } from '@/auth';
import { roleForEmail, type HelmRole } from '@/lib/helm-access';

/**
 * The session-side half of `helm-access.ts`: what role is signed in right
 * now. Server components and server actions only (it reads the request's
 * session). The pure role rules stay in `helm-access.ts` so the proxy and
 * client nav can share them without pulling in Auth.js.
 */

/** The signed-in role, or null with no session. */
export async function sessionRole(): Promise<HelmRole | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return roleForEmail(email);
}

/** True for an owner session. Staff and anonymous are both false. */
export async function isOwnerSession(): Promise<boolean> {
  return (await sessionRole()) === 'owner';
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
  if (roleForEmail(email) !== 'owner') throw new Error('Owners only');
  return email;
}
