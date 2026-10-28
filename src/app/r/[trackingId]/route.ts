import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transitionEntryStatus } from "@/lib/status";
import { buildTrackedFormUrl } from "@/lib/forms";

export const dynamic = "force-dynamic";

/**
 * GET /r/{trackingId}
 * Marks the entry Read (never downgrades Submitted), then redirects to the
 * Google Form with the tracking token prefilled into entry.<fieldId>.
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

  // Idempotent: Submitted wins if already submitted.
  await transitionEntryStatus(entry.id, "Read", "open tracked form link");

  if (!entry.formConfig) {
    return NextResponse.json(
      {
        error:
          "No form configured for this entry. Set FormConfig in Settings, then re-sync.",
        trackingId,
        status: entry.status,
      },
      { status: 422 },
    );
  }

  const target = buildTrackedFormUrl(
    entry.formConfig.formUrl,
    entry.formConfig.entryFieldId,
    entry.trackingId,
  );

  return NextResponse.redirect(target, 302);
}
