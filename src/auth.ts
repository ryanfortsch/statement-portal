import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Helm uses Google SSO via Auth.js v5. The OAuth client in Google Cloud is
 * set to "Internal," which restricts sign-in to the Rising Tide Workspace
 * org. We re-check the email domain in the signIn callback as a belt-and-
 * suspenders check so a config slip on the Google side can't widen access.
 *
 * Env vars (set in Vercel and .env.local):
 *   AUTH_GOOGLE_ID
 *   AUTH_GOOGLE_SECRET
 *   AUTH_SECRET
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email ?? "";
      return email.endsWith("@risingtidestr.com");
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
  },
});
