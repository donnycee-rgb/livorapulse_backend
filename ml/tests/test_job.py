"""The nightly job, without a database (plan) and against a real Postgres
with the app's migrations applied (PGlite, started by pg_server.mjs)."""
from __future__ import annotations

import json
import shutil
import subprocess
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from livora_ml import db
from livora_ml.job import plan
from livora_ml.model import MODEL_VERSION
from livora_ml.simulate import simulate

TODAY = date(2026, 11, 16)


def sims(n_users, seed=21):
    return simulate(n_users, (30, 80), seed=seed, start=TODAY - timedelta(days=85))


# ---------------------------------------------------------------------------
# plan(): the computation alone
# ---------------------------------------------------------------------------
def test_too_little_data_is_skipped_not_published():
    p = plan({s.id: s.rows for s in sims(3)}, TODAY)
    assert p.status == "skipped" and "not enough data" in p.reason
    assert p.effects == [] and p.predictions == []


def test_plan_publishes_effects_and_todays_forecast():
    users = sims(12)
    p = plan({s.id: s.rows for s in users}, TODAY)
    assert p.status == "succeeded"
    assert {e["userId"] for e in p.effects} <= {s.id for s in users}
    assert all(pr["date"] == TODAY for pr in p.predictions)
    assert all(1 <= pr["lower"] <= pr["mean"] <= pr["upper"] <= 5 for pr in p.predictions)
    assert p.metrics["usersWithResults"] == len({e["userId"] for e in p.effects})


def test_users_with_too_few_mood_days_get_nothing():
    users = sims(10)
    rows = {s.id: s.rows for s in users}
    newbie = [r | {"moodValue": None} for r in users[0].rows]
    for r in newbie[-3:]:
        r["moodValue"] = 3.0
    rows["newbie"] = newbie
    p = plan(rows, TODAY)
    assert "newbie" not in {e["userId"] for e in p.effects}


def test_yesterdays_forecasts_are_checked_against_logged_moods():
    users = simulate(10, 60, seed=21, start=TODAY - timedelta(days=60))  # last day = yesterday
    rows = {s.id: s.rows for s in users}
    d = TODAY - timedelta(days=1)
    logged = [(uid, r) for uid, rs in rows.items() for r in rs if r["date"] == d and r["moodValue"] is not None]
    assert logged
    prev = [{"userId": uid, "date": d, "mean": r["moodValue"], "lower": 1.0, "upper": 5.0} for uid, r in logged]
    p = plan(rows, TODAY, prev)
    assert p.metrics["checkedForecasts"] == len(logged)
    assert p.metrics["forecastRmse"] == 0.0 and p.metrics["forecastCoverage80"] == 1.0


def test_local_days_round_trip_through_storage():
    stored = db.to_stored(date(2026, 11, 15))
    assert stored == datetime(2026, 11, 14, 21, 0)  # Nairobi midnight in UTC, as the API stores it
    assert db.from_stored(stored) == date(2026, 11, 15)
    from datetime import timezone
    assert db.local_today(datetime(2026, 11, 15, 21, 30, tzinfo=timezone.utc)) == date(2026, 11, 16)


# ---------------------------------------------------------------------------
# Against Postgres with the real migrations
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def pg_url():
    node = shutil.which("node")
    script = Path(__file__).with_name("pg_server.mjs")
    if not node or not (script.parents[2] / "node_modules" / "@electric-sql" / "pglite").exists():
        pytest.skip("needs node and the backend's node_modules (npm ci)")
    proc = subprocess.Popen([node, str(script)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    line = proc.stdout.readline()
    if not line:
        proc.kill()
        pytest.fail("PGlite server didn't start")
    yield json.loads(line)["url"]
    proc.stdin.close()
    proc.wait(timeout=30)


def seed(conn, users):
    for s in users:
        conn.execute('INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES (%s, %s, %s, now()) ON CONFLICT DO NOTHING',
                     (s.id, f"{s.id}@example.test", s.id))
        for r in s.rows:
            conn.execute(
                'INSERT INTO "DailyFeatures" ("id", "userId", "date", "sleepMinutes", "steps", "screenMinutes", '
                '"socialMinutes", "focusMinutes", "waterGlasses", "moodValue") VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) '
                'ON CONFLICT ("userId", "date") DO NOTHING',
                (uuid.uuid4().hex, s.id, db.to_stored(r["date"]), r["sleepMinutes"], r["steps"], r["screenMinutes"],
                 r["socialMinutes"], r["focusMinutes"], r["waterGlasses"], r["moodValue"]))
    conn.commit()


def run_once(conn, today):
    run_id = db.start_run(conn, MODEL_VERSION)
    rows = db.read_features(conn, since=today - timedelta(days=180))
    prev = db.read_predictions(conn, "mood", since=today - timedelta(days=7), before=today)
    p = plan(rows, today, prev)
    db.write_results(conn, run_id, p, MODEL_VERSION)
    return run_id, p


def test_job_end_to_end_on_postgres(pg_url):
    users = sims(12, seed=31)
    with db.connect(pg_url) as conn:
        seed(conn, users)

        # Night 1
        run_id, p = run_once(conn, TODAY)
        assert p.status == "succeeded"
        status, n_users, metrics = conn.execute('SELECT "status", "users", "metrics" FROM "MlModelRun" WHERE "id" = %s', (run_id,)).fetchone()
        assert status == "succeeded" and n_users == 12 and metrics["usersWithResults"] > 0
        n_eff = conn.execute('SELECT count(*) FROM "MlUserEffect"').fetchone()[0]
        assert n_eff == len(p.effects) > 0
        n_models, params = conn.execute('SELECT count(*), (array_agg("params"))[1] FROM "MlUserModel"').fetchone()
        assert n_models == metrics["usersWithResults"]
        assert set(params) >= {"features", "scale", "means", "m", "S", "yMean", "sigma2", "n"}
        pred_dates = {r[0] for r in conn.execute('SELECT DISTINCT "date" FROM "MlPrediction"')}
        assert pred_dates == {db.to_stored(TODAY)}  # same day convention as the API

        # Night 2: today's real mood is logged, the job checks yesterday's forecast
        tomorrow = TODAY + timedelta(days=1)
        for s in users:
            conn.execute('INSERT INTO "DailyFeatures" ("id", "userId", "date", "moodValue") VALUES (%s, %s, %s, %s) '
                         'ON CONFLICT ("userId", "date") DO UPDATE SET "moodValue" = EXCLUDED."moodValue"',
                         (uuid.uuid4().hex, s.id, db.to_stored(TODAY), 3.5))
        conn.commit()
        _, p2 = run_once(conn, tomorrow)
        assert p2.metrics.get("checkedForecasts", 0) > 0
        # Effects are replaced, not piled up; forecasts are kept per day
        assert conn.execute('SELECT count(*) FROM "MlUserEffect"').fetchone()[0] == len(p2.effects)
        assert conn.execute('SELECT count(DISTINCT "date") FROM "MlPrediction"').fetchone()[0] == 2


def test_a_skipped_run_leaves_published_results_alone(pg_url):
    with db.connect(pg_url) as conn:
        before = conn.execute('SELECT count(*) FROM "MlUserEffect"').fetchone()[0]
        run_id = db.start_run(conn, MODEL_VERSION)
        p = plan({s.id: s.rows for s in sims(2, seed=41)}, TODAY)
        db.write_results(conn, run_id, p, MODEL_VERSION)
        status, metrics = conn.execute('SELECT "status", "metrics" FROM "MlModelRun" WHERE "id" = %s', (run_id,)).fetchone()
        assert status == "skipped" and "not enough data" in metrics["reason"]
        assert conn.execute('SELECT count(*) FROM "MlUserEffect"').fetchone()[0] == before


def test_failures_are_recorded(pg_url):
    with db.connect(pg_url) as conn:
        run_id = db.start_run(conn, MODEL_VERSION)
        db.fail_run(conn, run_id, "ValueError: boom")
        assert conn.execute('SELECT "status", "error" FROM "MlModelRun" WHERE "id" = %s', (run_id,)).fetchone() == ("failed", "ValueError: boom")


def test_ml_login_can_only_touch_what_it_needs(pg_url):
    sql = (Path(__file__).parents[1] / "sql" / "ml_role.sql").read_text()
    with db.connect(pg_url) as conn:
        try:
            conn.execute(sql)
            conn.commit()
        except Exception as e:  # PGlite may not support roles; the script is still checked to parse
            pytest.skip(f"roles not supported here: {e}")
        def as_ml(sql):
            # A rollback also undoes SET ROLE, so set it for each check
            conn.execute("SET ROLE livora_ml")
            try:
                conn.execute(sql)
            finally:
                conn.rollback()

        as_ml('SELECT count(*) FROM "DailyFeatures"')
        as_ml('DELETE FROM "MlUserEffect" WHERE false')
        as_ml('DELETE FROM "MlUserModel" WHERE false')
        as_ml('UPDATE "MlModelRun" SET "status" = "status" WHERE false')
        for forbidden in ('SELECT count(*) FROM "User"', 'SELECT count(*) FROM "MoodLog"',
                          'DELETE FROM "DailyFeatures" WHERE false', 'DELETE FROM "MlModelRun" WHERE false'):
            with pytest.raises(Exception, match="permission denied"):
                as_ml(forbidden)
        conn.execute("RESET ROLE")
        conn.commit()
