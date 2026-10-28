/**
 * Runtime env validation for production. Avoid throwing at import time so
 * `next build` can succeed without secrets; call assert* from request paths.
 */

export type EnvRequirement = {
  key: string;
  present: boolean;
  hint: string;
};

function present(...keys: string[]): boolean {
  return keys.some((k) => Boolean(process.env[k]?.trim()));
}

/** Checklist of values the operator must set (no secret values returned). */
export function envChecklist(): EnvRequirement[] {
  return [
    {
      key: "DATABASE_URL",
      present: present("DATABASE_URL"),
      hint: "Neon pooled URL (-pooler) for app queries; from `neon deploy` / env pull",
    },
    {
      key: "DATABASE_URL_UNPOOLED",
      present: present("DATABASE_URL_UNPOOLED"),
      hint: "Neon direct URL for Prisma Migrate (`directUrl`)",
    },
    {
      key: "AUTH_SECRET",
      present: present("AUTH_SECRET", "NEXTAUTH_SECRET"),
      hint: "openssl rand -base64 32",
    },
    {
      key: "AUTH_URL",
      present: present("AUTH_URL", "NEXTAUTH_URL"),
      hint: "Public site URL, e.g. https://your-app.vercel.app",
    },
    {
      key: "AUTH_GOOGLE_CLIENT_ID",
      present: present("AUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
      hint: "GCP OAuth web client id",
    },
    {
      key: "AUTH_GOOGLE_CLIENT_SECRET",
      present: present("AUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
      hint: "GCP OAuth web client secret",
    },
    {
      key: "TOKEN_ENCRYPTION_KEY",
      present: present("TOKEN_ENCRYPTION_KEY"),
      hint: "openssl rand -hex 32 (32-byte AES key)",
    },
    {
      key: "CRON_SECRET",
      present: present("CRON_SECRET"),
      hint: "Shared secret for /api/cron/sync (openssl rand -base64 32)",
    },
  ];
}

export function missingEnvKeys(): string[] {
  return envChecklist()
    .filter((r) => !r.present)
    .map((r) => r.key);
}

/** Throws if any required production env vars are missing. */
export function assertRequiredEnv(keys?: string[]): void {
  const required = keys ?? [
    "DATABASE_URL",
    "AUTH_SECRET",
    "AUTH_GOOGLE_CLIENT_ID",
    "AUTH_GOOGLE_CLIENT_SECRET",
    "TOKEN_ENCRYPTION_KEY",
  ];
  const checklist = envChecklist();
  const missing = required.filter((key) => {
    const row = checklist.find((r) => r.key === key);
    return !row?.present;
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. See .env.example / README Go live.`,
    );
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}
