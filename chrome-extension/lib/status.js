/**
 * Local per-message status (chrome.storage.local).
 * Unread → Read when Open Form is clicked.
 * Submitted reserved for a future Sheet matcher (not set in MVP).
 */

export const STATUS = {
  Unread: "Unread",
  Read: "Read",
  Submitted: "Submitted",
};

const STORAGE_KEY = "messageStatus";

const RANK = {
  Unread: 0,
  Read: 1,
  Submitted: 2,
};

async function readMap() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object"
    ? data[STORAGE_KEY]
    : {};
}

async function writeMap(map) {
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

/** @param {string} messageId */
export async function getStatus(messageId) {
  const map = await readMap();
  const value = map[messageId];
  if (value === STATUS.Read || value === STATUS.Submitted) return value;
  return STATUS.Unread;
}

/**
 * Never downgrade (Unread < Read < Submitted).
 * @param {string} messageId
 * @param {"Unread"|"Read"|"Submitted"} toStatus
 */
export async function setStatus(messageId, toStatus) {
  if (!messageId || !(toStatus in RANK)) return STATUS.Unread;
  const map = await readMap();
  const current = map[messageId] || STATUS.Unread;
  if (RANK[toStatus] <= RANK[current]) return current;
  map[messageId] = toStatus;
  // Await the write so callers can finish before the popup unloads.
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
  return toStatus;
}

/** @param {string[]} messageIds */
export async function getStatuses(messageIds) {
  const map = await readMap();
  const out = {};
  for (const id of messageIds) {
    const value = map[id];
    out[id] =
      value === STATUS.Read || value === STATUS.Submitted
        ? value
        : STATUS.Unread;
  }
  return out;
}
