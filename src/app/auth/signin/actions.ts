'use server';

import { signIn } from '@/auth';
import { isWorkspaceEmail, safeCallbackPath } from '@/lib/auth-resume';

/**
 * The silent half of sign-in (src/lib/auth-resume.ts): ask Google to sign
 * the person this browser last saw back in, with no picker and no password.
 * Google answers silently when its own session is alive; otherwise it sends
 * an error back to /auth/signin, which shows the usual button.
 */
export async function resumeSignIn(formData: FormData) {
  const hint = String(formData.get('hint') ?? '');
  const redirectTo = safeCallbackPath(String(formData.get('callbackUrl') ?? ''));
  if (!isWorkspaceEmail(hint)) {
    await signIn('google', { redirectTo });
    return;
  }
  await signIn('google', { redirectTo }, { prompt: 'none', login_hint: hint });
}
