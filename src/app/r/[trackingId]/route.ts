import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transitionEntryStatus } from "@/lib/status";
import { buildTrackedFormUrl } from "@/lib/forms";

export const dynamic = "force-dynamic";

/**
 * GET /r/{trackingId}
 * Marks the entry Read only (never Submitted — that requires a real Google
 * Form submit, detected later via Sheet/Forms matcher). Redirects to the
 * per-email Google Form URL. Does not overwrite QoS rating prefills (=3).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await context.params;

  const entry = await prisma.emailEntry.findUnique({
    where: { trackingId },
    include: { formConfig: true },
  });

  if (!entry) {
    return NextResponse.json(
      { error: "Unknown tracking link" },
      { status: 404 },
    );
  }

  // Open → Read only. Never Submitted on click/open.
  await transitionEntryStatus(entry.id, "Read", "open tracked form link");

  // Per-email form URL only — no Settings FormConfig.formUrl fallback.
  const formUrl = entry.formUrl;
  if (!formUrl) {
    return NextResponse.json(
      {
        error:
          "No Google Form URL on this email. Re-sync after the message includes a forms link.",
        trackingId,
        status: entry.status,
      },
      { status: 422 },
    );
  }

  // Preserves existing prefills (e.g. entry.2115622678=3); does not inject
  // tracking UUID over the QoS rating field.
  const target = buildTrackedFormUrl(
    formUrl,
    entry.formConfig?.entryFieldId,
    entry.trackingId,
  );

  return NextResponse.redirect(target, 302);
}
