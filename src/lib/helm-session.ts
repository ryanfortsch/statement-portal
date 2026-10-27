/** Auth.js can return a truthy error object. Only an identified Workspace user is a session. */
export function hasHelmSession(session: unknown): session is { user: { email: string } } {
  if (!session || typeof session !== 'object' || 'error' in session) return false;
  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return false;
  const email = (user as { email?: unknown }).email;
  return typeof email === 'string' && /^[^@\s]+@risingtidestr\.com$/i.test(email);
}
