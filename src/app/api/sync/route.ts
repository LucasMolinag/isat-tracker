import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGmailForUser } from "@/lib/gmail";
import { matchFormResponsesForUser } from "@/lib/forms";
import { assertRequiredEnv, missingEnvKeys } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function buildSummary(
  gmail: Awaited<ReturnType<typeof syncGmailForUser>>,
  forms: Awaited<ReturnType<typeof matchFormResponsesForUser>>,
): string {
  if (!gmail.ok) return gmail.message;
  let summary = `Synced ${gmail.scanned} emails · ${gmail.created} new`;
  if (forms.matched > 0) {
    summary += ` · ${forms.matched} submitted`;
  }
  return summary;
}

/**
 * POST /api/sync — Gmail upsert + quiet Submitted matching for the signed-in user.
 * Submitted comes from Sheet/Forms responses (ticket key), never from Open form.
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
  const summary = buildSummary(gmail, forms);

  return NextResponse.json(
    {
      ok: gmail.ok,
      summary,
      gmail: { ...gmail, message: summary },
      forms: {
        ok: true,
        stub: forms.stub,
        matched: forms.matched,
        scannedTokens: forms.scannedTokens,
        message: "",
      },
    },
    { status: gmail.ok ? 200 : 502 },
  );
}
