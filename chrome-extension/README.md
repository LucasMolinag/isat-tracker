# ISAT Tracker (Chrome extension)

Simple MV3 popup that lists Jira ISAT survey emails from Gmail and opens:

- **Open Form** — full prefilled Google Form URL (prefers links ending in `=3`)
- **Open Ticket** — `https://glia.atlassian.net/browse/{KEY}`

No Neon/Vercel/Submitted tracking.

Stable unpacked extension ID (public `key` in `manifest.json`):

```
fldldeffedenajeiaeodlhajihlligda
```

Current `oauth2.client_id`:

```
860318366086-dekb4ibq0sv0lm2bsj2dmv0bj1n23sho.apps.googleusercontent.com
```

---

## “OAuth2 request failed: bad client id” — diagnosis

If you **downloaded `client_secret_….json`**, that OAuth client is almost certainly a **Web application** (or Desktop) client — **not** type **Chrome Extension**.

| Signal | Meaning |
| --- | --- |
| You have `client_secret_*.json` | **Web** client → `getAuthToken` → **bad client id** |
| Chrome Extension client | No secret JSON; only Client ID + Item ID field |
| Fixed extension ID | `fldldeffedenajeiaeodlhajihlligda` |

`chrome.identity.getAuthToken` **only** works with OAuth clients of type **Chrome Extension** whose **Item ID** equals the extension ID.

This extension will **fall back** to `launchWebAuthFlow` when `getAuthToken` returns bad client id (Web client path). For that fallback you must add a redirect URI (Fix B below). **Do not** put `client_secret` in the extension.

---

## Fix A (recommended): Recreate as Chrome Extension client

1. GCP → **APIs & Services → Credentials → + Create credentials → OAuth client ID**
2. Application type: **Chrome Extension** (not Web application)
3. **Item ID:** `fldldeffedenajeiaeodlhajihlligda`
4. Create → copy the **Client ID** only (there is **no** client secret to download)
5. Paste into `manifest.json` → `oauth2.client_id`
6. Enable **Gmail API** on the same project
7. Consent screen: add scope `https://www.googleapis.com/auth/gmail.readonly`
8. `chrome://extensions` → **Reload** ISAT Tracker (or Remove → Load unpacked `chrome-extension/`)
9. Confirm card **ID** = `fldldeffedenajeiaeodlhajihlligda`
10. Popup → **Connect Google**

You can delete or ignore the old Web client that produced `client_secret_*.json`.

---

## Fix B: Keep the Web client (your current ID)

Use this if you keep  
`860318366086-o9dfo14prko87bgetr3t5r210f0djpjv.apps.googleusercontent.com`.

1. Open that OAuth client in GCP (type should show **Web application**)
2. **Authorized redirect URIs** → add **exactly**:

   ```
   https://fldldeffedenajeiaeodlhajihlligda.chromiumapp.org/
   ```

3. Save
4. Enable **Gmail API**
5. Reload the extension → **Connect Google**  
   (extension tries `getAuthToken`, then opens Google sign-in via `launchWebAuthFlow`)

Still **never** commit or paste `client_secret` into the extension.

---

## Load unpacked

1. `chrome://extensions` → Developer mode  
2. **Load unpacked** → this `chrome-extension/` folder  
3. ID must be `fldldeffedenajeiaeodlhajihlligda`  
4. Apply Fix A or Fix B → Reload → Connect  

## What it queries

```
from:jira@glia.atlassian.net (subject:"How was the collab on" OR subject:"How is the information provided on")
```

Scope: `gmail.readonly` only (no Drive).

## Use

1. **Connect Google**  
2. **Refresh**  
3. **Open Ticket** / **Open Form** (new tabs)

## Layout

```
chrome-extension/
  manifest.json       # client_id + public key (stable ID)
  background.js
  lib/auth.js         # getAuthToken + launchWebAuthFlow fallback
  lib/gmail.js | forms.js | jira.js
  popup.*
  README.md
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `bad client id` | Web client used with getAuthToken → Fix A or add redirect URI (Fix B) |
| Auth window closes / no token | Redirect URI must be exactly `https://fldldeffedenajeiaeodlhajihlligda.chromiumapp.org/` |
| Extension ID ≠ fixed ID | Load this folder (with `key`); remove other copies |
| Gmail 403 | Enable Gmail API; reconnect |

## Privacy

- Tokens via `chrome.identity` / session storage only  
- No `client_secret` in the package  
- No analytics
