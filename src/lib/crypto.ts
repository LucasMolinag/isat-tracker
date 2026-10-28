/**
 * Encrypted token storage hooks for OAuth refresh/access tokens at rest.
 *
 * Uses AES-256-GCM with TOKEN_ENCRYPTION_KEY (32-byte hex or base64).
 * Never log plaintext tokens. Prefer these helpers over writing Account
 * token fields directly.
 *
 * TODO: rotate keys via version prefix when ops needs re-encryption.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION_PREFIX = "v1:";

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set (32-byte secret as hex or base64)",
    );
  }

  // Hex (64 chars) or base64
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)",
    );
  }
  return buf;
}

/** Encrypt a secret string for DB storage. Returns versioned ciphertext. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return `${VERSION_PREFIX}${payload}`;
}

/** Decrypt a value produced by encryptToken. Pass-through if unversioned (legacy/plain). */
export function decryptToken(ciphertext: string): string {
  if (!ciphertext.startsWith(VERSION_PREFIX)) {
    // Allow reading legacy plaintext during migration; callers should re-encrypt on write.
    return ciphertext;
  }

  const key = getKey();
  const payload = Buffer.from(ciphertext.slice(VERSION_PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/** True when value looks like our encrypted format. */
export function isEncryptedToken(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(VERSION_PREFIX));
}

/**
 * Encrypt Account token fields before Prisma write.
 * Use in Auth.js events / custom adapter wrappers.
 */
export function encryptAccountTokens<
  T extends {
    access_token?: string | null;
    refresh_token?: string | null;
    id_token?: string | null;
  },
>(account: T): T {
  return {
    ...account,
    access_token: account.access_token
      ? encryptToken(account.access_token)
      : account.access_token,
    refresh_token: account.refresh_token
      ? encryptToken(account.refresh_token)
      : account.refresh_token,
    // id_token is JWT identity — encrypt at rest as well for consistency
    id_token: account.id_token ? encryptToken(account.id_token) : account.id_token,
  };
}

/** Decrypt Account token fields after Prisma read (for Google API calls). */
export function decryptAccountTokens<
  T extends {
    access_token?: string | null;
    refresh_token?: string | null;
    id_token?: string | null;
  },
>(account: T): T {
  return {
    ...account,
    access_token: account.access_token
      ? decryptToken(account.access_token)
      : account.access_token,
    refresh_token: account.refresh_token
      ? decryptToken(account.refresh_token)
      : account.refresh_token,
    id_token: account.id_token ? decryptToken(account.id_token) : account.id_token,
  };
}
