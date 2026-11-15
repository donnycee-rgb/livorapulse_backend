# LivoraPulse ML

Learns, for each person, which daily habits go with a better mood, and
forecasts each morning how the day is likely to go. Written in Python; the
Node API only reads the results from the database.

## The model

**Outcome:** the day's mood (`DailyFeatures.moodValue`, 1–5).
**Inputs**, all known by that morning: last night's sleep, and the day before's
steps, screen time, social media, focus, water and mood, plus a weekend flag.

Each input is compared with the person's **own average**, so "this person is
generally happier" is kept apart from "this person feels better on days they
sleep more".

**Hierarchical Bayesian linear regression.** Each person's habit effects are
drawn around a population average:

    mood_t − own average = x_t · b_user + noise,     b_user ~ N(mu, diag(tau²))

Each person's posterior is closed-form (conjugate normal). A new person starts
at what's typical and moves toward their own pattern as their days add up.
The population (`mu`, `tau²`, noise) is fitted from everyone by empirical-Bayes
EM. See `livora_ml/model.py` for the equations.

**What users are told.** Every effect gets a `claim`:

| claim | when | wording |
|---|---|---|
| `personal` | P(direction) ≥ 95% **and** at least half the certainty comes from their own days | "For you, …" |
| `typical` | the population effect is clear | "For most people, …" |
| `unclear` | neither | say nothing |

The own-data rule matters: without it, confident claims had the wrong sign
6–10% of the time on simulated users; with it, about 1–2%.

## Checked on simulated users

The database is new, so the model is developed against `livora_ml/simulate.py`:
people with known true effects, their own habits, and realistic gaps in
logging, written in the same shape as `DailyFeatures`.

    python -m livora_ml.evaluate

Typical result (200 users, 14–120 days each):

| | hierarchical | each person alone | one model for all |
|---|---|---|---|
| habit-effect error, users with <30 days | **0.059** | 0.831 | 0.068 |
| habit-effect error, all users | **0.056** | 0.541 | 0.067 |

* "For you" claims: right direction ~98–99%.
* Morning forecast error 0.52 vs 0.59 (your average) and 0.67 (same as yesterday);
  80% intervals hold ~81–83% of actual moods.
* Known limit: when people differ only a little on a habit and daily mood is
  noisy, the model underestimates how much people differ (steps, here), so its
  90% intervals hold ~83–89% rather than 90%. The own-data rule above keeps
  this from reaching users.

## The nightly job

`python -m livora_ml.job` (`livora_ml/job.py`), run by GitHub Actions
(`.github/workflows/ml-nightly.yml`) at **00:45 Nairobi**, after the API builds
yesterday's `DailyFeatures` at 00:30. It:

1. reads the last 180 days of `DailyFeatures`,
2. fits the model,
3. **replaces** every user's habit effects in `MlUserEffect`,
4. writes **today's** mood forecast to `MlPrediction` (one row per user per day, kept),
5. records the run in `MlModelRun`, including how earlier forecasts did against
   the moods people then logged (`forecastRmse`, `forecastCoverage80`).

Safeguards:

* **Not enough data, no results.** Under 5 users with mood logged or 100 mood
  days in total, the run is recorded as `skipped` and published results are
  left alone. A user needs 5 mood days to get their own results.
* **All or nothing.** Results are written in one transaction.
* **Failures are recorded** (`status = failed`, with the error) and the
  workflow fails, so GitHub emails you.
* **Limited login.** The job uses a database role that can read
  `DailyFeatures` and write the ML tables, nothing else (`sql/ml_role.sql`).

Known limit: at 00:45 last night's sleep isn't in `DailyFeatures` yet (it's
built the following night), so today's forecast uses the day before only.

`python -m livora_ml.job --dry-run` runs it on simulated users without a database.

### Setting it up (once)

1. Deploy the ML tables migration (merging to `main` makes Render run it).
2. Supabase → **SQL Editor**: paste `ml/sql/ml_role.sql`, set a long
   letters-and-digits password, **Run**.
3. GitHub → this repo → **Settings → Secrets and variables → Actions → New
   repository secret**: name `ML_DATABASE_URL`, value
   `postgresql://livora_ml.<project-ref>:<password>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`.
4. **Actions → ML nightly → Run workflow** to try it now. Expect `skipped`
   until enough people have logged moods.

GitHub pauses scheduled workflows in a repo with no commits for 60 days;
re-enable it in the Actions tab if that happens.

## Database

Tables (owned by Prisma, `prisma/schema.prisma`): `MlModelRun`, `MlUserEffect`,
`MlPrediction`. The job reads `DailyFeatures` and writes only these.

## Running locally

    cd ml
    python -m venv .venv
    .venv/Scripts/python -m pip install -r requirements.txt      # Windows
    .venv/Scripts/python -m pytest -q     # database tests need node + npm ci in the repo root
    .venv/Scripts/python -m livora_ml.evaluate

## Next

1. Show effects and forecasts in the app.
2. Daily suggestions chosen by Thompson sampling.
3. Use last night's sleep in the morning forecast.
