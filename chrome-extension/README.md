# ISAT Tracker (Chrome extension)

Simple MV3 popup that lists Jira ISAT survey emails from Gmail and opens:

- **Open Form** — full prefilled Google Form URL from the message body (prefers links ending in `=3`)
- **Open Ticket** — `https://glia.atlassian.net/browse/{KEY}` parsed from the subject

No Neon/Vercel/Submitted tracking — local Chrome + Gmail only.

## What it queries

```
from:jira@glia.atlassian.net (subject:"How was the collab on" OR subject:"How is the information provided on")
```

Scope requested: `https://www.googleapis.com/auth/gmail.readonly` only (no Drive).

## 1. Create a Google OAuth client (Chrome Extension)

1. Open [Google Cloud Console](https://console.cloud.google.com/) → your project (or create one).
2. Enable **Gmail API**.
3. **APIs & Services → OAuth consent screen**
   - User type: Internal (Workspace) or External for testing
   - Add scope: `.../auth/gmail.readonly`
4. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Chrome Extension**
   - Item ID: your extension ID (see step 3 below — you may create the client after first load, or use a temporary ID and update)
5. Copy the **Client ID** (`….apps.googleusercontent.com`).

### Alternate: Web application client

If you prefer a Web client with `chrome.identity`:

1. Create **OAuth client → Web application**
2. Authorized redirect URI (Chrome identity):
   ```
   https://<EXTENSION_ID>.chromiumapp.org/
   ```
3. Put that client ID in `manifest.json` → `oauth2.client_id`

For `chrome.identity.getAuthToken`, the **Chrome Extension** client type tied to the extension ID is the usual path.

## 2. Put the client ID in the manifest

Edit `manifest.json`:

```json
"oauth2": {
  "client_id": "123456789-abcdef.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
}
```

Do **not** commit a production client secret (Chrome Extension OAuth clients used with `getAuthToken` do not embed a secret in the extension).

## 3. Load unpacked in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `chrome-extension/` folder
4. Copy the **Extension ID** on the card
5. If your OAuth client needs it, paste that ID into the GCP Chrome Extension OAuth client → save
6. Click the puzzle icon → pin **ISAT Tracker** → open the popup → **Connect Google**

After changing `oauth2.client_id` or the extension ID mapping, remove the extension and load unpacked again (or refresh), then reconnect.

## 4. Use

1. **Connect Google** — grants Gmail readonly
2. **Refresh** — fetches matching messages (full body for form URL extract)
3. Per row: **Open Ticket** / **Open Form** (both `target=_blank`)

## Layout

```
chrome-extension/
  manifest.json      # MV3 + oauth2 + host permissions
  background.js      # identity + Gmail fetch
  popup.html|css|js  # UI
  lib/forms.js       # prefer =3 form URL extract
  lib/jira.js        # CE-XXXX → browse URL
  lib/gmail.js       # Gmail list + full message parse
  icons/             # toolbar icons
  README.md
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `bad client id` / OAuth error | Client ID in manifest must match a Chrome Extension (or Web) client; extension ID must be registered on that client |
| `Gmail API has not been used` | Enable Gmail API on the GCP project |
| `403 insufficient permissions` | Reconnect after adding `gmail.readonly` on the consent screen |
| No form link on a row | Body had no `docs.google.com/forms` / `forms.gle` URL; open the mail in Gmail to confirm |
| Quota errors | Wait a minute; Refresh pulls full messages (rate-limited by design) |

## Privacy

- Tokens come from `chrome.identity` (Chrome-managed); not stored in `localStorage`
- Session cache of the last list lives in `chrome.storage.session` (cleared when the browser profile session ends)
- No third-party analytics
