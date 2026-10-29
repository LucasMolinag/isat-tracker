import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { transitionEntryStatus } from "@/lib/status";
import { buildTrackedFormUrl } from "@/lib/forms";

export const dynamic = "force-dynamic";

/**
 * GET /r/{trackingId}
 * Session required (same-site cookie still sent for target=_blank).
 * Scoped to the signed-in owner — no cross-user IDOR.
 * Marks Read only (never Submitted). Generic errors; no PII.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ trackingId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { trackingId } = await context.params;
  if (!trackingId || trackingId.length > 80) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const entry = await prisma.emailEntry.findFirst({
    where: { trackingId, userId: session.user.id },
    include: { formConfig: true },
  });

  // Same 404 for missing vs other user's entry (no existence leak).
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Open → Read only. Never Submitted on click/open.
  await transitionEntryStatus(entry.id, "Read", "open tracked form link");

  const formUrl = entry.formUrl;
  if (!formUrl) {
    return NextResponse.json(
      { error: "Form link unavailable. Sync again from the dashboard." },
      { status: 422 },
    );
  }

  const target = buildTrackedFormUrl(
    formUrl,
    entry.formConfig?.entryFieldId,
    entry.trackingId,
  );

  return NextResponse.redirect(target, 302);
}
