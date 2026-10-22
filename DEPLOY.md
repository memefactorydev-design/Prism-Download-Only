# Deploying

The app runs in two parts:

- **Web dashboard** (Next.js) — deploys to Vercel (or any Node host).
- **Studio worker** (`npm run worker`) — ffmpeg + Whisper video rendering. Needs a
  **persistent host** (a small VPS, Railway, Render, Fly.io, or your own machine).
  It cannot run on Vercel (serverless: no long-running process, no ffmpeg). The
  rest of the app works fine without it — only Studio video rendering needs it.

## Database

Prisma provider is **SQLite** (`sqlite`), via a driver adapter chosen at runtime
in `src/lib/db.ts`:

- **Local dev** → a file DB (`DATABASE_URL="file:./dev.db"`, better-sqlite3).
- **Serverless / Vercel** → **Turso** (serverless SQLite). Set `TURSO_DATABASE_URL`
  + `TURSO_AUTH_TOKEN`; a file DB can't be written on a read-only serverless FS.

Because the provider stays `sqlite`, the same schema + migrations work in both.

## Vercel (dashboard) — step by step

1. **Create a Turso DB and its schema:**
   ```sh
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth login
   turso db create prism
   turso db show prism --url        # → TURSO_DATABASE_URL (libsql://…)
   turso db tokens create prism     # → TURSO_AUTH_TOKEN
   # create the tables (migrations are plain SQLite, so they run on Turso):
   for f in prisma/migrations/*/migration.sql; do turso db shell prism < "$f"; done
   ```

2. **Set Environment Variables** in Vercel → Project → Settings → Environment
   Variables (Production + Preview):

   | Key | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the `libsql://…` URL |
   | `TURSO_AUTH_TOKEN` | the token |
   | `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` |
   | `DATABASE_URL` | *(optional)* same `libsql://…` URL |

   Service API keys (Anthropic, Postiz, Meta, Apify, ElevenLabs, WordPress, FTP) are
   entered on the live **/connections** page — they're stored encrypted in the DB,
   which is why `TOKEN_ENCRYPTION_KEY` is required.

3. **Deploy.** Push to `main` (auto-deploys) or redeploy the latest commit. The
   build runs `prisma generate && next build`. Env-var changes require a new build.

### Notes / limits

- The AI/research routes use `maxDuration = 300` → requires **Vercel Pro**
  (Hobby caps at 60 s). On Hobby, lower them or those features will time out.
- Studio (`/studio` rendering) needs the worker on a persistent host (see top).

## Persistent host (full app incl. Studio)

Run both processes on a host with ffmpeg support:

```sh
npm ci
npx prisma migrate deploy      # or: npx prisma db push
npm run build && npm run start  # web
npm run worker                  # in a second process
```

Keep `DATABASE_URL` as SQLite (`file:./dev.db`) or point it at Turso/Postgres.
