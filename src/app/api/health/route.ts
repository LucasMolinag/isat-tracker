import { NextResponse } from "next/server";
import { envChecklist } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness, env key presence (no values), and a DB ping.
 */
export async function GET() {
  const checklist = envChecklist();
  const ready = checklist
    .filter((r) => r.key !== "CRON_SECRET")
    .every((r) => r.present);
  const cronReady = checklist.find((r) => r.key === "CRON_SECRET")?.present;

  let database: { ok: boolean; userCount?: number; error?: string } = {
    ok: false,
  };

  try {
    const userCount = await prisma.user.count();
    database = { ok: true, userCount };
  } catch (e) {
    database = {
      ok: false,
      error: e instanceof Error ? e.message : "Database unreachable",
    };
  }

  return NextResponse.json({
    ok: true,
    ready,
    cronReady: Boolean(cronReady),
    database,
    neonBranch: process.env.NEON_BRANCH ?? null,
    env: checklist.map(({ key, present }) => ({ key, present })),
  });
}
