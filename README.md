# LivoraPulse — Backend

The API behind **LivoraPulse**, a free wellness tracker built for Kenya and
Africa. People log their physical activity, nutrition, screen time, focus
sessions, mood, eco habits and menstrual cycle. The backend stores it,
combines it into a daily **LifePulse Score**, and looks for patterns in each
person's own data ("on days you sleep 7+ hours, your mood is higher").

Frontend: [livorapulse](https://github.com/donnycee-rgb/livorapulse) ·
Live: <https://livorapulse.netlify.app>

**Stack:** Fastify · TypeScript · PostgreSQL + Prisma · Redis + BullMQ ·
Vitest. Deployed on Railway.

---

## What it does

| Area | What the backend handles |
| --- | --- |
| **Accounts** | Email + password and Google sign-in, JWT access tokens with rotating refresh tokens, a 6-digit email code to confirm new accounts, password reset by emailed link |
| **Tracking** | Physical activity (steps, distance, sleep, GPS walks), nutrition and water (with a built-in Kenyan / East African food list), digital usage, focus and study sessions, mood and stress, eco actions, cycle tracking |
| **LifePulse Score** | A 0–100 daily score across six areas, plus streaks and history |
| **Insights** | A nightly job tests each person's data for real patterns (permutation tests with false-discovery control) and only shows ones that hold up |
| **Experiments** | 14-day self-experiments started from an insight, with daily check-ins and a result at the end |
| **Health summary** | A summary of recent weeks, downloadable as PDF, which can be shared through an expiring link (e.g. with a doctor) |
| **Health flags** | "Worth getting checked" notices for concerning patterns. Off until the wording is signed off (`HEALTH_FLAGS_ENABLED`) |
| **AI coach** | A chat that answers questions using the person's own data (Anthropic Claude) |

### LifePulse Score weights

Physical 23% · Productivity 20% · Digital 18% · Mood 14% · Eco 14% · Nutrition 11%
(`src/services/ScoreService.ts`)

---

## Running it locally

**Needs:** Node.js 20+, PostgreSQL 14+, Redis 7+.

```bash
npm install
cp .env.example .env      # then fill it in (see below)
npm run db:migrate
npm run db:seed           # optional: demo@livorapulse.com / Demo1234!
npm run dev               # http://localhost:4000
```

Run the frontend alongside it; Vite forwards `/api` to port 4000.

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✓ | Postgres connection string |
| `REDIS_URL` | ✓ | Rate limits, codes, streaks and background jobs |
| `PORT`, `HOST` | | Default `4000` |
| `NODE_ENV` | | `production` on Railway |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ✓ | Long random strings |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | | e.g. `15m`, `30d` |
| `SESSION_SECRET` | ✓ | 32+ characters; used during Google sign-in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | | Google sign-in |
| `FRONTEND_URL` | ✓ | Allowed CORS origin and the base of emailed links |
| `BCRYPT_ROUNDS` | | Default `12` |
| `APP_TIMEZONE` | | Defines a "day". Default `Africa/Nairobi` |
| `ANTHROPIC_API_KEY` | | AI coach. Without it the coach is unavailable |
| `MAIL_RELAY_URL`, `MAIL_RELAY_SECRET` | prod | Email sending, see below |
| `HEALTH_FLAGS_ENABLED` | | `false` until signed off |

---

## Email

Sign-up codes and password reset links are sent through a small **Google Apps
Script web app** that sends with Gmail from the account that deployed it. The
backend writes each email (`src/services/EmailService.ts`) and posts it to the
script with a shared secret.

Setup steps, limits and error codes: [`mail-relay/README.md`](mail-relay/README.md).

Without `MAIL_RELAY_URL` / `MAIL_RELAY_SECRET`, development prints codes and
links to the console; production refuses to send.

---

## Background jobs

BullMQ workers start with the server. Times are in `APP_TIMEZONE`.

| Job | When | What |
| --- | --- | --- |
| Daily summary | 00:05 | Finalises yesterday's score for every user |
| Insights | 00:30 | Recomputes daily features and re-runs the pattern tests |
| Streaks | Hourly | Keeps each user's streak fresh in Redis |

To rebuild insights for everyone: `npm run insights:backfill`.

---

## API overview

Every route is under `/api`. Responses look like `{ success, data }` or
`{ success: false, error }`. Routes need `Authorization: Bearer <token>`
except sign-in, sign-up, password reset and shared summaries.

| Prefix | Purpose |
| --- | --- |
| `/auth` | register, login, logout, refresh, `me`, Google, verify email, forgot/reset password |
| `/user`, `/user/onboarding` | profile, preferences, first-run setup |
| `/activity/physical`, `/activity/digital` | log and read activity / screen time |
| `/productivity/session` | focus and study sessions, goals |
| `/mood`, `/eco`, `/nutrition`, `/cycle` | logging, history, food search, water, cycle calendar |
| `/score` | daily score, streak, history |
| `/insights`, `/experiments`, `/flags` | patterns, experiments, health flags |
| `/summary`, `/shared/summary/:token` | health summary, PDF, share links |
| `/ai/chat` | AI coach |
| `GET /health` | health check |

The full list is in `src/routes/`.

---

## Project layout

```
src/
  App.ts, server.ts   app setup and entry point (also starts the workers)
  routes/             HTTP routes (thin)
  services/           business logic: auth, email, score, insights, PDF…
  insights/           the pattern engine (pure functions, no database)
  jobs/               BullMQ queues and workers
  schemas/            Zod request validation
  middleware/         auth, validation, error handling
  db/                 Prisma and Redis clients
  data/               Kenyan food list
prisma/               schema, migrations, seed
mail-relay/           Google Apps Script that sends email
test/                 unit tests; test/db/ runs against a real Postgres
```

## Scripts

| Script | |
| --- | --- |
| `npm run dev` | Dev server with reload |
| `npm run build` / `npm start` | Compile; migrate and run in production |
| `npm test` | Unit tests (no database needed) |
| `npm run test:db` | Database and route tests against a temporary Postgres |
| `npm run typecheck` | Type-check |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma |

## Security notes

- Passwords hashed with bcrypt; refresh tokens rotated on every use.
- Codes and reset tokens are stored only as hashes, are single-use, and are rate-limited.
- Forgot-password gives the same answer whether or not the email has an account.
- Rate limits on all routes, tighter on auth. CORS only allows `FRONTEND_URL`. Helmet headers.
