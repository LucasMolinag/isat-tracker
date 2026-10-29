/**
 * Google auth for the extension.
 *
 * - chrome.identity.getAuthToken → requires OAuth client type **Chrome Extension**
 * - chrome.identity.launchWebAuthFlow → works with **Web application** clients
 *   (the kind that download client_secret_*.json — do NOT put the secret in the extension)
 *
 * If Lucas downloaded a client_secret JSON, the client is almost certainly Web, not
 * Chrome Extension — getAuthToken will fail with "bad client id". Use web flow, or
 * recreate a Chrome Extension client (no secret).
 */

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Test variant has no stable public key — ID is assigned on load. */
function getExtId() {
  return chrome.runtime.id;
}

export function getOAuthClientId() {
  const manifest = chrome.runtime.getManifest();
  return manifest.oauth2?.client_id || "";
}

/** Redirect URI Chrome assigns for launchWebAuthFlow. */
export function getWebFlowRedirectUri() {
  return chrome.identity.getRedirectURL();
}

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

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url, interactive: true },
      (responseUrl) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!responseUrl) {
          reject(new Error("Auth flow returned no redirect URL"));
          return;
        }
        resolve(responseUrl);
      },
    );
  });
}

function isBadClientIdError(message) {
  return /bad client id|OAuth2 request failed/i.test(message || "");
}

/**
 * Auth via Web application client (no client_secret in the extension).
 * Requires Authorized redirect URI on the GCP Web client:
 *   https://<this-extension-id>.chromiumapp.org/
 * (chrome.identity.getRedirectURL() — TEST build has no fixed public key.)
 */
export async function authViaWebFlow() {
  const clientId = getOAuthClientId();
  if (!clientId || /REPLACE_WITH/i.test(clientId)) {
    throw new Error("oauth2.client_id missing in manifest.json");
  }

  const redirectUri = getWebFlowRedirectUri();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", GMAIL_SCOPE);
  authUrl.searchParams.set("prompt", "select_account consent");
  authUrl.searchParams.set("include_granted_scopes", "true");

  const responseUrl = await launchWebAuthFlow(authUrl.toString());

  // Implicit flow returns tokens in the URL fragment.
  const hash = new URL(responseUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") || "3600");
  const error = params.get("error");

  if (error) {
    throw new Error(`Google OAuth error: ${error}`);
  }
  if (!accessToken) {
    throw new Error(
      "No access_token in redirect (often Error 400 redirect_uri_mismatch). " +
        "On the Web OAuth client add Authorized redirect URI exactly: " +
        redirectUri +
        " — this TEST build has no fixed key; do not reuse the main fldldeff… URI. See README.",
    );
  }

  await chrome.storage.session.set({
    authMode: "webflow",
    accessToken,
    accessTokenExpiresAt: Date.now() + expiresIn * 1000,
    connected: true,
  });

  return accessToken;
}

async function getStoredWebToken() {
  const data = await chrome.storage.session.get([
    "authMode",
    "accessToken",
    "accessTokenExpiresAt",
  ]);
  if (
    data.authMode === "webflow" &&
    data.accessToken &&
    Number(data.accessTokenExpiresAt || 0) > Date.now() + 60_000
  ) {
    return data.accessToken;
  }
  return null;
}

/**
 * Acquire a Gmail access token.
 * Tries getAuthToken (Chrome Extension client), then launchWebAuthFlow (Web client).
 */
export async function acquireAccessToken(interactive = true) {
  const stored = await getStoredWebToken();
  if (stored) return stored;

  try {
    const token = await getAuthToken(interactive);
    await chrome.storage.session.set({
      authMode: "extension",
      accessToken: null,
      accessTokenExpiresAt: null,
      connected: true,
    });
    return token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!interactive) {
      throw e;
    }
    // Web clients (client_secret JSON) fail getAuthToken with bad client id.
    if (isBadClientIdError(msg) || /invalid_client|unauthorized/i.test(msg)) {
      try {
        return await authViaWebFlow();
      } catch (webErr) {
        const webMsg =
          webErr instanceof Error ? webErr.message : String(webErr);
        throw new Error(formatBadClientHelp(msg, webMsg));
      }
    }
    throw e;
  }
}

export function formatBadClientHelp(getAuthMsg, webMsg) {
  const extId = getExtId();
  const redirect = `https://${extId}.chromiumapp.org/`;
  return [
    "OAuth failed.",
    "This AUTO-SUBMIT TEST build has no fixed key — ID is " +
      extId +
      " (not the main fldldeff… ID).",
    "Auth tries getAuthToken first, then launchWebAuthFlow (Web client).",
    "Error 400 redirect_uri_mismatch → on the Web OAuth client add Authorized redirect URI exactly: " +
      redirect +
      " then Reload the TEST extension and Connect again.",
    "Or create a Chrome Extension OAuth client with Item ID " +
      extId +
      ", put that client_id in this test manifest, reload.",
    "Do not put client_secret in the extension. See chrome-extension-autosubmit-test/README.md.",
    getAuthMsg ? `getAuthToken: ${getAuthMsg}` : "",
    webMsg ? `webFlow: ${webMsg}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function clearAuth() {
  const data = await chrome.storage.session.get(["authMode", "accessToken"]);
  if (data.authMode === "extension") {
    try {
      const token = await getAuthToken(false);
      await removeCachedToken(token);
    } catch {
      // ignore
    }
  }
  await chrome.storage.session.set({
    connected: false,
    cache: null,
    authMode: null,
    accessToken: null,
    accessTokenExpiresAt: null,
  });
}

export { removeCachedToken, getAuthToken, isBadClientIdError };
