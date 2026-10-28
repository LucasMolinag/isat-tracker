/**
 * Live Google Forms / Sheets response matcher.
 *
 * Prefers linked response Sheet (cell text contains trackingId).
 * Falls back to Forms API responses.list when a form id can be resolved.
 * Matches → transitionEntryStatus(..., "Submitted") — never downgrades.
 */

import type { FormConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transitionEntryStatus } from "@/lib/status";
import {
  GoogleAuthError,
  getGoogleAccessToken,
  googleJson,
  hasScope,
} from "@/lib/google-auth";

const SHEETS_READONLY =
  "https://www.googleapis.com/auth/spreadsheets.readonly";
const FORMS_RESPONSES_READONLY =
  "https://www.googleapis.com/auth/forms.responses.readonly";

export type MatchResult = {
  ok: boolean;
  matched: number;
  scannedTokens: number;
  message: string;
  stub: boolean;
  details?: string[];
};

/**
 * Build a Google Form prefill URL with the tracking token in entry.<fieldId>.
 */
export function buildTrackedFormUrl(
  formUrl: string,
  entryFieldId: string,
  trackingId: string,
): string {
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

/** Accept spreadsheet id or full Sheets URL. */
export function extractSpreadsheetId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
  );
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Forms API formId is the edit-URL id (`/forms/d/{id}`), not the public `/d/e/` id.
 */
export function extractFormsApiFormId(formUrl: string): string | null {
  const trimmed = formUrl.trim();
  // Prefer non-/e/ edit id
  const edit = trimmed.match(/\/forms\/d\/([a-zA-Z0-9-_]+)/);
  if (edit?.[1] && edit[1] !== "e") return edit[1];
  return null;
}

function collectCellStrings(values: string[][] | undefined): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const row of values) {
    for (const cell of row) {
      if (typeof cell === "string" && cell.trim()) {
        out.push(cell.trim());
      }
    }
  }
  return out;
}

async function fetchSheetTokens(
  userId: string,
  spreadsheetId: string,
): Promise<string[]> {
  // Prefer the default Forms-linked tab, then a wide first-sheet read.
  const ranges = ["'Form Responses 1'", "Sheet1", "A:ZZ"];
  const tokens: string[] = [];
  let lastError: unknown;

  for (const range of ranges) {
    try {
      const encoded = encodeURIComponent(range);
      const data = await googleJson<{ values?: string[][] }>(
        userId,
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encoded}`,
      );
      tokens.push(...collectCellStrings(data.values));
      if (tokens.length > 0) return tokens;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError && tokens.length === 0) throw lastError;
  return tokens;
}

type FormsResponses = {
  responses?: Array<{
    responseId?: string;
    answers?: Record<
      string,
      {
        textAnswers?: { answers?: Array<{ value?: string }> };
      }
    >;
  }>;
  nextPageToken?: string;
};

async function fetchFormsResponseTokens(
  userId: string,
  formId: string,
): Promise<string[]> {
  const tokens: string[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await googleJson<FormsResponses>(
      userId,
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses?${params}`,
    );

    for (const response of data.responses ?? []) {
      for (const answer of Object.values(response.answers ?? {})) {
        for (const a of answer.textAnswers?.answers ?? []) {
          if (a.value?.trim()) tokens.push(a.value.trim());
        }
      }
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return tokens;
}

async function matchTokensToEntries(
  userId: string,
  foundValues: string[],
  note: string,
): Promise<number> {
  const openEntries = await prisma.emailEntry.findMany({
    where: {
      userId,
      status: { in: ["Unread", "Read"] },
    },
    select: { id: true, trackingId: true },
  });

  if (openEntries.length === 0) return 0;

  const byToken = new Map(
    openEntries.map((e) => [e.trackingId.toLowerCase(), e]),
  );

  // Exact cell/answer match, or cell containing the UUID.
  const matchedIds = new Set<string>();
  for (const raw of foundValues) {
    const value = raw.trim();
    const lower = value.toLowerCase();
    const exact = byToken.get(lower);
    if (exact) {
      matchedIds.add(exact.id);
      continue;
    }
    for (const [token, entry] of byToken) {
      if (lower.includes(token)) matchedIds.add(entry.id);
    }
  }

  let matched = 0;
  for (const entryId of matchedIds) {
    const result = await transitionEntryStatus(entryId, "Submitted", note);
    if (result.changed) matched += 1;
  }
  return matched;
}

async function matchOneConfig(
  userId: string,
  config: FormConfig,
  details: string[],
): Promise<{ matched: number; scanned: number }> {
  let tokens: string[] = [];
  let source = "";

  if (config.responseSheetId) {
    const sheetId = extractSpreadsheetId(config.responseSheetId);
    if (!sheetId) {
      details.push(
        `FormConfig ${config.id}: invalid responseSheetId (need spreadsheet id or URL)`,
      );
      return { matched: 0, scanned: 0 };
    }
    tokens = await fetchSheetTokens(userId, sheetId);
    source = `sheet:${sheetId}`;
  } else {
    const formId = extractFormsApiFormId(config.formUrl);
    if (!formId) {
      details.push(
        `FormConfig ${config.id}: set responseSheetId, or use a Forms edit URL (/forms/d/{id}/edit) — public /d/e/ ids are not Forms API formIds`,
      );
      return { matched: 0, scanned: 0 };
    }
    tokens = await fetchFormsResponseTokens(userId, formId);
    source = `forms:${formId}`;
  }

  const matched = await matchTokensToEntries(
    userId,
    tokens,
    `forms matcher (${source})`,
  );
  details.push(
    `${source}: scanned ${tokens.length} value(s), newly Submitted=${matched}`,
  );
  return { matched, scanned: tokens.length };
}

/**
 * Match form/sheet responses to EmailEntry.trackingId → Submitted.
 */
export async function matchFormResponsesForUser(
  userId: string,
): Promise<MatchResult> {
  const configs = await prisma.formConfig.findMany({ where: { userId } });

  if (configs.length === 0) {
    return {
      ok: false,
      matched: 0,
      scannedTokens: 0,
      message: "No form configs — add form URL + entry field id in Settings.",
      stub: false,
    };
  }

  const details: string[] = [];

  try {
    const access = await getGoogleAccessToken(userId);
    const needsSheet = configs.some((c) => Boolean(c.responseSheetId));
    const needsForms = configs.some((c) => !c.responseSheetId);

    if (needsSheet && !hasScope(access.scope, SHEETS_READONLY)) {
      throw new GoogleAuthError(
        `Missing Sheets scope ${SHEETS_READONLY}. Reconnect Google.`,
        "missing_tokens",
      );
    }
    if (needsForms && !hasScope(access.scope, FORMS_RESPONSES_READONLY)) {
      throw new GoogleAuthError(
        `Missing Forms responses scope ${FORMS_RESPONSES_READONLY}. Reconnect Google, or set responseSheetId to use Sheets instead.`,
        "missing_tokens",
      );
    }

    let matched = 0;
    let scannedTokens = 0;

    for (const config of configs) {
      const result = await matchOneConfig(userId, config, details);
      matched += result.matched;
      scannedTokens += result.scanned;
    }

    return {
      ok: true,
      matched,
      scannedTokens,
      message: `Forms/Sheets matcher OK. newly Submitted=${matched}. ${details.join(" · ")}`,
      stub: false,
      details,
    };
  } catch (e) {
    const message =
      e instanceof GoogleAuthError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Forms/Sheets matcher failed";

    return {
      ok: false,
      matched: 0,
      scannedTokens: 0,
      message,
      stub: false,
      details,
    };
  }
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
