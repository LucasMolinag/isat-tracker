import { NextResponse } from "next/server";
import { envChecklist } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + whether required env keys are present (no values).
 */
export async function GET() {
  const checklist = envChecklist();
  const ready = checklist
    .filter((r) => r.key !== "CRON_SECRET")
    .every((r) => r.present);
  const cronReady = checklist.find((r) => r.key === "CRON_SECRET")?.present;

  return NextResponse.json({
    ok: true,
    ready,
    cronReady: Boolean(cronReady),
    env: checklist.map(({ key, present }) => ({ key, present })),
  });
}
