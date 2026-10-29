import { NextResponse } from "next/server";
import { envChecklist } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness, env key presence (never values), DB ping.
 * Does not expose user counts or other tenant metrics.
 */
export async function GET() {
  const checklist = envChecklist();
  const ready = checklist
    .filter((r) => r.key !== "CRON_SECRET")
    .every((r) => r.present);
  const cronReady = checklist.find((r) => r.key === "CRON_SECRET")?.present;

  let database: { ok: boolean; error?: string } = { ok: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true };
  } catch {
    database = { ok: false, error: "Database unreachable" };
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
