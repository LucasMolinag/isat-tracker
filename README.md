# ISAT Tracker

Multi-user web app: connect Google, pull inbox mail matching configurable subject rules, show a dashboard, and track **Unread → Read → Submitted** against a Google Form via per-email tracking tokens.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Auth.js (NextAuth v5) Google provider
- Postgres via Prisma
- OAuth tokens encrypted at rest (`TOKEN_ENCRYPTION_KEY`)
- Live Gmail + Sheets/Forms APIs on **Sync now** / `POST /api/sync`

## Status flow

1. **Unread** — created when Gmail sync upserts a matching message.
2. **Read** — user opens `/r/{trackingId}` from the dashboard (idempotent; never downgrades Submitted).
3. **Submitted** — sync matcher finds the tracking token in a linked Sheet or Forms responses.

Dashboard “Open form” goes through `/r/{trackingId}`, then redirects to the Google Form with `entry.<fieldId>=<trackingId>` prefilled.

## Quick start

```bash
cp .env.example .env
# fill in DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_*, TOKEN_ENCRYPTION_KEY

npm install
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AUTH_URL` | Public app URL (e.g. `http://localhost:3000`) |
| `AUTH_SECRET` | Auth.js session secret (`openssl rand -base64 32`) |
| `AUTH_GOOGLE_CLIENT_ID` | Google OAuth web client id |
| `AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth web client secret |
| `DATABASE_URL` | Postgres connection string for Prisma |
| `TOKEN_ENCRYPTION_KEY` | 32-byte AES key as hex (`openssl rand -hex 32`) or base64 |

Aliases: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `NEXTAUTH_SECRET` / `NEXTAUTH_URL` are also read where noted in code.

**Do not commit secrets.** `.env*` is gitignored (`.env.example` is tracked).

## Google Cloud setup (one-time)

1. Create a GCP project (or reuse one).
2. Enable APIs:
   - **Gmail API**
   - **Google Sheets API** (recommended for Submitted matching)
   - **Google Forms API** (optional if you match via Forms responses instead of a Sheet)
3. Configure the **OAuth consent screen** (External or Internal). Add scopes used by the app:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/spreadsheets.readonly`
   - `https://www.googleapis.com/auth/forms.responses.readonly`
4. Create an **OAuth client ID** → Application type **Web application**.
5. Authorized redirect URI for Auth.js:
   - Local: `http://localhost:3000/api/auth/callback/google`
   - Prod: `https://YOUR_DOMAIN/api/auth/callback/google`
6. Copy client id/secret into `.env` as `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`.
7. Put `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY` in env (Vercel / hosting + local `.env`).

After changing scopes, users must sign out and sign in again (`prompt=consent` is already set) so a new refresh token includes Gmail/Sheets/Forms.

### Per-form setup

1. Add a short-answer (or hidden) question reserved for the tracking ID.
2. Prefill link / “Get pre-filled link” → copy the `entry.XXXXXXXX` field id into **Settings**.
3. **Submitted matching (pick one):**
   - **Preferred:** Link the form to a Google Sheet → paste the spreadsheet id (or full URL) into **Response Sheet id**. Sync reads sheet cells for tracking UUIDs.
   - **Alternative:** Leave Sheet empty and use a Forms **edit** URL (`https://docs.google.com/forms/d/{FORM_ID}/edit`). The public `/forms/d/e/...` viewform id is **not** a Forms API `formId`; sync will error with guidance if only `/d/e/` is configured.

## Sync behavior

`POST /api/sync` (Settings / Dashboard **Sync now**):

1. Builds Gmail `q` from enabled subject rules (`Exact` → `subject:"…"`, `Contains` → `subject:…`, OR’d).
2. Lists messages, creates missing `EmailEntry` rows as **Unread** (links default `FormConfig` when present). Existing rows keep their status.
3. Scans Sheet cells or Forms response answers for open entries’ `trackingId` → **Submitted** (never downgrades).
4. Updates `User.lastSyncAt` / `lastSyncError` from the Gmail step.

Clear errors when client secrets, tokens, or scopes are missing (HTTP 207 if either step fails).

`/r/{trackingId}` is unchanged: mark **Read** → redirect with form prefill.

## What’s implemented vs remaining

| Area | Status |
| --- | --- |
| Prisma models + encrypted tokens | Done |
| Auth.js Google sign-in (scopes above) | Done (needs real OAuth client) |
| Settings + dashboard + `/r/{trackingId}` | Done |
| Live Gmail subject sync | Done |
| Live Forms/Sheets → Submitted | Done |
| Background cron / Gmail Pub/Sub | **Not yet** — sync is on-demand via `/api/sync` |
| Multi-form routing / digests | Out of MVP |

## Scripts

```bash
npm run dev          # Next.js dev server
npm run build        # production build
npm run lint
npx prisma migrate dev
npx prisma generate
npx prisma studio
```

## Security notes

- All domain queries are scoped by `userId`.
- Tracking links are UUIDs; status writes are idempotent and never downgrade Submitted.
- Access/refresh tokens are encrypted at rest; refresh writes re-encrypt the new access token.
