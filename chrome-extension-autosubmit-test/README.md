# ISAT Tracker (AUTO-SUBMIT TEST) — testing only

**Do not use this as the main ISAT Tracker.**

This folder is a **separate** Chrome MV3 build for automated form-submit testing. The production / daily extension remains in [`../chrome-extension/`](../chrome-extension/) (**ISAT Tracker**) and is unchanged by this variant.

| | Main (`chrome-extension/`) | This test build |
| --- | --- | --- |
| Manifest name | ISAT Tracker | **ISAT Tracker (AUTO-SUBMIT TEST)** |
| Open Form | Opens prefilled URL; marks **Read** | Opens URL, **auto-clicks Submit**, marks **Done/Submitted** |
| Stable extension `key` | Yes (`fldldeff…`) | **No** (Chrome assigns a new ID — load beside the main ext) |
| Use | Daily tracking | Local / QA autosubmit experiments only |

---

## What “Open Form + Submit” does

1. Marks the email **Read** / opened (local storage).
2. Opens the prefilled Google Form in a new tab.
3. A content script on `docs.google.com/forms` finds the **Submit** button and clicks it — **only** for tabs this extension opened with a pending autosubmit (`forms.gle` short links redirect there; no script on the short domain).
4. On success (confirmation page or click completed), marks the entry **Done / Submitted** locally.

Manual **Done** checkbox and **Show done** behave like the main extension.

---

## Load unpacked (test build)

1. `chrome://extensions` → Developer mode  
2. **Load unpacked** → this folder: `chrome-extension-autosubmit-test/`  
3. Confirm the card title is **ISAT Tracker (AUTO-SUBMIT TEST)**  
4. You can keep the main **ISAT Tracker** loaded at the same time (different ID)

### OAuth note

This build has **no** fixed public `key`, so its extension ID is not `fldldeffedenajeiaeodlhajihlligda`.

- Prefer **Fix B** (Web OAuth client + `launchWebAuthFlow`): add  
  `https://<this-extension-id>.chromiumapp.org/`  
  as an Authorized redirect URI (copy ID from `chrome://extensions`).
- Or create a separate Chrome Extension OAuth client whose Item ID matches **this** test extension’s ID.

Same `oauth2.client_id` as the main extension is fine for the Web-client path. Never put `client_secret` in the extension.

---

## Package `chrome-extension-autosubmit-test-only.zip`

```bash
# From repo root
cd chrome-extension-autosubmit-test
rm -f ../chrome-extension-autosubmit-test-only.zip
zip -r ../chrome-extension-autosubmit-test-only.zip . \
  -x '*.DS_Store' -x '*~' -x '*.map'
cd ..
ls -la chrome-extension-autosubmit-test-only.zip
```

Then: unzip → Load unpacked that folder. Do **not** put secrets or `.env` in the zip.

---

## Safety

- Submits real Google Form responses for whatever prefilled URL is in the email.
- Intended for controlled test accounts / throwaway responses.
- Unload this extension when finished testing; use [`../chrome-extension/`](../chrome-extension/) for normal work.
