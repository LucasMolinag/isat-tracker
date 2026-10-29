const JIRA_BROWSE_BASE = "https://glia.atlassian.net/browse";
const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** @param {string} subject */
export function parseJiraTicketKey(subject) {
  const match = subject.match(TICKET_KEY_RE);
  return match?.[1] ?? null;
}

/** @param {string} subject */
export function jiraBrowseUrlFromSubject(subject) {
  const key = parseJiraTicketKey(subject);
  if (!key) return null;
  return `${JIRA_BROWSE_BASE}/${key}`;
}
