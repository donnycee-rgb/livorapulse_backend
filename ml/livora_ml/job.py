"""The nightly job: from everyone's DailyFeatures to effects and forecasts.

    python -m livora_ml.job                      # needs ML_DATABASE_URL
    python -m livora_ml.job --dry-run            # simulated users, no database

Runs at 00:45 Nairobi time, after the API has built yesterday's
DailyFeatures (00:30). It:

1. reads the last WINDOW_DAYS of DailyFeatures,
2. fits the mood model (model.py),
3. replaces every user's habit effects (MlUserEffect),
4. writes today's mood forecast for every user with enough history
   (MlPrediction), and saves each user's fitted model (MlUserModel) so the
   API can re-forecast during the day with what's been logged since,
   e.g. last night's sleep, and
5. records the run (MlModelRun), including how yesterday's forecasts did
   against the moods people actually logged.

`plan()` is the whole computation with no database, so it can be tested;
`main()` wraps it with reading and writing (db.py).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Mapping, Optional, Sequence

import numpy as np

from .features import build_user
from .model import MODEL_VERSION, effects_table, fit, forecast, summarise_population, user_params

OUTCOME = "mood"
WINDOW_DAYS = 180  # history the model learns from
# Below these the population estimate isn't trustworthy: record a skipped run
# and leave existing results alone rather than publish noise.
MIN_USERS = 5
MIN_ROWS = 100
MIN_USER_DAYS = 5  # a user needs this many days with a mood logged to get results


@dataclass
class Plan:
    status: str  # "succeeded" | "skipped"
    reason: Optional[str]
    users: int  # users with any mood day in the window
    rows: int  # days with a mood logged, across users
    population: Optional[dict] = None
    metrics: dict = field(default_factory=dict)
    effects: list[dict] = field(default_factory=list)  # MlUserEffect rows (with userId)
    predictions: list[dict] = field(default_factory=list)  # MlPrediction rows (with userId, date)
    models: list[dict] = field(default_factory=list)  # MlUserModel rows: the API forecasts on demand with these


def _check_previous(previous: Sequence[Mapping], rows_by_user: Mapping[str, Sequence[Mapping]]) -> dict:
    """How did earlier forecasts do? Compare them with the moods logged since."""
    actual = {}
    for uid, rows in rows_by_user.items():
        for r in rows:
            if r.get("moodValue") is not None:
                actual[(uid, r["date"])] = float(r["moodValue"])
    errs, inside = [], 0
    for p in previous:
        y = actual.get((p["userId"], p["date"]))
        if y is None:
            continue
        errs.append((p["mean"] - y) ** 2)
        inside += p["lower"] <= y <= p["upper"]
    if not errs:
        return {}
    return {"checkedForecasts": len(errs), "forecastRmse": float(np.sqrt(np.mean(errs))), "forecastCoverage80": inside / len(errs)}


def plan(rows_by_user: Mapping[str, Sequence[Mapping]], today: date,
         previous_predictions: Sequence[Mapping] = (),
         min_users: int = MIN_USERS, min_rows: int = MIN_ROWS, min_user_days: int = MIN_USER_DAYS) -> Plan:
    """Everything the job decides, without touching a database.

    rows_by_user: DailyFeatures rows per user, `date` as a local calendar date.
    today: the local day to forecast.
    """
    users = {uid: build_user(rows) for uid, rows in rows_by_user.items()}
    users = {uid: u for uid, u in users.items() if u.n > 0}
    n_rows = sum(u.n for u in users.values())
    metrics = _check_previous(previous_predictions, rows_by_user)

    if len(users) < min_users or n_rows < min_rows:
        return Plan(status="skipped", users=len(users), rows=n_rows, metrics=metrics,
                    reason=f"not enough data yet: {len(users)} users with mood logged (need {min_users}), "
                           f"{n_rows} mood days (need {min_rows})")

    result = fit(users)
    pop = result.population
    out = Plan(status="succeeded", reason=None, users=len(users), rows=n_rows,
               population=summarise_population(pop), metrics=metrics)
    out.metrics["fitConverged"] = pop.converged
    out.metrics["fitIterations"] = pop.iterations

    yesterday = today - timedelta(days=1)
    for uid, post in result.users.items():
        if post.n < min_user_days:
            continue
        for e in effects_table(pop, post):
            out.effects.append({"userId": uid, "outcome": OUTCOME, **e})
        out.models.append({"userId": uid, "outcome": OUTCOME, "params": user_params(pop, post), "nDays": post.n})
        by_date = {r["date"]: r for r in rows_by_user[uid]}
        fc = forecast(pop, post, by_date.get(today), by_date.get(yesterday), today)
        if fc is not None:
            out.predictions.append({"userId": uid, "date": today, "outcome": OUTCOME, "mean": fc.mean,
                                    "lower": fc.lower, "upper": fc.upper, "nDays": post.n})
    out.metrics["usersWithResults"] = len({e["userId"] for e in out.effects})
    out.metrics["personalClaims"] = sum(e["claim"] == "personal" for e in out.effects)
    return out


def _dry_run(today: date) -> Plan:
    from .simulate import simulate
    sims = simulate(60, (20, 90), seed=11, start=today - timedelta(days=95))
    return plan({s.id: s.rows for s in sims}, today)


def main(argv: Optional[Sequence[str]] = None) -> int:
    from . import db

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="use simulated users; read and write nothing")
    ap.add_argument("--today", help="local day to forecast, YYYY-MM-DD (default: today in Nairobi)")
    a = ap.parse_args(argv)
    today = date.fromisoformat(a.today) if a.today else db.local_today()

    if a.dry_run:
        p = _dry_run(today)
        print(json.dumps({"status": p.status, "reason": p.reason, "users": p.users, "rows": p.rows,
                          "effects": len(p.effects), "predictions": len(p.predictions), "metrics": p.metrics}, indent=2))
        return 0

    url = os.environ.get("ML_DATABASE_URL")
    if not url:
        print("ML_DATABASE_URL is not set", file=sys.stderr)
        return 2

    with db.connect(url) as conn:
        run_id = db.start_run(conn, MODEL_VERSION)
        try:
            rows_by_user = db.read_features(conn, since=today - timedelta(days=WINDOW_DAYS))
            previous = db.read_predictions(conn, OUTCOME, since=today - timedelta(days=7), before=today)
            p = plan(rows_by_user, today, previous)
            db.write_results(conn, run_id, p, MODEL_VERSION)
        except Exception as e:  # record the failure, then let the job fail visibly
            conn.rollback()
            db.fail_run(conn, run_id, f"{type(e).__name__}: {e}")
            raise
    print(f"{p.status}: {p.users} users, {p.rows} mood days, {len(p.effects)} effects, "
          f"{len(p.predictions)} forecasts" + (f" ({p.reason})" if p.reason else ""))
    if p.metrics:
        print(json.dumps(p.metrics))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
