const JIRA_BROWSE_BASE = "https://glia.atlassian.net/browse";

/** Jira issue keys like CE-15626, PROJ-1 (project key + number). */
const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/**
 * Parse a Jira ticket key from an email subject
 * (e.g. "How was the collab on CE-15626?" → "CE-15626").
 */
export function parseJiraTicketKey(subject: string): string | null {
  const match = subject.match(TICKET_KEY_RE);
  return match?.[1] ?? null;
}

/** Browse URL for a ticket key, or null if the subject has no key. */
export function jiraBrowseUrlFromSubject(subject: string): string | null {
  const key = parseJiraTicketKey(subject);
  if (!key) return null;
  return `${JIRA_BROWSE_BASE}/${key}`;
}
