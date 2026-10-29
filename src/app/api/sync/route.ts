import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGmailForUser } from "@/lib/gmail";
import { matchFormResponsesForUser } from "@/lib/forms";
import { assertRequiredEnv, missingEnvKeys } from "@/lib/env";
import {
  assertSameOrigin,
  assertSyncRateLimit,
  sanitizePublicError,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function buildSummary(
  gmail: Awaited<ReturnType<typeof syncGmailForUser>>,
  forms: Awaited<ReturnType<typeof matchFormResponsesForUser>>,
): string {
  if (!gmail.ok) return sanitizePublicError(gmail.message);
  let summary = `Synced ${gmail.scanned} emails · ${gmail.created} new`;
  if (forms.matched > 0) {
    summary += ` · ${forms.matched} submitted`;
  }
  return summary;
}

/**
 * POST /api/sync — session + same-origin + rate-limited.
 * Gmail upsert + quiet Submitted matching for the signed-in user only.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const csrf = assertSameOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json(
      { error: "Forbidden", detail: csrf.reason },
      { status: 403 },
    );
  }

  const rate = assertSyncRateLimit(session.user.id);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error: "Too many sync requests. Try again shortly.",
        retryAfterSec: rate.retryAfterSec,
      },
      {
        status: 429,
        headers: rate.retryAfterSec
          ? { "Retry-After": String(rate.retryAfterSec) }
          : undefined,
      },
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
      gmail: {
        ok: gmail.ok,
        created: gmail.created,
        upserted: gmail.upserted,
        scanned: gmail.scanned,
        message: summary,
        // Intentionally omit Gmail `query` (may include addresses/subjects).
      },
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
