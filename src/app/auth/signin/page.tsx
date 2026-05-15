import { signIn } from "@/auth";
import { ShipWheel } from "./ShipWheel";

type SearchParams = { callbackUrl?: string; error?: string };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { callbackUrl, error } = await searchParams;

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--paper)" }}
    >
      <div style={{ width: "100%", maxWidth: 380, padding: "0 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ marginBottom: 24 }}>
            <ShipWheel size={140} />
          </div>
          <h1
            className="font-serif"
            style={{
              fontSize: 36,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "var(--ink)",
              margin: 0,
            }}
          >
            Helm
          </h1>
          <div className="eyebrow" style={{ marginTop: 10 }}>
            Rising Tide &middot; Internal Operations
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 20,
              padding: "10px 14px",
              borderLeft: "3px solid var(--negative)",
              background: "var(--paper-2)",
              fontSize: 12,
              color: "var(--negative)",
            }}
          >
            {errorMessage(error)}
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl ?? "/" });
          }}
        >
          <button
            type="submit"
            style={{
              width: "100%",
              background: "var(--ink)",
              color: "var(--paper)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: ".18em",
              textTransform: "uppercase",
              padding: "16px 0",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <GoogleMark />
            Continue with Google
          </button>
        </form>

        <p
          style={{
            textAlign: "center",
            color: "var(--ink-4)",
            fontSize: 10,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            marginTop: 32,
          }}
        >
          Sign in with your @risingtidestr.com account
        </p>
      </div>
    </div>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case "AccessDenied":
      return "Sign-in is restricted to @risingtidestr.com accounts.";
    case "Configuration":
      return "Auth is not configured. Check that AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, and AUTH_SECRET are set.";
    case "Verification":
      return "The sign-in link expired or was already used.";
    default:
      return `Sign-in failed (${code}). Try again, or check the server logs.`;
  }
}

function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
      />
    </svg>
  );
}
