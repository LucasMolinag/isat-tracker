import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGmailForUser } from "@/lib/gmail";
import { matchFormResponsesForUser } from "@/lib/forms";

export const dynamic = "force-dynamic";

/**
 * POST /api/sync — run Gmail upsert stub + Forms matcher stub for the signed-in user.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gmail = await syncGmailForUser(session.user.id);
  const forms = await matchFormResponsesForUser(session.user.id);

  return NextResponse.json({ gmail, forms });
}
