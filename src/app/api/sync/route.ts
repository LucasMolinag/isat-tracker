import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGmailForUser } from "@/lib/gmail";
import { matchFormResponsesForUser } from "@/lib/forms";
import { assertRequiredEnv, missingEnvKeys } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function buildSummary(gmail: Awaited<ReturnType<typeof syncGmailForUser>>): string {
  if (!gmail.ok) return gmail.message;
  return `Synced ${gmail.scanned} emails · ${gmail.created} new`;
}

/**
 * POST /api/sync — Gmail upsert for the signed-in user.
 * Forms/Submitted matching is deferred (soft-skipped); Open form uses per-email URLs.
 * Scheduled multi-user sync lives at GET/POST /api/cron/sync (CRON_SECRET).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      },
      { status: 503 },
    );
  }

  const userId = session.user.id;
  const gmail = await syncGmailForUser(userId);
  // Soft-skip: never surface Forms matcher noise in the Sync UX.
  const forms = await matchFormResponsesForUser(userId);
  const summary = buildSummary(gmail);

  return NextResponse.json(
    {
      ok: gmail.ok,
      summary,
      gmail: { ...gmail, message: summary },
      forms: {
        ok: true,
        stub: true,
        matched: forms.matched,
        scannedTokens: 0,
        message: "",
      },
    },
    { status: gmail.ok ? 200 : 502 },
  );
}
