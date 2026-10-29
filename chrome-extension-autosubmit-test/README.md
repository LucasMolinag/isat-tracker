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

### Which auth path this TEST build uses

Main `chrome-extension/` has a fixed public `key` → stable ID `fldldeffedenajeiaeodlhajihlligda`.

This TEST build has **no** `key` → Chrome assigns a **new ID every load-unpacked install** (or after remove + reload). That ID is **not** `fldldeff…`.

Connect runs `acquireAccessToken()` in `lib/auth.js`:

1. **First:** `chrome.identity.getAuthToken` — only works with an OAuth client of type **Chrome Extension** whose **Item ID** equals **this** test extension’s ID.
2. **Fallback (Web / launchWebAuthFlow):** on “bad client id” / OAuth2 request failed, it uses `chrome.identity.launchWebAuthFlow` against the TEST `oauth2.client_id` in `manifest.json` (`860318366086-deqgmkbfdeglroq70ehchcqcflpcrude…`). That flow redirects to:

   ```text
   https://<THIS_TEST_EXTENSION_ID>.chromiumapp.org/
   ```

So with the current shared Web client id, the effective path is **Web client + launchWebAuthFlow**. `Error 400: redirect_uri_mismatch` means that exact URI is missing on the Web client (the main extension’s `https://fldldeffedenajeiaeodlhajihlligda.chromiumapp.org/` does **not** cover this test build).

Never put `client_secret` in the extension.

---

### Fix: `Error 400: redirect_uri_mismatch` (Web client / launchWebAuthFlow)

Do this when Connect opens a Google sign-in window and Google shows **redirect_uri_mismatch** (the usual case for this TEST build).

1. Open `chrome://extensions`
2. Find **ISAT Tracker (AUTO-SUBMIT TEST)** (not the main ISAT Tracker)
3. Copy the **ID** under the card (long hex string). Call it `EXTENSION_ID`.
4. Open [Google Cloud Console](https://console.cloud.google.com/) → the project that owns  
   `860318366086-deqgmkbfdeglroq70ehchcqcflpcrude.apps.googleusercontent.com`
5. **APIs & Services → Credentials** → open **that** OAuth client
6. Match the client type to how you configured it:
   - **Web application** → under **Authorized redirect URIs** → **Add URI** → paste **exactly** (trailing `/` required):

     ```text
     https://EXTENSION_ID.chromiumapp.org/
     ```

   - **Chrome Extension** → set **Item ID** to the same `EXTENSION_ID` (the loaded AUTO-SUBMIT TEST card — not main `fldldeff…`)
7. **Save**
8. Back in Chrome: on the TEST extension card click **Reload**, then Connect again

The Item ID / `https://<TEST_ID>.chromiumapp.org/` must match the **currently loaded** AUTO-SUBMIT TEST extension. If you remove and re-load unpacked, the ID can change — update GCP to match.

Enable **Gmail API** on the same GCP project if it is not already.

---

### Alternative: Chrome Extension OAuth client (getAuthToken path)

Only if you want `getAuthToken` to succeed without the web-flow fallback:

1. `chrome://extensions` → copy the **ISAT Tracker (AUTO-SUBMIT TEST)** ID (`EXTENSION_ID`)
2. GCP → **Credentials → + Create credentials → OAuth client ID**
3. Application type: **Chrome Extension** (not Web application)
4. **Item ID:** paste `EXTENSION_ID` (the unloaded/loaded test extension’s ID — **not** the main `fldldeff…` ID)
5. Create → copy the new **Client ID** only (there is no secret)
6. Put that Client ID in `chrome-extension-autosubmit-test/manifest.json` → `oauth2.client_id`
7. Consent screen: scope `https://www.googleapis.com/auth/gmail.readonly`
8. Reload the TEST extension → Connect

If you later remove + re-load unpacked and the ID changes, update the Chrome Extension client’s Item ID (or recreate the client) to match.

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
