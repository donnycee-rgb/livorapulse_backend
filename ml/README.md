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

## Database

Tables (owned by Prisma, `prisma/schema.prisma`): `MlModelRun`, `MlUserEffect`,
`MlPrediction`. The job reads `DailyFeatures` and writes only these.

## Running locally

    cd ml
    python -m venv .venv
    .venv/Scripts/python -m pip install -r requirements.txt      # Windows
    .venv/Scripts/python -m pytest -q
    .venv/Scripts/python -m livora_ml.evaluate

## Next

1. Nightly job: read `DailyFeatures` from Supabase, fit, write effects and
   forecasts (GitHub Actions on a schedule, with a database login limited to
   the ML tables).
2. Show them in the app.
3. Daily suggestions chosen by Thompson sampling.
