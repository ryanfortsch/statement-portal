import { auth } from "@/auth";
import { signOutAction } from "@/auth-actions";

/**
 * Sign-in indicator + sign-out button shown in HelmMasthead.
 * Renders nothing if there's no session (so the masthead on /auth/signin
 * doesn't show an empty slot).
 */
export async function UserMenu() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const username = session.user.email.split("@")[0];

  return (
    <div className="flex items-center gap-3">
      <span
        style={{
          fontSize: 11,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {username}
      </span>
      <form action={signOutAction}>
        <button
          type="submit"
          title="Sign out"
          style={{
            fontSize: 10,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "var(--ink-4)",
            background: "none",
            border: "1px solid var(--rule)",
            cursor: "pointer",
            padding: "4px 10px",
          }}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
