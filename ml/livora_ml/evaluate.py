"""How well does the model work? Checked on simulated users with known truth.

    python -m livora_ml.evaluate                 # default study
    python -m livora_ml.evaluate --users 300 --days 14 120 --seed 3

Reports:
* effect recovery: error of each person's estimated habit effects vs the
  truth, compared with fitting each person alone (no pooling) and with one
  set of effects for everyone (complete pooling), by length of history;
* honesty: how often the 90% credible interval contains the true effect
  (should be about 90%), and how often a "confident" claim (P > 0.9 or < 0.1)
  has the right sign -- the claims users would actually be shown;
* forecasts: error of the morning forecast on each user's last days, vs
  "same as your average" and "same as yesterday", and whether the 80%
  intervals hold 80% of outcomes.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import timedelta
from typing import Sequence

import numpy as np

from .features import FEATURES, build_user, population_scale
from .model import complete_pooling, fit, forecast, no_pooling
from .simulate import SimUser, simulate

ACTIONABLE = [j for j, f in enumerate(FEATURES) if f.actionable]
Z90 = 1.6448536269514722


@dataclass
class Report:
    users: int
    effect_rmse: dict  # {"hierarchical": .., "noPooling": .., "completePooling": ..} overall
    effect_rmse_by_history: dict  # {"<30 days": {...}, ...}
    coverage90: float
    confident_share: float  # share of habit effects the model is confident about
    confident_sign_accuracy: float
    personal_share: float  # share of habit effects we'd describe as "for you"
    personal_sign_accuracy: float
    forecast_rmse: dict  # {"model": .., "userAverage": .., "yesterday": ..}
    forecast_coverage80: float
    forecast_n: int

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _bucket(n: int) -> str:
    return "<30 days" if n < 30 else "30-59 days" if n < 60 else "60+ days"


def run(sims: Sequence[SimUser], holdout_days: int = 7) -> Report:
    # Split: the last `holdout_days` calendar days of each user are for forecasting only
    train_rows, test_days = {}, {}
    for s in sims:
        last = max(r["date"] for r in s.rows)
        cut = last - timedelta(days=holdout_days)
        train_rows[s.id] = [r for r in s.rows if r["date"] <= cut]
        test_days[s.id] = [r for r in s.rows if r["date"] > cut]

    users = {uid: build_user(rows) for uid, rows in train_rows.items()}
    result = fit(users)
    pop = result.population
    scale = population_scale(list(users.values()))
    nop = no_pooling(users, scale)
    cp = complete_pooling(users, scale)

    sq = {"hierarchical": [], "noPooling": [], "completePooling": []}
    by_hist: dict[str, dict[str, list]] = {}
    covered = total = confident = right = personal = personal_right = 0
    for s in sims:
        post = result.users.get(s.id)
        if post is None:
            continue
        b = _bucket(post.n)
        by_hist.setdefault(b, {k: [] for k in sq})
        for j in ACTIONABLE:
            truth = s.true_effects[FEATURES[j].name]
            mean, sd, p_pos = post.effect(pop, j)
            errs = {
                "hierarchical": mean - truth,
                "noPooling": nop[s.id][j] / pop.scale[j] - truth,
                "completePooling": cp[j] / pop.scale[j] - truth,
            }
            for k, e in errs.items():
                sq[k].append(e * e)
                by_hist[b][k].append(e * e)
            total += 1
            covered += abs(mean - truth) <= Z90 * sd
            if p_pos > 0.9 or p_pos < 0.1:
                confident += 1
                right += (p_pos > 0.9) == (truth > 0)
            if post.claim(pop, j) == "personal":
                personal += 1
                personal_right += (p_pos > 0.5) == (truth > 0)

    rmse = lambda v: float(np.sqrt(np.mean(v))) if v else float("nan")

    # Forecasts on held-out days
    f_err, avg_err, yday_err, inside = [], [], [], 0
    for s in sims:
        post = result.users.get(s.id)
        if post is None:
            continue
        by_date = {r["date"]: r for r in s.rows}
        for r in test_days[s.id]:
            if r["moodValue"] is None:
                continue
            d = r["date"]
            yday = by_date.get(d - timedelta(days=1))
            # Only what's known that morning: today's sleep, yesterday's row
            today_known = {"date": d, "sleepMinutes": r["sleepMinutes"]}
            fc = forecast(pop, post, today_known, yday, d)
            if fc is None:
                continue
            y = r["moodValue"]
            f_err.append((fc.mean - y) ** 2)
            avg_err.append((post.data.y_mean - y) ** 2)
            prev = yday["moodValue"] if yday and yday["moodValue"] is not None else post.data.y_mean
            yday_err.append((prev - y) ** 2)
            inside += fc.lower <= y <= fc.upper

    return Report(
        users=len(result.users),
        effect_rmse={k: rmse(v) for k, v in sq.items()},
        effect_rmse_by_history={b: {k: rmse(v) for k, v in d.items()} | {"effects": len(d["hierarchical"])} for b, d in sorted(by_hist.items())},
        coverage90=covered / total if total else float("nan"),
        confident_share=confident / total if total else float("nan"),
        confident_sign_accuracy=right / confident if confident else float("nan"),
        personal_share=personal / total if total else float("nan"),
        personal_sign_accuracy=personal_right / personal if personal else float("nan"),
        forecast_rmse={"model": rmse(f_err), "userAverage": rmse(avg_err), "yesterday": rmse(yday_err)},
        forecast_coverage80=inside / len(f_err) if f_err else float("nan"),
        forecast_n=len(f_err),
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--users", type=int, default=200)
    ap.add_argument("--days", type=int, nargs=2, default=(14, 120), metavar=("MIN", "MAX"))
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    a = ap.parse_args()

    rep = run(simulate(a.users, (a.days[0], a.days[1]), seed=a.seed))
    if a.json:
        print(json.dumps(rep.as_dict(), indent=2))
        return
    print(f"Simulated users: {rep.users}  (history {a.days[0]}-{a.days[1]} days, seed {a.seed})\n")
    print("Habit-effect error (RMSE, mood points per unit; lower is better)")
    print(f"  {'':12}{'hierarchical':>14}{'each alone':>12}{'one for all':>13}")
    for b, d in rep.effect_rmse_by_history.items():
        print(f"  {b:12}{d['hierarchical']:14.3f}{d['noPooling']:12.3f}{d['completePooling']:13.3f}")
    e = rep.effect_rmse
    print(f"  {'all':12}{e['hierarchical']:14.3f}{e['noPooling']:12.3f}{e['completePooling']:13.3f}\n")
    print(f"90% intervals containing the true effect: {rep.coverage90:.1%}  (target ~90%)")
    print(f"Confident (P>0.9 or <0.1): {rep.confident_share:.1%} of effects, right sign {rep.confident_sign_accuracy:.1%}")
    print(f"Shown to users as \"for you\": {rep.personal_share:.1%} of effects, right sign {rep.personal_sign_accuracy:.1%}\n")
    f = rep.forecast_rmse
    print(f"Morning mood forecast, last 7 days ({rep.forecast_n} days):")
    print(f"  RMSE model {f['model']:.3f}   vs your average {f['userAverage']:.3f}   vs same as yesterday {f['yesterday']:.3f}")
    print(f"  80% intervals containing the actual mood: {rep.forecast_coverage80:.1%}  (target ~80%)")


if __name__ == "__main__":
    main()
