# ISAT Tracker (Chrome extension)

Simple MV3 popup that lists Jira ISAT survey emails from Gmail and opens:

- **Open Form** — full prefilled Google Form URL from the message body (prefers links ending in `=3`)
- **Open Ticket** — `https://glia.atlassian.net/browse/{KEY}` parsed from the subject

No Neon/Vercel/Submitted tracking — local Chrome + Gmail only.

## Fix “OAuth2 request failed: bad client id”

That error almost always means the **GCP OAuth client type / Item ID does not match this unpacked extension**. Use this checklist:

### Exact checklist (Lucas)

1. **OAuth client type must be “Chrome Extension”**  
   GCP → APIs & Services → Credentials → the client  
   `860318366086-o9dfo14prko87bgetr3t5r210f0djpjv.apps.googleusercontent.com`  
   - Application type: **Chrome Extension** (not Web application, not Desktop).  
   - A **Web** client ID causes `bad client id` with `chrome.identity.getAuthToken`.

2. **Item ID must equal the Chrome extension ID**  
   Fixed ID for this repo (from the public `key` in `manifest.json`):

   ```
   fldldeffedenajeiaeodlhajihlligda
   ```

   In the Chrome Extension OAuth client, set **Item ID** to exactly that string → Save.

3. **Confirm Chrome shows the same ID**  
   - `chrome://extensions` → Developer mode → **Load unpacked** → select `chrome-extension/`  
   - On the card, **ID** must be `fldldeffedenajeiaeodlhajihlligda`  
   - If it differs, you loaded the wrong folder or an old copy without `key` — remove the extension and load this folder again.

4. **`manifest.json` `oauth2.client_id` must be exact**

   ```json
   "oauth2": {
     "client_id": "860318366086-o9dfo14prko87bgetr3t5r210f0djpjv.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
   }
   ```

   No spaces, full `.apps.googleusercontent.com` suffix.

5. **Reload after any manifest / GCP change**  
   On `chrome://extensions`, click **Reload** on ISAT Tracker (or Remove → Load unpacked again). Then open the popup → **Connect Google**.

6. **Gmail API enabled** on the same GCP project as that OAuth client  
   APIs & Services → Library → **Gmail API** → Enable.

7. **Consent screen includes the scope**  
   `https://www.googleapis.com/auth/gmail.readonly`  
   After scope changes, revoke the app under Google Account → Security → Third-party access and connect again.

### Why a fixed `key`?

Unpacked extensions normally get an ID derived from the folder path (unstable across machines). This repo commits a public `"key"` in `manifest.json` so the ID is always:

`fldldeffedenajeiaeodlhajihlligda`

Only the **public** key is in git (safe). The private PEM is not committed.

## What it queries

```
from:jira@glia.atlassian.net (subject:"How was the collab on" OR subject:"How is the information provided on")
```

Scope: `https://www.googleapis.com/auth/gmail.readonly` only (no Drive).

## Load unpacked

1. Open `chrome://extensions` → Developer mode  
2. **Load unpacked** → this `chrome-extension/` folder  
3. Confirm ID = `fldldeffedenajeiaeodlhajihlligda`  
4. Ensure GCP Chrome Extension client Item ID matches → Reload extension  
5. Popup → **Connect Google** → **Refresh**

## Use

1. **Connect Google** — Gmail readonly  
2. **Refresh** — matching survey messages  
3. **Open Ticket** / **Open Form** (new tabs)

## Layout

```
chrome-extension/
  manifest.json      # MV3, oauth2.client_id, public key (stable ID)
  background.js
  popup.html|css|js
  lib/forms.js | gmail.js | jira.js
  icons/
  README.md
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `bad client id` | Client must be **Chrome Extension** type; Item ID = `fldldeffedenajeiaeodlhajihlligda`; client_id exact; reload extension |
| Extension ID ≠ fixed ID | Load this folder (with `key`); remove old unpacked copy |
| Gmail API not used / 403 | Enable Gmail API on the same GCP project |
| Wrong Google account | Disconnect in popup, reconnect |

## Privacy

- Tokens via `chrome.identity` (Chrome-managed)  
- List cache in `chrome.storage.session` only  
- No analytics
