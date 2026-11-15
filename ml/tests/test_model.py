"""The model on simulated users whose true effects are known.

These are the guarantees the app relies on; if a change breaks one, the
change is wrong (or the bar should be moved on purpose, with a reason).
"""
from datetime import date

import numpy as np
import pytest

from livora_ml.evaluate import run
from livora_ml.features import FEATURE_NAMES, build_user
from livora_ml.model import effects_table, fit, forecast, prior_posterior
from livora_ml.simulate import simulate


@pytest.fixture(scope="module")
def report():
    return run(simulate(200, (14, 120), seed=1))


def test_pooling_beats_fitting_each_person_alone(report):
    by = report.effect_rmse_by_history
    assert by["<30 days"]["hierarchical"] < by["<30 days"]["noPooling"] / 5  # new users: far better
    assert report.effect_rmse["hierarchical"] < report.effect_rmse["noPooling"]
    assert report.effect_rmse["hierarchical"] < report.effect_rmse["completePooling"]  # and people do differ


def test_for_you_claims_are_almost_never_the_wrong_way_round(report):
    assert report.personal_share > 0.02  # it does say something
    assert report.personal_sign_accuracy >= 0.95


def test_uncertainty_is_roughly_honest(report):
    assert 0.78 <= report.coverage90 <= 0.97
    assert 0.72 <= report.forecast_coverage80 <= 0.9


def test_morning_forecast_beats_simple_guesses(report):
    f = report.forecast_rmse
    assert f["model"] < f["userAverage"]
    assert f["model"] < f["yesterday"]


def test_new_user_starts_from_what_is_typical():
    sims = simulate(80, 60, seed=4)
    result = fit({s.id: build_user(s.rows) for s in sims})
    post = prior_posterior(result.population)
    assert post.n == 0
    np.testing.assert_allclose(post.m, result.population.mu)
    assert forecast(result.population, post, None, None, date(2026, 3, 3)) is None  # no mood history yet
    assert all(e["claim"] != "personal" for e in effects_table(result.population, post))


def test_effects_table_has_only_habits_and_natural_units():
    sims = simulate(60, 60, seed=5)
    result = fit({s.id: build_user(s.rows) for s in sims})
    post = next(iter(result.users.values()))
    rows = effects_table(result.population, post)
    names = [r["feature"] for r in rows]
    assert "moodYesterday" not in names and "weekend" not in names
    assert set(names) <= set(FEATURE_NAMES)
    for r in rows:
        assert r["sd"] > 0 and 0 <= r["probPositive"] <= 1 and 0 <= r["ownShare"] <= 1
        assert r["claim"] in {"personal", "typical", "unclear"}


def test_forecast_stays_on_the_mood_scale():
    sims = simulate(40, 50, seed=6)
    result = fit({s.id: build_user(s.rows) for s in sims})
    s = sims[0]
    post = result.users[s.id]
    last = s.rows[-1]
    fc = forecast(result.population, post, {"date": last["date"], "sleepMinutes": 180}, s.rows[-2], last["date"])
    assert fc is not None and 1 <= fc.lower <= fc.mean <= fc.upper <= 5
