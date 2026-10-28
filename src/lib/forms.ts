/**
 * Google Forms / Sheets response matcher stub.
 *
 * Live path (TODO with Sheets API credentials):
 * 1. For each FormConfig with responseSheetId (or Forms responses endpoint),
 *    pull recent rows.
 * 2. Find cells matching EmailEntry.trackingId in the configured column /
 *    entry field.
 * 3. transitionEntryStatus(entryId, "Submitted") — never downgrade.
 */

import { prisma } from "@/lib/prisma";
import { decryptAccountTokens } from "@/lib/crypto";
import { transitionEntryStatus } from "@/lib/status";

export type MatchResult = {
  ok: boolean;
  matched: number;
  message: string;
  stub: boolean;
};

/**
 * Build a Google Form prefill URL with the tracking token in entry.<fieldId>.
 */
export function buildTrackedFormUrl(
  formUrl: string,
  entryFieldId: string,
  trackingId: string,
): string {
  // Normalize viewform URLs; strip existing query for a clean prefill.
  const base = formUrl.split("?")[0] ?? formUrl;
  const viewUrl = base.includes("/viewform")
    ? base
    : base.replace(/\/edit$/, "/viewform");

  const field = entryFieldId.startsWith("entry.")
    ? entryFieldId
    : `entry.${entryFieldId}`;

  const url = new URL(viewUrl);
  url.searchParams.set(field, trackingId);
  return url.toString();
}

/**
 * Match form/sheet responses to EmailEntry.trackingId → Submitted.
 * Stub: scans nothing remotely; returns guidance only.
 */
export async function matchFormResponsesForUser(
  userId: string,
): Promise<MatchResult> {
  const configs = await prisma.formConfig.findMany({ where: { userId } });

  if (configs.length === 0) {
    return {
      ok: false,
      matched: 0,
      message: "No form configs — add form URL + entry field id in Settings.",
      stub: true,
    };
  }

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (account) {
    const _tokens = decryptAccountTokens({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
    });
    void _tokens;
  }

  // TODO: Sheets API values.get on responseSheetId, or Forms responses.list.
  // For each trackingId found, locate EmailEntry (scoped by userId) and:
  //   await transitionEntryStatus(entry.id, "Submitted", "forms matcher");

  const pending = await prisma.emailEntry.count({
    where: {
      userId,
      status: { in: ["Unread", "Read"] },
    },
  });

  return {
    ok: true,
    matched: 0,
    message: `Forms/Sheets matcher stub OK. ${configs.length} form config(s), ${pending} open entr(y/ies). No remote API call yet.`,
    stub: true,
  };
}

/**
 * Apply a matched trackingId → Submitted (for tests / future webhook).
 */
export async function markSubmittedByTrackingId(
  userId: string,
  trackingId: string,
) {
  const entry = await prisma.emailEntry.findFirst({
    where: { userId, trackingId },
  });
  if (!entry) return { found: false as const, changed: false };

  const result = await transitionEntryStatus(
    entry.id,
    "Submitted",
    "forms matcher",
  );
  return { found: true as const, ...result };
}
