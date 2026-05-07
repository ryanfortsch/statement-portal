"use server";

import { signOut } from "@/auth";

/**
 * Sign-out action used by UserMenu (and anywhere else that needs a sign-out
 * form). Exported from a top-level "use server" file so it stays callable
 * from client and server component trees alike — inlining `"use server"`
 * inside an async arrow handler in UserMenu broke the Turbopack build when
 * any client component tree (e.g. /statements/upload) pulled UserMenu in
 * via HelmMasthead.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/auth/signin" });
}
