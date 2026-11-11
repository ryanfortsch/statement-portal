/**
 * Signing a person back in when their phone drops the Helm cookie.
 *
 * Delaney (2026-11-10): Helm "times out" on her iPhone, in Safari and in the
 * home-screen app, and makes her sign in again. The session itself is fine
 * on the server: a 90-day JWT rolled forward on every request (src/auth.ts),
 * and production logged no rejected session cookie (no JWTSessionError) in
 * the days around her reports. Each forced sign-in was a request that
 * arrived with no Helm cookie at all, so something on the device dropped it.
 *
 * Two things live here:
 *
 * 1. Resume. Every signed-in page remembers the Workspace address in this
 *    browser's localStorage. When the sign-in page opens with no error and
 *    that address on file, it asks Google to sign the same person in with
 *    `prompt=none`: no account picker and no password, just a redirect.
 *    Google answers silently when its own session is still alive, which
 *    turns a forced sign-in into a second of redirects. When Google needs
 *    the person, it returns an error, the page shows that error, and the
 *    usual button takes over. An error on the page or a recent attempt
 *    stops a second try, so it can never loop. Sign out forgets the address,
 *    so signing out stays signed out.
 *
 * 2. Evidence. The proxy logs one line per forced sign-in naming which Auth.js
 *    cookies came with the request and what kind of browser sent it (cookie
 *    NAMES only, never values). A session cookie present means the server
 *    refused it; absent with the CSRF cookie still there means only the
 *    session cookie went; nothing at all means the browser's storage was
 *    cleared. That tells us what to fix next.
 */

/** localStorage: the Workspace address last signed in on this browser. */
export const LAST_SIGN_IN_KEY = 'helm:last-sign-in';
/** localStorage: when the sign-in page last tried a silent resume (epoch ms). */
export const RESUME_ATTEMPT_KEY = 'helm:resume-attempt';
/** One silent attempt per this window, whatever Google answers. */
export const RESUME_COOLDOWN_MS = 5 * 60 * 1000;

export function isWorkspaceEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^@\s]+@risingtidestr\.com$/i.test(value);
}

export function shouldResumeSignIn(input: {
  hint: string | null;
  error: string | null | undefined;
  lastAttemptAt: number | null;
  now: number;
}): boolean {
  if (input.error) return false;
  if (!isWorkspaceEmail(input.hint)) return false;
  if (input.lastAttemptAt != null && Number.isFinite(input.lastAttemptAt)) {
    const since = input.now - input.lastAttemptAt;
    if (since >= 0 && since < RESUME_COOLDOWN_MS) return false;
  }
  return true;
}

/** A same-origin path to land on after sign-in; anything else is home. */
export function safeCallbackPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith('/auth/') || value.startsWith('/api/auth/')) return '/';
  return value;
}

/** The kind of browser, coarse on purpose: enough to tell Safari from the home-screen app. */
export function clientKind(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) {
    if (/CriOS\//.test(ua)) return 'ios-chrome';
    if (/FxiOS\//.test(ua)) return 'ios-firefox';
    if (/EdgiOS\//.test(ua)) return 'ios-edge';
    if (/GSA\//.test(ua)) return 'ios-google-app';
    if (/Safari\//.test(ua)) return 'ios-safari';
    // iOS home-screen web apps and most in-app browsers drop the Safari token.
    return 'ios-home-screen-or-in-app';
  }
  if (/Android/.test(ua)) return /Chrome\//.test(ua) ? 'android-chrome' : 'android-other';
  if (!ua) return 'unknown';
  return 'desktop';
}

/** What a request carried when it was sent to sign in. Cookie names only. */
export function describeSignInRequest(cookieNames: string[], userAgent: string | null | undefined) {
  const has = (part: string) => cookieNames.some((n) => n.includes(part));
  return {
    session_cookie: has('authjs.session-token'),
    csrf_cookie: has('authjs.csrf-token'),
    callback_cookie: has('authjs.callback-url'),
    cookie_count: cookieNames.length,
    client: clientKind(userAgent),
  };
}
