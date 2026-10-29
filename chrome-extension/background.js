/**
 * Service worker: Google auth + Gmail fetch for the popup.
 */

import { fetchSurveyEmails } from "./lib/gmail.js";
import {
  acquireAccessToken,
  clearAuth,
  removeCachedToken,
} from "./lib/auth.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  return false;
});
