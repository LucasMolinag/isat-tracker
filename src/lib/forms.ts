/**
 * Google Forms helpers: extract per-email form URLs from message bodies,
 * optional tracking prefill, and Sheets/Forms Submitted matching.
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

const GOOGLE_FORM_HOST =
  /(?:docs\.google\.com\/forms|forms\.gle)\//i;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

/**
 * Unwrap common Google redirect wrappers:
 * https://www.google.com/url?q=<encoded formUrl>&sa=D...
 */
function unwrapGoogleRedirect(raw: string): string {
  try {
    const u = new URL(raw);
    if (
      (u.hostname === "www.google.com" || u.hostname === "google.com") &&
      u.pathname === "/url"
    ) {
      const q = u.searchParams.get("q") || u.searchParams.get("url");
      if (q && GOOGLE_FORM_HOST.test(q)) return q;
    }
  } catch {
    // ignore
  }
  return raw;
}

/**
 * Normalize a candidate form URL: decode entities, unwrap redirects,
 * collapse whitespace/newlines inside the URL, encode spaces in query.
 */
export function normalizeGoogleFormUrl(raw: string): string | null {
  let s = decodeHtmlEntities(raw.trim());
  s = unwrapGoogleRedirect(s);
  // Soft line wraps in plain-text emails: "Lucas\r\nMolina"
  s = s.replace(/[\r\n\t]+/g, "");
  // Trim trailing junk often glued in prose (not part of query)
  s = s.replace(/[),.;\]]+$/g, "");

  if (!GOOGLE_FORM_HOST.test(s)) return null;

  try {
    // Encode literal spaces in path/query so URL() accepts them.
    const encoded = s.replace(/ /g, "%20");
    const url = new URL(encoded);
    if (!GOOGLE_FORM_HOST.test(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function collectHrefCandidates(body: string): string[] {
  const out: string[] = [];
  const hrefRe = /href\s*=\s*(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(body))) {
    const href = m[2] ?? "";
    if (GOOGLE_FORM_HOST.test(href) || /google\.com\/url/i.test(href)) {
      out.push(href);
    }
  }
  return out;
}

function collectLooseCandidates(body: string): string[] {
  // Allow spaces/%20 inside query so "Lucas Molina" is not truncated.
  const re =
    /https?:\/\/(?:docs\.google\.com\/forms|forms\.gle|www\.google\.com\/url)\/[^\s"'<>\\]+(?:[ \t]*[^\s"'<>\\]+)*/gi;
  return body.match(re) ?? [];
}

/**
 * Extract the Google Forms URL from plain/HTML email body.
 * Prefers href=… candidates; when several form links exist, prefers the one
 * whose URL ends with `=3` (Jira survey “Good” / third star).
 * Always keeps the full prefilled query string.
 */
export function extractGoogleFormUrl(body: string): string | null {
  if (!body) return null;

  const decoded = decodeHtmlEntities(body);
  const rawCandidates = [
    ...collectHrefCandidates(decoded),
    ...collectHrefCandidates(body),
    ...collectLooseCandidates(decoded),
    ...collectLooseCandidates(body),
  ];

  const normalized = rawCandidates
    .map(normalizeGoogleFormUrl)
    .filter((u): u is string => Boolean(u));

  if (normalized.length === 0) return null;

  // De-dupe while preserving order
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const u of normalized) {
    if (seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
  }

  const preferDocs = unique.filter((u) => /docs\.google\.com\/forms/i.test(u));
  const pool = preferDocs.length > 0 ? preferDocs : unique;

  // Jira survey templates ship one link per star (…=1 …=5). Prefer the “Good” (=3) link.
  const endsWith3 = pool.find((u) => {
    try {
      const href = new URL(u).href.replace(/#.*$/, "");
      return href.endsWith("=3");
    } catch {
      return /[=]3$/i.test(u.trim().replace(/#.*$/, ""));
    }
  });
  if (endsWith3) return endsWith3;

  return pool[0]!;
}

/**
 * Optional tracking prefill. Never overwrites an existing query value —
 * entry.2115622678 is the QoS 1–5 rating often prefilled as `=3`; injecting
 * the tracking UUID would break the rating. Submitted detection should use
 * Sheet/Forms responses later, not open-time overwrites.
 */
export function buildTrackedFormUrl(
  formUrl: string,
  entryFieldId: string | null | undefined,
  trackingId: string,
): string {
  if (!entryFieldId || entryFieldId === "NEEDS_ENTRY_FIELD_ID") {
    return formUrl;
  }

  const field = entryFieldId.startsWith("entry.")
    ? entryFieldId
    : `entry.${entryFieldId}`;

  try {
    const url = new URL(formUrl);
    const existing = url.searchParams.get(field);
    if (existing !== null && existing !== "") {
      // Preserve email prefill (e.g. =3). Do not replace with trackingId.
      return formUrl;
    }
    url.searchParams.set(field, trackingId);
    return url.href;
  } catch {
    return formUrl;
  }
}

/** Accept spreadsheet id or full Sheets URL. */
export function extractSpreadsheetId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Forms API formId is the edit-URL id (`/forms/d/{id}`), not the public `/d/e/` id.
 */
export function extractFormsApiFormId(formUrl: string): string | null {
  const trimmed = formUrl.trim();
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
 * Submitted matching via Sheets/Forms is deferred. Soft-skip silently so Sync
 * UX stays a short Gmail summary (Open form already uses per-email formUrl).
 */
const FORMS_MATCHER_DEFERRED = true;

/**
 * Match form/sheet responses to EmailEntry.trackingId → Submitted.
 */
export async function matchFormResponsesForUser(
  userId: string,
): Promise<MatchResult> {
  if (FORMS_MATCHER_DEFERRED) {
    return {
      ok: true,
      matched: 0,
      scannedTokens: 0,
      message: "",
      stub: true,
    };
  }

  const configs = await prisma.formConfig.findMany({ where: { userId } });

  if (configs.length === 0) {
    return {
      ok: true,
      matched: 0,
      scannedTokens: 0,
      message: "",
      stub: true,
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
      // Soft-skip when Forms scope missing and we're not relying on it for Open form.
      return {
        ok: true,
        matched: 0,
        scannedTokens: 0,
        message:
          "Forms responses scope missing — Submitted matching skipped for now.",
        stub: false,
        details,
      };
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
