/**
 * Google OAuth access for Gmail / Sheets / Forms using stored Account tokens.
 * Tokens are decrypted on read and re-encrypted on refresh write.
 */

import { prisma } from "@/lib/prisma";
import {
  decryptAccountTokens,
  encryptToken,
} from "@/lib/crypto";

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_client"
      | "missing_account"
      | "missing_tokens"
      | "refresh_failed"
      | "api_error",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

function googleClientCredentials() {
  const clientId =
    process.env.AUTH_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.AUTH_GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      "AUTH_GOOGLE_CLIENT_ID / AUTH_GOOGLE_CLIENT_SECRET are not set",
      "missing_client",
    );
  }
  return { clientId, clientSecret };
}

export type GoogleAccess = {
  accessToken: string;
  accountId: string;
  userId: string;
  scope: string | null;
};

/**
 * Return a usable access token for the user's Google account, refreshing if needed.
 */
export async function getGoogleAccessToken(
  userId: string,
): Promise<GoogleAccess> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account) {
    throw new GoogleAuthError(
      "No Google account linked — sign in with Google first",
      "missing_account",
    );
  }

  const decrypted = decryptAccountTokens({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  });

  if (!decrypted.access_token && !decrypted.refresh_token) {
    throw new GoogleAuthError(
      "Google OAuth tokens missing — reconnect Google and grant requested scopes",
      "missing_tokens",
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = account.expires_at ?? 0;
  const stillValid =
    Boolean(decrypted.access_token) && expiresAt > nowSec + 60;

  if (stillValid && decrypted.access_token) {
    return {
      accessToken: decrypted.access_token,
      accountId: account.id,
      userId,
      scope: account.scope,
    };
  }

  if (!decrypted.refresh_token) {
    throw new GoogleAuthError(
      "Access token expired and no refresh_token stored — sign out/in with prompt=consent",
      "missing_tokens",
    );
  }

  const { clientId, clientSecret } = googleClientCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: decrypted.refresh_token,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new GoogleAuthError(
      `Google token refresh failed: ${json.error_description ?? json.error ?? res.statusText}`,
      "refresh_failed",
      res.status,
    );
  }

  const expires_at = Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600);

  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: encryptToken(json.access_token),
      expires_at,
      ...(json.scope ? { scope: json.scope } : {}),
    },
  });

  return {
    accessToken: json.access_token,
    accountId: account.id,
    userId,
    scope: json.scope ?? account.scope,
  };
}

/** Authenticated Google API GET/POST with one retry after forced refresh on 401. */
export async function googleFetch(
  userId: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const access = await getGoogleAccessToken(userId);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${access.accessToken}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    // Force refresh by zeroing expires_at then retry once.
    await prisma.account.update({
      where: { id: access.accountId },
      data: { expires_at: 0 },
    });
    const refreshed = await getGoogleAccessToken(userId);
    headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
    res = await fetch(url, { ...init, headers });
  }

  return res;
}

export async function googleJson<T>(
  userId: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await googleFetch(userId, url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = data as { error?: { message?: string; status?: string } };
    throw new GoogleAuthError(
      err?.error?.message ??
        `Google API ${res.status} for ${url.split("?")[0]}`,
      "api_error",
      res.status,
    );
  }

  return data as T;
}

/** True if granted scope string includes the required scope URL. */
export function hasScope(
  granted: string | null | undefined,
  required: string,
): boolean {
  if (!granted) return true; // unknown — let the API fail with a clear error
  return granted.split(/[\s,]+/).includes(required);
}
