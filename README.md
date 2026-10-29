# ISAT Tracker

Multi-user web app: connect Google, pull inbox mail matching configurable subject rules, show a dashboard, and track **Unread → Read → Submitted** against a Google Form via per-email tracking tokens.

Looking for a lighter local option? See the **[Chrome extension](./chrome-extension/)** (`chrome-extension/`) — Gmail readonly popup with Open Form / Open Ticket, no Neon or Submitted tracking.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Auth.js (NextAuth v5) Google provider
- Neon Postgres via Prisma (`DATABASE_URL` pooled + `DATABASE_URL_UNPOOLED` for migrations)
- OAuth tokens encrypted at rest (`TOKEN_ENCRYPTION_KEY`)
- Live Gmail + Sheets/Forms APIs on **Sync now** / `POST /api/sync`
- Vercel Cron → `GET /api/cron/sync` (secured with `CRON_SECRET`; daily on Hobby, `*/15` needs Pro)
- `neon.ts` + Neon CLI (`neon init` / `neon deploy` / `neon env pull`)

## Status flow

1. **Unread** — created when Gmail sync upserts a matching message.
2. **Read** — user opens `/r/{trackingId}` from the dashboard (idempotent; never downgrades Submitted).
3. **Submitted** — sync matcher finds the tracking token in a linked Sheet or Forms responses.

Dashboard “Open form” goes through `/r/{trackingId}`, then redirects to the Google Form with `entry.<fieldId>=<trackingId>` prefilled.

## Quick start (local)

```bash
npm install
# Link Neon (once) and pull DATABASE_URL* into .env.local:
#   neon init -y --org-id … --project-id … --branch production --services postgres
#   neon deploy
# Or: cp .env.example .env.local and paste pooled + unpooled URLs

# Add AUTH_SECRET, AUTH_GOOGLE_*, TOKEN_ENCRYPTION_KEY to .env.local
npx prisma migrate deploy   # uses DATABASE_URL_UNPOOLED via Prisma directUrl
npm run build               # migrate deploy + next build
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Confirm `GET /api/health` → `database.ok: true`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_URL` | Yes (prod) | Public app URL (`https://…vercel.app`) |
| `AUTH_SECRET` | Yes | Auth.js session secret (`openssl rand -base64 32`) |
| `AUTH_GOOGLE_CLIENT_ID` | Yes | Google OAuth web client id |
| `AUTH_GOOGLE_CLIENT_SECRET` | Yes | Google OAuth web client secret |
| `DATABASE_URL` | Yes | Neon **pooled** URL (`-pooler`) for app queries |
| `DATABASE_URL_UNPOOLED` | Yes | Neon **direct** URL for Prisma Migrate |
| `NEON_BRANCH` | No | Set by `neon env pull` (informational) |
| `TOKEN_ENCRYPTION_KEY` | Yes | 32-byte AES key (`openssl rand -hex 32`) |
| `CRON_SECRET` | Yes (prod cron) | Bearer secret for `/api/cron/sync` (`openssl rand -base64 32`) |

Aliases: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET` / `NEXTAUTH_URL`.

**Do not commit secrets.** `.env` / `.env.local` are gitignored (`.env.example` is tracked). Never commit `NEON_API_KEY`.

`GET /api/health` reports env key presence (never values) and pings Postgres (`database.ok`).

## Go live (production checklist)

### 1. Neon Postgres

1. Project is linked via `neon.ts` / CLI (`neon init` … `--project-id wispy-moon-02969203` for ISAT Tracker).
2. `neon deploy` then `neon env pull` (or Vercel Neon integration) so both URLs exist:
   - `DATABASE_URL` — pooled (app / serverless)
   - `DATABASE_URL_UNPOOLED` — direct (migrations)
3. On Vercel, set **both** URL env vars (and run migrations at build via `prisma migrate deploy`).

### 2. Google Cloud OAuth

1. GCP project → enable **Gmail API**, **Google Sheets API**, and optionally **Google Forms API**.
2. OAuth consent screen (Internal for Workspace, or External):
   - Scopes:
     - `openid`, `email`, `profile`
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/spreadsheets.readonly`
     - `https://www.googleapis.com/auth/forms.responses.readonly`
3. Create **OAuth client → Web application**.
4. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR_PROJECT.vercel.app/api/auth/callback/google`
5. Authorized JavaScript origins (optional): your `AUTH_URL` origins.
6. Put client id/secret in Vercel env as `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`.

After changing scopes, each user must sign out and sign in again (`prompt=consent` is set) so refresh tokens include Gmail/Sheets/Forms.

### 3. Form tracking field

1. Add a short-answer (or hidden) question reserved for the tracking ID.
2. “Get pre-filled link” → copy `entry.XXXXXXXX` into **Settings → Tracking entry field id**.
3. Link responses to a Sheet → paste spreadsheet id/URL into **Response Sheet id** (preferred), **or** use a Forms **edit** URL (`/forms/d/{id}/edit`) for Forms API matching. Public `/d/e/` viewform ids are not Forms API formIds.

### 4. Vercel deploy

1. Import the GitHub repo in Vercel (Framework: Next.js).
2. Set env vars from the table above (`AUTH_URL` = your Vercel URL).
3. Deploy. `npm run build` runs `prisma migrate deploy` then `next build` — `DATABASE_URL` must be available at build time.
4. Confirm `GET https://YOUR_HOST/api/health` → `ready: true`, `cronReady: true`.
5. Sign in once, configure subject rules + form, click **Sync now**, then wait for cron or curl:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_HOST/api/cron/sync
```

### 5. Cron

`vercel.json` schedules cron (Hobby-compatible **daily** UTC 14:00):

```json
{ "path": "/api/cron/sync", "schedule": "0 14 * * *" }
```

- Vercel injects `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set in project env.
- Also accepts `x-cron-secret` or `?secret=` (prefer header).
- Cron syncs **all** users with a linked Google account (Gmail upsert + Forms/Sheets → Submitted).
- Hobby plan allows at most one run per day; upgrade to Pro for `*/15 * * * *`.

## Sync behavior

**On-demand** `POST /api/sync` (session auth): current user only.

**Scheduled** `GET|POST /api/cron/sync` (`CRON_SECRET`): every Google-linked user.

Both:

1. Build Gmail `q` from enabled subject rules (optional per-rule `fromAddress`), e.g. `from:jira@glia.atlassian.net (subject:"How was the collab on" OR subject:"How is the information provided on")`.
2. Upsert `EmailEntry` (**Unread** for new; never downgrade status). On sync, parse the message body for a `docs.google.com/forms` / `forms.gle` link and store it on `EmailEntry.formUrl`.
3. Match Sheet/Forms tokens → **Submitted**.
4. Update `User.lastSyncAt` / `lastSyncError` from the Gmail step.

`/r/{trackingId}`: mark **Read** → redirect to **that email’s** extracted form URL (FormConfig URL is fallback only), prefilling `entryFieldId` when set.

## What’s implemented vs remaining

| Area | Status |
| --- | --- |
| Prisma + encrypted tokens + Auth.js Google | Done |
| Settings / dashboard / `/r/{trackingId}` | Done |
| Live Gmail + Forms/Sheets sync | Done |
| Vercel Cron (`/api/cron/sync` + `CRON_SECRET`) | Done |
| Gmail Pub/Sub push | Later |
| Multi-form routing / digests | Out of MVP |

## Scripts

```bash
npm run dev              # Next.js dev
npm run build            # migrate deploy + next build (needs DATABASE_URL)
npm run build:ci         # generate + next build (no migrate; local/CI without DB)
npm run db:migrate:deploy
npm run lint
```

## Security notes

- Domain queries scoped by `userId`.
- Tracking links are UUIDs; status writes never downgrade Submitted.
- Tokens encrypted at rest; cron endpoint rejects missing/invalid `CRON_SECRET` with timing-safe compare.
