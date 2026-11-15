import json
from datetime import date, timedelta

import numpy as np

from livora_ml.features import build_user
from livora_ml.model import fit, forecast, forecast_from_params, user_params
from livora_ml.parity import FIXTURE, build
from livora_ml.simulate import simulate


def test_saved_params_forecast_exactly_like_the_model():
    sims = simulate(25, 50, seed=3)
    result = fit({s.id: build_user(s.rows) for s in sims})
    for s in sims[:5]:
        post = result.users[s.id]
        params = json.loads(json.dumps(user_params(result.population, post)))  # through JSON, as stored
        last = max(r["date"] for r in s.rows)
        d = last + timedelta(days=1)
        yday = next(r for r in s.rows if r["date"] == last)
        for today in ({"sleepMinutes": 400}, None):
            a = forecast(result.population, post, today, yday, d)
            b = forecast_from_params(params, today, yday, d)
            np.testing.assert_allclose([a.mean, a.lower, a.upper], [b.mean, b.lower, b.upper], rtol=1e-12)


def test_parity_fixture_is_up_to_date():
    # If this fails, the Python forecast changed: run `python -m livora_ml.parity`
    # and make the same change in src/services/MoodForecast.ts.
    saved = json.loads(FIXTURE.read_text(encoding="utf-8"))
    fresh = json.loads(json.dumps(build()))
    assert len(saved["cases"]) == len(fresh["cases"])
    for a, b in zip(saved["cases"], fresh["cases"]):
        assert a["name"] == b["name"]
        for k in ("mean", "lower", "upper"):
            assert abs(a["expected"][k] - b["expected"][k]) < 1e-9


def test_sleep_moves_the_forecast_the_way_the_model_says():
    saved = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for user in {c["name"].split(":")[0] for c in saved["cases"] if ":" in c["name"]}:
        logged = next(c for c in saved["cases"] if c["name"] == f"{user}: last night's sleep logged")
        short = next(c for c in saved["cases"] if c["name"] == f"{user}: short night")
        sleep_effect = logged["params"]["m"][0]  # standardised sleep effect
        assert (logged["expected"]["mean"] - short["expected"]["mean"]) * sleep_effect >= 0
