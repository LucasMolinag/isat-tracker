/**
 * Request hardening helpers: same-origin CSRF checks, sync rate limit,
 * and public-facing error sanitization (never echo secrets).
 */

import { isProduction } from "@/lib/env";

const SYNC_COOLDOWN_MS = 15_000;
const syncLastHit = new Map<string, number>();

/** Allowed web origins for browser mutations (AUTH_URL + local dev). */
export function allowedOrigins(): string[] {
  const out = new Set<string>();
  for (const raw of [
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  ]) {
    if (!raw?.trim()) continue;
    try {
      out.add(new URL(raw).origin);
    } catch {
      // ignore
    }
  }
  if (!isProduction()) {
    out.add("http://localhost:3000");
    out.add("http://127.0.0.1:3000");
  }
  return [...out];
}

/**
 * CSRF defense for cookie-authenticated POST APIs.
 * Requires Origin (or Referer) to match AUTH_URL / known Vercel hosts.
 */
export function assertSameOrigin(request: Request): {
  ok: boolean;
  reason?: string;
} {
  const allowed = allowedOrigins();
  if (allowed.length === 0) {
    return {
      ok: false,
      reason: "AUTH_URL is not configured",
    };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    return allowed.includes(origin)
      ? { ok: true }
      : { ok: false, reason: "Origin not allowed" };
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return allowed.includes(refOrigin)
        ? { ok: true }
        : { ok: false, reason: "Referer not allowed" };
    } catch {
      return { ok: false, reason: "Invalid Referer" };
    }
  }

  // Browser POSTs should send Origin. Reject when missing in production.
  if (isProduction()) {
    return { ok: false, reason: "Missing Origin" };
  }
  return { ok: true };
}

/** Per-user cooldown for POST /api/sync (in-memory; best-effort on serverless). */
export function assertSyncRateLimit(userId: string): {
  ok: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const last = syncLastHit.get(userId) ?? 0;
  const elapsed = now - last;
  if (elapsed < SYNC_COOLDOWN_MS) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000),
    };
  }
  syncLastHit.set(userId, now);
  return { ok: true };
}

/** Strip tokens / connection strings from messages shown to users or cron JSON. */
export function sanitizePublicError(message: string): string {
  let m = message.replace(/\s+/g, " ").trim();
  m = m.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  m = m.replace(/postgresql:\/\/\S+/gi, "[db redacted]");
  m = m.replace(/postgres:\/\/\S+/gi, "[db redacted]");
  m = m.replace(/ya29\.[A-Za-z0-9._\-]+/g, "[token redacted]");
  m = m.replace(/1\/\/[A-Za-z0-9_\-]+/g, "[refresh redacted]");
  m = m.replace(
    /TOKEN_ENCRYPTION_KEY|AUTH_SECRET|CRON_SECRET|CLIENT_SECRET/gi,
    "[env]",
  );

  if (/invalid_grant|failed to refresh|refresh.?token/i.test(m)) {
    return "Google session expired. Sign out and sign in again.";
  }
  if (/Missing Gmail scope/i.test(m)) {
    return "Reconnect Google to grant Gmail readonly access.";
  }
  if (/Missing Sheets scope/i.test(m)) {
    return "Reconnect Google to grant Sheets readonly access.";
  }
  if (/insufficient|PERMISSION_DENIED|403/i.test(m) && /scope/i.test(m)) {
    return "Google permission missing. Reconnect Google from the home page.";
  }

  if (m.length > 180) m = `${m.slice(0, 180)}…`;
  return m || "Something went wrong.";
}
