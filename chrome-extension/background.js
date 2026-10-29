/**
 * Service worker: Google auth via chrome.identity + message hub for the popup.
 */

import { fetchSurveyEmails } from "./lib/gmail.js";

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (!token) {
        reject(new Error("No auth token returned"));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function getTokenWithRetry() {
  try {
    return await getAuthToken(true);
  } catch (e) {
    // Clear bad cache and retry once interactively.
    try {
      const stale = await getAuthToken(false);
      await removeCachedToken(stale);
    } catch {
      // ignore
    }
    return getAuthToken(true);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "CONNECT") {
    (async () => {
      const token = await getTokenWithRetry();
      await chrome.storage.session.set({ connected: true });
      sendResponse({ ok: true, connected: Boolean(token) });
    })().catch((e) => {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    });
    return true;
  }

  if (message.type === "DISCONNECT") {
    (async () => {
      try {
        const token = await getAuthToken(false);
        await removeCachedToken(token);
      } catch {
        // ignore
      }
      await chrome.storage.session.set({ connected: false, cache: null });
      sendResponse({ ok: true });
    })().catch((e) => {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    });
    return true;
  }

  if (message.type === "FETCH_SURVEYS") {
    (async () => {
      let token = await getTokenWithRetry();
      try {
        const emails = await fetchSurveyEmails(token, { maxResults: 40 });
        await chrome.storage.session.set({
          connected: true,
          cache: { at: Date.now(), emails },
        });
        sendResponse({ ok: true, emails });
      } catch (e) {
        if (e?.status === 401) {
          await removeCachedToken(token);
          token = await getTokenWithRetry();
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

  return false;
});
