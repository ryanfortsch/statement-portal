import { auth } from "@/auth";
import { signOutAction } from "@/auth-actions";

/**
 * Sign-in indicator + sign-out button shown in HelmMasthead.
 *
 * Compact form: a single circular avatar with the user's first initial,
 * acts as the sign-out trigger. Hover/title surfaces the full username
 * for shared workstations. Replaces the previous "DOTTI / SIGN OUT" pair
 * which ate ~130px of horizontal space at the right edge of the
 * masthead at a density that was already too tight.
 *
 * Renders nothing if there's no session (so the masthead on /auth/signin
 * doesn't show an empty slot).
 */
export async function UserMenu() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const username = session.user.email.split("@")[0];
  const initial = (session.user.name || username).trim().charAt(0).toUpperCase() || "?";

  return (
    <form action={signOutAction} style={{ display: "inline-flex" }}>
      <button
        type="submit"
        title={`Sign out (${username})`}
        aria-label={`Sign out as ${username}`}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--paper-2)",
          border: "1px solid var(--rule)",
          color: "var(--ink-2)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          fontFamily: "inherit",
        }}
      >
        {initial}
      </button>
    </form>
  );
}
