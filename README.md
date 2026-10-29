# ISAT Tracker

Multi-user web app: connect Google, pull inbox mail matching configurable subject rules, show a dashboard, and track **Unread → Read → Submitted** against a Google Form via per-email tracking tokens and Sheet ticket-key matching.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Auth.js (NextAuth v5) Google provider
- Neon Postgres via Prisma (`DATABASE_URL` pooled + `DATABASE_URL_UNPOOLED` for migrations)
- OAuth tokens encrypted at rest (`TOKEN_ENCRYPTION_KEY`)
- Live Gmail + Sheets APIs on **Sync now** / `POST /api/sync`
- Vercel Cron → `GET /api/cron/sync` (secured with `CRON_SECRET`; daily on Hobby)

## Status flow

1. **Unread** — created when Gmail sync upserts a matching message.
2. **Read** — signed-in owner opens `/r/{trackingId}` (session required; never downgrades Submitted).
3. **Submitted** — sync matcher finds the **ticket key** (`CE-XXXX`) in a linked response Sheet (not on Open form).

Dashboard **Open Form** goes through `/r/{trackingId}` (new tab), then redirects to that email’s extracted Google Form URL (full prefill; prefers `=3`; does not overwrite QoS rating).

## Quick start (local)

```bash
npm install
# Link Neon / copy .env.example → .env.local with DATABASE_URL*

# Add AUTH_SECRET, AUTH_GOOGLE_*, TOKEN_ENCRYPTION_KEY to .env.local
npx prisma migrate deploy
npm run build
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Confirm `GET /api/health` → `database.ok: true`.

## Environment checklist

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_URL` | Yes (prod) | Public app URL (`https://…`) — also used for CSRF origin checks |
| `AUTH_SECRET` | Yes | Auth.js session secret (`openssl rand -base64 32`) |
| `AUTH_GOOGLE_CLIENT_ID` | Yes | Google OAuth web client id |
| `AUTH_GOOGLE_CLIENT_SECRET` | Yes | Google OAuth web client secret |
| `DATABASE_URL` | Yes | Neon **pooled** URL (`-pooler`) |
| `DATABASE_URL_UNPOOLED` | Yes | Neon **direct** URL for Prisma Migrate |
| `TOKEN_ENCRYPTION_KEY` | Yes | 32-byte AES key (`openssl rand -hex 32`) |
| `CRON_SECRET` | Yes (prod cron) | Bearer secret for `/api/cron/sync` |
| `NEON_BRANCH` | No | Informational |

Aliases: `GOOGLE_CLIENT_*`, `NEXTAUTH_SECRET` / `NEXTAUTH_URL`.

**Do not commit secrets.** `.env` / `.env.local` are gitignored. Never commit `NEON_API_KEY`.

### If secrets may have leaked

Rotate immediately (do not reuse old values):

1. `AUTH_SECRET` — new `openssl rand -base64 32` (invalidates sessions).
2. `TOKEN_ENCRYPTION_KEY` — new `openssl rand -hex 32`, then have users **reconnect Google** (old ciphertext won’t decrypt).
3. `CRON_SECRET` — new `openssl rand -base64 32` in Vercel.
4. Google OAuth client secret — rotate in GCP console + update `AUTH_GOOGLE_CLIENT_SECRET`.
5. Neon DB password / connection strings — rotate in Neon console; update both URL env vars.
6. Revoke suspicious Google refresh tokens (Google Account → Security → Third-party access) and sign in again.

## Google OAuth scopes (minimal)

Requested at sign-in (no Drive):

| Scope | Why |
| --- | --- |
| `openid` `email` `profile` | Sign-in identity |
| `gmail.readonly` | List/read matching survey mail |
| `spreadsheets.readonly` | Submitted detection via response Sheet |

**Not requested:** Drive, Gmail send/modify, Sheets write, Forms body. Optional Forms responses API is unused unless you later add a Forms **edit** URL + re-add `forms.responses.readonly`.

Enable in GCP: **Gmail API**, **Google Sheets API**. After changing scopes, users must sign out/in (`prompt=consent`).

## Go live

1. Set env vars on Vercel (table above). `AUTH_URL` = production URL.
2. OAuth redirect: `https://YOUR_HOST/api/auth/callback/google`
3. Deploy (`npm run build` runs `prisma migrate deploy`).
4. Sign in → Settings: subject rules, form URL, **Response Sheet id**, tracking field id.
5. Sync now / wait for cron:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://YOUR_HOST/api/cron/sync
```

Cron schedule (Hobby daily UTC 14:00): see `vercel.json`. Prefer `Authorization: Bearer` (query `?secret=` disabled in production).

## Sync behavior

**On-demand** `POST /api/sync`: session + same-origin CSRF + per-user rate limit; current user only.

**Scheduled** `/api/cron/sync`: `CRON_SECRET`; all Google-linked users.

Both: Gmail upsert → refresh `formUrl` → Sheet ticket-key match → Submitted. Sync UI shows a short summary only (no Gmail query / Forms noise).

## Security

- **Tenant isolation:** dashboard, settings mutations, sync, and `/r` queries are scoped by `userId`. Settings updates use `updateMany({ id, userId })`.
- **`/r/{trackingId}`:** requires signed-in **owner** session (works with Open Form `target=_blank` same-site cookies). Generic 404/401; no status/PII in errors. Unguessable UUID tracking ids.
- **Open → Read only;** Submitted only via Sheet match after real Form Submit.
- **CSRF:** `POST /api/sync` requires Origin/Referer matching `AUTH_URL` (and known Vercel hosts).
- **Rate limit:** ~15s cooldown per user on Sync now (best-effort in-memory on serverless).
- **Headers:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP (see `next.config.ts`).
- **Secrets:** tokens encrypted at rest; cron timing-safe compare; health reports key *presence* only; sync/cron messages sanitized (no Bearer/DB URLs).
- Server Actions on Settings are Auth.js-session gated + Next.js Server Action CSRF.

## Scripts

```bash
npm run dev
npm run build              # migrate deploy + next build
npm run build:ci           # generate + next build (no migrate)
npm run db:migrate:deploy
npm run lint
```
