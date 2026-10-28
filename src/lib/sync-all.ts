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
 * Run Gmail + Forms/Sheets sync for every user with a linked Google account.
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

  // Dedupe by userId
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
      ok: gmail.ok && forms.ok,
      gmail,
      forms,
    });
  }

  return {
    ok: results.every((r) => r.ok),
    users: results.length,
    results,
  };
}
