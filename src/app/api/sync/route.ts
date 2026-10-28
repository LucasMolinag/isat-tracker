import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGmailForUser } from "@/lib/gmail";
import { matchFormResponsesForUser } from "@/lib/forms";
import { assertRequiredEnv, missingEnvKeys } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync — Gmail upsert + Forms/Sheets → Submitted for the signed-in user.
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
  const forms = await matchFormResponsesForUser(userId);

  const ok = gmail.ok && forms.ok;
  return NextResponse.json(
    { ok, gmail, forms },
    { status: ok ? 200 : 207 },
  );
}
