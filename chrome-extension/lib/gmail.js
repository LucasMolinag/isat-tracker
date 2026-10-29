import { extractGoogleFormUrl } from "./forms.js";
import { jiraBrowseUrlFromSubject, parseJiraTicketKey } from "./jira.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Jira ISAT survey mail query. */
export const SURVEY_QUERY =
  'from:jira@glia.atlassian.net (subject:"How was the collab on" OR subject:"How is the information provided on")';

/**
 * @param {string} token
 * @param {string} path
 */
async function gmailJson(token, path) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message || `Gmail API ${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function headerValue(headers, name) {
  const lower = name.toLowerCase();
  const h = (headers || []).find((x) => x.name?.toLowerCase() === lower);
  return h?.value ?? "";
}

function decodeBodyData(data) {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function collectBodyText(payload) {
  const chunks = [];
  function walk(part) {
    if (!part) return;
    const mime = (part.mimeType || "").toLowerCase();
    if (
      (mime === "text/plain" || mime === "text/html" || mime === "") &&
      part.body?.data
    ) {
      try {
        chunks.push(decodeBodyData(part.body.data));
      } catch {
        // ignore
      }
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  return chunks.join("\n");
}

/**
 * List matching survey emails with form + ticket links.
 * @param {string} accessToken
 * @param {{ maxResults?: number }} [opts]
 * @returns {Promise<Array<{ id: string, subject: string, receivedAt: string | null, formUrl: string | null, ticketKey: string | null, ticketUrl: string | null }>>}
 */
export async function fetchSurveyEmails(accessToken, opts = {}) {
  const maxResults = opts.maxResults ?? 40;
  const list = await gmailJson(
    accessToken,
    `/messages?maxResults=${maxResults}&q=${encodeURIComponent(SURVEY_QUERY)}`,
  );

  const messages = list.messages || [];
  const out = [];
  const seenSubjects = new Set();

  // Sequential to stay under Gmail quota for a popup refresh.
  for (const m of messages) {
    const msg = await gmailJson(
      accessToken,
      `/messages/${encodeURIComponent(m.id)}?format=full`,
    );
    const headers = msg.payload?.headers;
    const subject = headerValue(headers, "Subject") || "(no subject)";

    // Exact subject match → keep first occurrence only (list is newest-first).
    if (seenSubjects.has(subject)) continue;
    seenSubjects.add(subject);

    const internalMs = msg.internalDate ? Number(msg.internalDate) : NaN;
    const receivedAt = Number.isFinite(internalMs)
      ? new Date(internalMs).toISOString()
      : null;
    const body = collectBodyText(msg.payload);
    const formUrl = extractGoogleFormUrl(body);
    const ticketKey = parseJiraTicketKey(subject);
    const ticketUrl = jiraBrowseUrlFromSubject(subject);

    out.push({
      id: msg.id,
      subject,
      receivedAt,
      formUrl,
      ticketKey,
      ticketUrl,
    });
  }

  return out;
}
