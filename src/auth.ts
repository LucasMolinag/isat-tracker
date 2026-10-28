import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { EncryptedPrismaAdapter } from "@/lib/encrypted-prisma-adapter";

/**
 * Auth.js (NextAuth v5) — Google provider with Gmail + Sheets scopes.
 * Set AUTH_GOOGLE_CLIENT_ID / AUTH_GOOGLE_CLIENT_SECRET (or GOOGLE_* aliases).
 */
const googleClientId =
  process.env.AUTH_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret =
  process.env.AUTH_GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: EncryptedPrismaAdapter(prisma),
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      authorization: {
        params: {
          // Offline access so we can sync Gmail/Forms in the background.
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            // Forms responses if Forms API is enabled in GCP:
            "https://www.googleapis.com/auth/forms.responses.readonly",
          ].join(" "),
        },
      },
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  // Avoid hard crash during `next build` when secrets are absent in CI.
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});
