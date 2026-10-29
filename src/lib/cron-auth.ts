import { timingSafeEqual } from "crypto";
import { isProduction } from "@/lib/env";

/**
 * Authorize Vercel Cron (or manual) callers via CRON_SECRET.
 *
 * Accepted:
 * - Authorization: Bearer <CRON_SECRET>  (Vercel Cron default)
 * - x-cron-secret: <CRON_SECRET>
 * - ?secret= only in non-production (query secrets leak via logs/Referer)
 */
export function assertCronAuthorized(request: Request): {
  ok: boolean;
  reason?: string;
} {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return {
      ok: false,
      reason: "CRON_SECRET is not configured on the server",
    };
  }

  const provided = extractCronSecret(request);
  if (!provided) {
    return {
      ok: false,
      reason: "Missing cron secret (Authorization: Bearer or x-cron-secret)",
    };
  }

  if (!safeEqual(provided, expected)) {
    return { ok: false, reason: "Invalid cron secret" };
  }

  return { ok: true };
}

function extractCronSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const header = request.headers.get("x-cron-secret");
  if (header?.trim()) return header.trim();

  if (!isProduction()) {
    try {
      const url = new URL(request.url);
      const q = url.searchParams.get("secret");
      if (q?.trim()) return q.trim();
    } catch {
      // ignore
    }
  }

  return null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still compare to reduce trivial timing leaks on length.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
