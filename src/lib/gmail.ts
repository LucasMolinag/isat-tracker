/**
 * Live Gmail subject-rule sync.
 *
 * 1. Load enabled SubjectRule rows → Gmail `q`
 * 2. List + get messages via Gmail API (readonly)
 * 3. Upsert EmailEntry by gmailMessageId; new rows start Unread
 * 4. Update User.lastSyncAt / lastSyncError
 */

import type { EntryStatus, SubjectRule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GoogleAuthError, googleJson, hasScope } from "@/lib/google-auth";

const GMAIL_READONLY =
  "https://www.googleapis.com/auth/gmail.readonly";

export type SyncResult = {
  ok: boolean;
  upserted: number;
  created: number;
  scanned: number;
  message: string;
  stub: boolean;
  query?: string;
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

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailMessage = {
  id: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

function headerValue(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string {
  const hit = headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return hit?.value?.trim() ?? "";
}

function parseFromAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match?.[1] ?? from).trim() || "unknown";
}

async function listAllMessageIds(
  userId: string,
  query: string,
  maxPages = 10,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      q: query,
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await googleJson<GmailListResponse>(
      userId,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    );

    for (const m of data.messages ?? []) {
      ids.push(m.id);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return ids;
}

async function getMessageMeta(
  userId: string,
  messageId: string,
): Promise<{
  subject: string;
  fromAddress: string;
  receivedAt: Date;
}> {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}` +
    `?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;

  const msg = await googleJson<GmailMessage>(userId, url);

  const headers = msg.payload?.headers;
  const subject = headerValue(headers, "Subject") || "(no subject)";
  const fromAddress = parseFromAddress(headerValue(headers, "From"));
  const internalMs = msg.internalDate ? Number(msg.internalDate) : NaN;
  const receivedAt = Number.isFinite(internalMs)
    ? new Date(internalMs)
    : new Date(headerValue(headers, "Date") || Date.now());

  return { subject, fromAddress, receivedAt };
}

/**
 * Sync matching Gmail messages into EmailEntry for a user.
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
      created: 0,
      scanned: 0,
      message: "Add at least one enabled subject rule in Settings.",
      stub: false,
    };
  }

  try {
    // Warm / validate tokens + optional scope hint
    const { getGoogleAccessToken } = await import("@/lib/google-auth");
    const access = await getGoogleAccessToken(userId);
    if (!hasScope(access.scope, GMAIL_READONLY)) {
      throw new GoogleAuthError(
        `Missing Gmail scope ${GMAIL_READONLY}. Reconnect Google and grant Gmail readonly.`,
        "missing_tokens",
      );
    }

    const formConfig = await prisma.formConfig.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    const messageIds = await listAllMessageIds(userId, query);
    let created = 0;
    let upserted = 0;

    for (const gmailMessageId of messageIds) {
      const existing = await prisma.emailEntry.findUnique({
        where: {
          userId_gmailMessageId: { userId, gmailMessageId },
        },
      });

      if (existing) {
        // Keep status; optionally attach default form config if missing.
        if (formConfig && !existing.formConfigId) {
          await prisma.emailEntry.update({
            where: { id: existing.id },
            data: { formConfigId: formConfig.id },
          });
        }
        upserted += 1;
        continue;
      }

      const meta = await getMessageMeta(userId, gmailMessageId);
      await prisma.emailEntry.create({
        data: {
          userId,
          gmailMessageId,
          subject: meta.subject,
          fromAddress: meta.fromAddress,
          receivedAt: meta.receivedAt,
          status: "Unread",
          formConfigId: formConfig?.id,
        },
      });
      created += 1;
      upserted += 1;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: null,
      },
    });

    return {
      ok: true,
      upserted,
      created,
      scanned: messageIds.length,
      message: `Gmail sync OK. query=${query}; scanned=${messageIds.length}; created=${created}; updated=${upserted - created}`,
      stub: false,
      query,
    };
  } catch (e) {
    const message =
      e instanceof GoogleAuthError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Gmail sync failed";

    await prisma.user.update({
      where: { id: userId },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: message,
      },
    });

    return {
      ok: false,
      upserted: 0,
      created: 0,
      scanned: 0,
      message,
      stub: false,
      query,
    };
  }
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
