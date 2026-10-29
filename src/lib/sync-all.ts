import { prisma } from "@/lib/prisma";
import { syncGmailForUser } from "@/lib/gmail";
import { matchFormResponsesForUser } from "@/lib/forms";

export type UserSyncSummary = {
  userId: string;
  email: string | null;
  ok: boolean;
  gmail: Awaited<ReturnType<typeof syncGmailForUser>>;
  forms: Awaited<ReturnType<typeof matchFormResponsesForUser>>;
};

/**
 * Run Gmail + Submitted (Sheet/Forms ticket-key) sync for every Google-linked user.
 * Forms failures are soft-skipped so cron stays green when Sheet id is unset.
 */
export async function syncAllGoogleUsers(): Promise<{
  ok: boolean;
  users: number;
  results: UserSyncSummary[];
}> {
  const accounts = await prisma.account.findMany({
    where: { provider: "google" },
    select: {
      userId: true,
      user: { select: { email: true } },
    },
  });

  const seen = new Set<string>();
  const results: UserSyncSummary[] = [];

  for (const account of accounts) {
    if (seen.has(account.userId)) continue;
    seen.add(account.userId);

    const gmail = await syncGmailForUser(account.userId);
    const forms = await matchFormResponsesForUser(account.userId);
    results.push({
      userId: account.userId,
      email: account.user.email,
      ok: gmail.ok,
      gmail,
      forms: { ...forms, ok: true, message: "" },
    });
  }

  return {
    ok: results.every((r) => r.ok),
    users: results.length,
    results,
  };
}
