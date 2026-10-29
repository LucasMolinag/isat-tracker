/**
 * Local per-message status (chrome.storage.local).
 * - Unread → Read when Open Form is clicked (also flags "opened")
 * - Done checkbox → Submitted; uncheck → Read if opened else Unread
 */

export const STATUS = {
  Unread: "Unread",
  Read: "Read",
  Submitted: "Submitted",
};

const STATUS_KEY = "messageStatus";
const OPENED_KEY = "messageOpened";

function normalizeStatus(value) {
  if (value === STATUS.Read || value === STATUS.Submitted) return value;
  return STATUS.Unread;
}

async function readStatusMap() {
  const data = await chrome.storage.local.get(STATUS_KEY);
  return data[STATUS_KEY] && typeof data[STATUS_KEY] === "object"
    ? data[STATUS_KEY]
    : {};
}

async function readOpenedMap() {
  const data = await chrome.storage.local.get(OPENED_KEY);
  return data[OPENED_KEY] && typeof data[OPENED_KEY] === "object"
    ? data[OPENED_KEY]
    : {};
}

/** @param {string} messageId */
export async function getStatus(messageId) {
  const map = await readStatusMap();
  return normalizeStatus(map[messageId]);
}

/** @param {string} messageId */
export async function wasOpened(messageId) {
  const opened = await readOpenedMap();
  if (opened[messageId]) return true;
  // Legacy: Read/Submitted without opened flag ⇒ treat as opened.
  const status = await getStatus(messageId);
  return status === STATUS.Read || status === STATUS.Submitted;
}

/**
 * Open Form: mark opened + Read (does not clear Submitted).
 * @param {string} messageId
 */
export async function markFormOpened(messageId) {
  if (!messageId) return STATUS.Unread;
  const statusMap = await readStatusMap();
  const openedMap = await readOpenedMap();
  openedMap[messageId] = true;
  const current = normalizeStatus(statusMap[messageId]);
  if (current !== STATUS.Submitted) {
    statusMap[messageId] = STATUS.Read;
  }
  await chrome.storage.local.set({
    [STATUS_KEY]: statusMap,
    [OPENED_KEY]: openedMap,
  });
  return normalizeStatus(statusMap[messageId]);
}

/**
 * Manual Done checkbox.
 * checked → Submitted; unchecked → Read if opened else Unread.
 * @param {string} messageId
 * @param {boolean} done
 */
export async function setDone(messageId, done) {
  if (!messageId) return STATUS.Unread;
  const statusMap = await readStatusMap();
  const openedMap = await readOpenedMap();
  const opened =
    Boolean(openedMap[messageId]) ||
    normalizeStatus(statusMap[messageId]) === STATUS.Read ||
    normalizeStatus(statusMap[messageId]) === STATUS.Submitted;

  if (done) {
    statusMap[messageId] = STATUS.Submitted;
  } else {
    statusMap[messageId] = opened ? STATUS.Read : STATUS.Unread;
  }

  await chrome.storage.local.set({
    [STATUS_KEY]: statusMap,
    [OPENED_KEY]: openedMap,
  });
  return normalizeStatus(statusMap[messageId]);
}

/** @deprecated use markFormOpened — kept for call sites expecting setStatus(Read) */
export async function setStatus(messageId, toStatus) {
  if (toStatus === STATUS.Read) return markFormOpened(messageId);
  if (toStatus === STATUS.Submitted) return setDone(messageId, true);
  if (toStatus === STATUS.Unread) return setDone(messageId, false);
  return getStatus(messageId);
}

/** @param {string[]} messageIds */
export async function getStatuses(messageIds) {
  const map = await readStatusMap();
  const out = {};
  for (const id of messageIds) {
    out[id] = normalizeStatus(map[id]);
  }
  return out;
}
