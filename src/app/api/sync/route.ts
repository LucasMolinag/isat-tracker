import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGmailForUser } from "@/lib/gmail";
import { matchFormResponsesForUser } from "@/lib/forms";

export const dynamic = "force-dynamic";

/**
 * POST /api/sync — Gmail subject upsert + Forms/Sheets → Submitted for the signed-in user.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
