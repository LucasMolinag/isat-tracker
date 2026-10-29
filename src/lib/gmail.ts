/**
 * Live Gmail subject-rule sync.
 *
 * 1. Load enabled SubjectRule rows → Gmail `q` (optional from: + subject OR)
 * 2. List + get messages via Gmail API (readonly)
 * 3. Upsert EmailEntry by gmailMessageId; new rows start Unread
 * 4. Update User.lastSyncAt / lastSyncError
 */

import type { EntryStatus, SubjectRule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GoogleAuthError, googleJson, hasScope } from "@/lib/google-auth";
import { extractGoogleFormUrl } from "@/lib/forms";

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

function subjectClause(
  pattern: string,
  matchMode: SubjectRule["matchMode"],
): string {
  const p = pattern.replace(/"/g, "").trim();
  // Quote phrases so multi-word "contains" stays a subject phrase match.
  if (matchMode === "Exact" || /\s/.test(p)) {
    return `subject:"${p}"`;
  }
  return `subject:${p}`;
}

/**
 * Build a Gmail `q` string from subject rules.
 *
 * Examples:
 * - from + two subjects →
 *   `from:jira@glia.atlassian.net (subject:"How was the collab on" OR subject:"How is the information provided on")`
 * - Mixed from addresses → OR of `(from:… subject:…)` groups
 */
export function buildSubjectQuery(rules: SubjectRule[]): string {
  const enabled = rules.filter((r) => r.enabled && r.pattern.trim());
  if (enabled.length === 0) return "";

  const byFrom = new Map<string, SubjectRule[]>();
  for (const rule of enabled) {
    const key = (rule.fromAddress ?? "").trim().toLowerCase();
    const list = byFrom.get(key) ?? [];
    list.push(rule);
    byFrom.set(key, list);
  }

  const groups: string[] = [];
  for (const [fromKey, groupRules] of byFrom) {
    const subjects = groupRules.map((r) =>
      subjectClause(r.pattern, r.matchMode),
    );
    const subjectPart =
      subjects.length === 1 ? subjects[0]! : `(${subjects.join(" OR ")})`;
    if (fromKey) {
      groups.push(`from:${fromKey} ${subjectPart}`);
    } else {
      groups.push(subjectPart);
    }
  }

  return groups.length === 1 ? groups[0]! : `(${groups.join(" OR ")})`;
}

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailPayloadPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
  headers?: Array<{ name: string; value: string }>;
};

type GmailMessage = {
  id: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
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

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

/** Collect text/plain + text/html bodies from a Gmail message payload tree. */
function collectBodyText(payload: GmailPayloadPart | undefined): string {
  if (!payload) return "";
  const chunks: string[] = [];

  function walk(part: GmailPayloadPart) {
    const mime = (part.mimeType || "").toLowerCase();
    if (
      (mime === "text/plain" || mime === "text/html" || mime === "") &&
      part.body?.data
    ) {
      try {
        chunks.push(decodeBase64Url(part.body.data));
      } catch {
        // ignore decode errors
      }
    }
    for (const child of part.parts ?? []) walk(child);
  }

  walk(payload);
  return chunks.join("\n");
}

async function getMessageDetails(
  userId: string,
  messageId: string,
): Promise<{
  subject: string;
  fromAddress: string;
  receivedAt: Date;
  formUrl: string | null;
}> {
  // Full payload so we can parse the body for a per-email Google Form link.
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;

  const msg = await googleJson<GmailMessage>(userId, url);

  const headers = msg.payload?.headers;
  const subject = headerValue(headers, "Subject") || "(no subject)";
  const fromAddress = parseFromAddress(headerValue(headers, "From"));
  const internalMs = msg.internalDate ? Number(msg.internalDate) : NaN;
  const receivedAt = Number.isFinite(internalMs)
    ? new Date(internalMs)
    : new Date(headerValue(headers, "Date") || Date.now());
  const body = collectBodyText(msg.payload);
  const formUrl = extractGoogleFormUrl(body);

  return { subject, fromAddress, receivedAt, formUrl };
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
        // Always refresh formUrl so extract fixes (full prefill, prefer =3) apply.
        const details = await getMessageDetails(userId, gmailMessageId);
        await prisma.emailEntry.update({
          where: { id: existing.id },
          data: {
            ...(details.formUrl ? { formUrl: details.formUrl } : {}),
            ...(formConfig && !existing.formConfigId
              ? { formConfigId: formConfig.id }
              : {}),
          },
        });
        upserted += 1;
        continue;
      }

      const meta = await getMessageDetails(userId, gmailMessageId);
      await prisma.emailEntry.create({
        data: {
          userId,
          gmailMessageId,
          subject: meta.subject,
          fromAddress: meta.fromAddress,
          receivedAt: meta.receivedAt,
          formUrl: meta.formUrl,
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
      message: `Synced ${messageIds.length} emails · ${created} new`,
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
