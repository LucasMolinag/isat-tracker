# ISAT Tracker

Multi-user web app: connect Google, pull inbox mail matching configurable subject rules, show a dashboard, and track **Unread → Read → Submitted** against a Google Form via per-email tracking tokens.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Auth.js (NextAuth v5) Google provider
- Postgres via Prisma
- OAuth tokens encrypted at rest (`TOKEN_ENCRYPTION_KEY`)

## Status flow

1. **Unread** — synced from Gmail (stub until Gmail API is wired).
2. **Read** — user opens `/r/{trackingId}` from the dashboard (idempotent; never downgrades Submitted).
3. **Submitted** — Forms/Sheets matcher finds the tracking token in responses (stub until Sheets/Forms API is wired).

Dashboard “Open form” goes through `/r/{trackingId}`, then redirects to the Google Form with `entry.<fieldId>=<trackingId>` prefilled.

## Quick start

```bash
cp .env.example .env
# fill in DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_*, TOKEN_ENCRYPTION_KEY

npm install
npx prisma migrate dev --name init
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

**Do not commit secrets.** `.env*` is gitignored.

## Google Cloud setup (one-time)

1. Create a GCP project (or reuse one).
2. Enable APIs:
   - **Gmail API**
   - **Google Sheets API**
   - **Google Forms API** (if using Forms responses instead of a linked Sheet)
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

### Per-form setup

1. Add a short-answer (or hidden) question reserved for the tracking ID.
2. Prefill link / “Get pre-filled link” → copy the `entry.XXXXXXXX` field id into Settings.
3. Optionally link the form to a Sheet and store the spreadsheet id for the response matcher.

## What’s implemented vs stubbed

| Area | Status |
| --- | --- |
| Prisma models (User, Account/Session, SubjectRule, FormConfig, EmailEntry, StatusEvent) | Done |
| Encrypted token helpers + adapter wrap on `linkAccount` | Done |
| Auth.js Google sign-in (scopes listed above) | Done (needs real OAuth client) |
| Settings: subject rules + form config + Sync now | Done (persists to DB) |
| Dashboard list + status chips + Open form | Done (empty until sync creates rows) |
| `/r/{trackingId}` → mark Read → redirect with prefill | Done |
| Gmail subject sync | **Stub** — builds query / updates `lastSync*`; no live API |
| Forms/Sheets response → Submitted | **Stub** — no live API; `markSubmittedByTrackingId` helper ready |
| Deploy / cron jobs | Out of this scaffold |

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
- Encrypt tokens with `encryptAccountTokens` / decrypt with `decryptAccountTokens` before Google API calls.
