import { NextResponse } from "next/server";
import { assertCronAuthorized } from "@/lib/cron-auth";
import { assertRequiredEnv, envChecklist, missingEnvKeys } from "@/lib/env";
import { syncAllGoogleUsers } from "@/lib/sync-all";

export const dynamic = "force-dynamic";
/** Allow longer runs on Vercel Pro; Hobby still capped by plan. */
export const maxDuration = 60;

/**
 * GET/POST /api/cron/sync
 * Vercel Cron (and manual) entrypoint. Requires CRON_SECRET.
 * Syncs every user with a linked Google account.
 */
async function handle(request: Request) {
  const authz = assertCronAuthorized(request);
  if (!authz.ok) {
    return NextResponse.json(
      { error: "Unauthorized", detail: authz.reason },
      { status: 401 },
    );
  }

  try {
    assertRequiredEnv([
      "DATABASE_URL",
      "AUTH_GOOGLE_CLIENT_ID",
      "AUTH_GOOGLE_CLIENT_SECRET",
      "TOKEN_ENCRYPTION_KEY",
    ]);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Env validation failed",
        missing: missingEnvKeys(),
        checklist: envChecklist().map(({ key, present, hint }) => ({
          key,
          present,
          hint,
        })),
      },
      { status: 503 },
    );
  }

  const summary = await syncAllGoogleUsers();
  return NextResponse.json(
    {
      ok: summary.ok,
      users: summary.users,
      results: summary.results.map((r) => ({
        userId: r.userId,
        email: r.email,
        ok: r.ok,
        gmail: {
          ok: r.gmail.ok,
          created: r.gmail.created,
          upserted: r.gmail.upserted,
          scanned: r.gmail.scanned,
          message: r.gmail.message,
        },
        forms: {
          ok: r.forms.ok,
          matched: r.forms.matched,
          scannedTokens: r.forms.scannedTokens,
          message: r.forms.message,
        },
      })),
    },
    { status: summary.ok ? 200 : 207 },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
