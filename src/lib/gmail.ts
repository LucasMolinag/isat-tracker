/**
 * Gmail subject-rule sync stub.
 *
 * Live path (TODO once Google OAuth + Gmail API credentials are wired):
 * 1. Load user's SubjectRule rows (enabled).
 * 2. Decrypt Account tokens via decryptAccountTokens.
 * 3. List messages with Gmail query: subject:(…) OR from rules.
 * 4. Upsert EmailEntry by gmailMessageId; new rows start Unread.
 * 5. Update User.lastSyncAt / lastSyncError.
 */

import type { EntryStatus, SubjectRule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptAccountTokens } from "@/lib/crypto";

export type SyncResult = {
  ok: boolean;
  upserted: number;
  message: string;
  stub: boolean;
};

/** Build a Gmail `q` string from subject rules. */
export function buildSubjectQuery(rules: SubjectRule[]): string {
  const enabled = rules.filter((r) => r.enabled && r.pattern.trim());
  if (enabled.length === 0) return "";

  const parts = enabled.map((r) => {
    const p = r.pattern.replace(/"/g, "");
    if (r.matchMode === "Exact") {
      return `subject:"${p}"`;
    }
    return `subject:${p}`;
  });

  return parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`;
}

/**
 * Sync matching Gmail messages into EmailEntry for a user.
 * Currently a working stub: records sync attempt metadata without calling Gmail.
 */
export async function syncGmailForUser(userId: string): Promise<SyncResult> {
  const rules = await prisma.subjectRule.findMany({ where: { userId } });
  const query = buildSubjectQuery(rules);

  if (!query) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: "No enabled subject rules configured",
      },
    });
    return {
      ok: false,
      upserted: 0,
      message: "Add at least one enabled subject rule in Settings.",
      stub: true,
    };
  }

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.refresh_token && !account?.access_token) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: "Google account tokens missing — reconnect Google",
      },
    });
    return {
      ok: false,
      upserted: 0,
      message: "Sign in with Google and grant Gmail readonly access.",
      stub: true,
    };
  }

  // Prepare decrypted tokens for the future live client (do not log).
  const _tokens = decryptAccountTokens({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  });
  void _tokens;

  // TODO: call Gmail API users.messages.list with `q: query`, then messages.get,
  // upsert EmailEntry { gmailMessageId, subject, fromAddress, receivedAt, status: Unread }.
  // Prefer linking formConfigId from the user's default FormConfig when present.

  await prisma.user.update({
    where: { id: userId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError:
        "STUB: Gmail API not called yet. Query would be: " + query,
    },
  });

  return {
    ok: true,
    upserted: 0,
    message: `Gmail sync stub OK. Planned query: ${query}`,
    stub: true,
  };
}

/** Helper for tests / UI: create a demo entry without Gmail (dev only). */
export async function createDemoEntry(params: {
  userId: string;
  subject: string;
  fromAddress: string;
  formConfigId?: string;
  status?: EntryStatus;
}) {
  return prisma.emailEntry.create({
    data: {
      userId: params.userId,
      gmailMessageId: `demo-${crypto.randomUUID()}`,
      subject: params.subject,
      fromAddress: params.fromAddress,
      receivedAt: new Date(),
      formConfigId: params.formConfigId,
      status: params.status ?? "Unread",
    },
  });
}
