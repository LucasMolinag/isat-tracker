/**
 * Service worker: Google auth + Gmail fetch + TEST autosubmit orchestration.
 *
 * TEST ONLY variant — Open Form opens the prefilled URL, content script clicks
 * Submit, then this worker marks the entry Done/Submitted locally.
 */

import { fetchSurveyEmails } from "./lib/gmail.js";
import {
  acquireAccessToken,
  clearAuth,
  removeCachedToken,
} from "./lib/auth.js";
import { markFormOpened, setDone } from "./lib/status.js";

const PENDING_KEY = "pendingAutosubmitByTab";

async function readPendingMap() {
  const data = await chrome.storage.session.get(PENDING_KEY);
  return data[PENDING_KEY] && typeof data[PENDING_KEY] === "object"
    ? data[PENDING_KEY]
    : {};
}

async function writePendingMap(map) {
  await chrome.storage.session.set({ [PENDING_KEY]: map });
}

/**
 * @param {number} tabId
 * @param {string} messageId
 */
async function setPending(tabId, messageId) {
  const map = await readPendingMap();
  map[String(tabId)] = {
    messageId,
    at: Date.now(),
  };
  await writePendingMap(map);
}

/** @param {number} tabId */
async function takePending(tabId) {
  const map = await readPendingMap();
  const key = String(tabId);
  const entry = map[key] || null;
  if (entry) {
    delete map[key];
    await writePendingMap(map);
  }
  return entry;
}

/** @param {number} tabId */
async function peekPending(tabId) {
  const map = await readPendingMap();
  return map[String(tabId)] || null;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  takePending(tabId).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "CONNECT") {
    (async () => {
      const token = await acquireAccessToken(true);
      await chrome.storage.session.set({ connected: true });
      sendResponse({ ok: true, connected: Boolean(token) });
    })().catch((e) => {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
    return true;
  }

  if (message.type === "DISCONNECT") {
    (async () => {
      await clearAuth();
      sendResponse({ ok: true });
    })().catch((e) => {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
    return true;
  }

  if (message.type === "FETCH_SURVEYS") {
    (async () => {
      let token = await acquireAccessToken(true);
      try {
        const emails = await fetchSurveyEmails(token, { maxResults: 40 });
        await chrome.storage.session.set({
          connected: true,
          cache: { at: Date.now(), emails },
        });
        sendResponse({ ok: true, emails });
      } catch (e) {
        if (e?.status === 401) {
          try {
            await removeCachedToken(token);
          } catch {
            // ignore
          }
          await chrome.storage.session.set({
            accessToken: null,
            accessTokenExpiresAt: null,
          });
          token = await acquireAccessToken(true);
          const emails = await fetchSurveyEmails(token, { maxResults: 40 });
          await chrome.storage.session.set({
            connected: true,
            cache: { at: Date.now(), emails },
          });
          sendResponse({ ok: true, emails });
          return;
        }
        throw e;
      }
    })().catch((e) => {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
    return true;
  }

  if (message.type === "OPEN_FORM_AUTOSUBMIT") {
    (async () => {
      const messageId = message.messageId;
      const formUrl = message.formUrl;
      if (!messageId || !formUrl) {
        sendResponse({ ok: false, error: "messageId and formUrl required" });
        return;
      }

      await markFormOpened(messageId);

      // about:blank first so pending is registered before the Forms content
      // script runs (avoids race with tabs.create(formUrl)).
      const tab = await chrome.tabs.create({ url: "about:blank", active: true });
      if (!tab?.id) {
        sendResponse({ ok: false, error: "Could not open form tab" });
        return;
      }

      await setPending(tab.id, messageId);
      await chrome.tabs.update(tab.id, { url: formUrl });
      sendResponse({ ok: true, tabId: tab.id });
    })().catch((e) => {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
    return true;
  }

  if (message.type === "AUTOSUBMIT_SHOULD_RUN") {
    (async () => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ shouldRun: false });
        return;
      }
      const pending = await peekPending(tabId);
      sendResponse({
        shouldRun: Boolean(pending?.messageId),
        messageId: pending?.messageId || null,
      });
    })().catch(() => {
      sendResponse({ shouldRun: false });
    });
    return true;
  }

  if (message.type === "AUTOSUBMIT_DONE") {
    (async () => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "No tab" });
        return;
      }
      const pending = await takePending(tabId);
      if (!pending?.messageId) {
        sendResponse({ ok: false, error: "No pending autosubmit" });
        return;
      }

      if (message.ok) {
        await setDone(pending.messageId, true);
        sendResponse({ ok: true, messageId: pending.messageId, done: true });
        return;
      }

      sendResponse({
        ok: false,
        messageId: pending.messageId,
        error: message.error || "Autosubmit failed",
        done: false,
      });
    })().catch((e) => {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
    return true;
  }

  return false;
});
