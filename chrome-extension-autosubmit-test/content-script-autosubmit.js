/**
 * TEST ONLY — auto-click Google Form Submit when this extension opened the tab.
 * Does nothing unless the service worker has a pending autosubmit for this tab.
 */

(function () {
  // Top frame only — avoid iframe double-submit and forms.gle redirect races
  // (short links redirect here; do not register a content script on forms.gle).
  if (window !== window.top) return;
  if (window.__isatAutosubmitBooted) return;
  window.__isatAutosubmitBooted = true;

  const MAX_WAIT_MS = 20_000;
  const POLL_MS = 400;

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message });
            return;
          }
          resolve(response || { ok: false, error: "No response" });
        });
      } catch (e) {
        resolve({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  function isConfirmationPage() {
    const text = document.body?.innerText || "";
    return (
      /your response has been recorded/i.test(text) ||
      /response has been recorded/i.test(text) ||
      /thanks for (your )?responding/i.test(text)
    );
  }

  function findSubmitButton() {
    const nodes = [
      ...document.querySelectorAll('[role="button"]'),
      ...document.querySelectorAll("button"),
      ...document.querySelectorAll('div[jsname="M2UYVd"]'),
      ...document.querySelectorAll('input[type="submit"]'),
    ];

    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.getAttribute("aria-disabled") === "true") continue;
      if (el.hasAttribute("disabled")) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("data-tooltip") ||
        ""
      ).trim();
      const text = (el.innerText || el.textContent || "").trim();
      if (/^submit$/i.test(label) || /^submit$/i.test(text)) {
        return el;
      }
    }
    return null;
  }

  function clickSubmit(el) {
    el.focus?.();
    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    if (typeof el.click === "function") el.click();
  }

  async function waitForSubmitAndClick() {
    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS) {
      if (isConfirmationPage()) {
        return { ok: true, alreadyConfirmed: true };
      }
      const btn = findSubmitButton();
      if (btn) {
        clickSubmit(btn);
        const confirmStarted = Date.now();
        while (Date.now() - confirmStarted < 12_000) {
          if (isConfirmationPage()) {
            return { ok: true, clicked: true };
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        // Clicked but no confirmation text — still report soft success
        // (some forms redirect / change DOM without that string).
        return {
          ok: true,
          clicked: true,
          confirmed: false,
          note: "Submit clicked; confirmation text not seen",
        };
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return {
      ok: false,
      error: "Timed out waiting for Google Form Submit button",
    };
  }

  async function run() {
    const gate = await send("AUTOSUBMIT_SHOULD_RUN");
    if (!gate?.shouldRun) return;

    const result = await waitForSubmitAndClick();
    await send("AUTOSUBMIT_DONE", {
      ok: Boolean(result.ok),
      error: result.error || null,
      detail: result,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      run().catch(() => {});
    });
  } else {
    run().catch(() => {});
  }
})();
