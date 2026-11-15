"""Reading DailyFeatures and writing results (psycopg).

Dates: the API stores a local (Nairobi) calendar day as the UTC instant of its
local midnight in a `timestamp without time zone` column, e.g. 15 Nov is
2026-11-14 21:00:00 (src/utils/day.ts). These helpers convert both ways so the
model only ever sees plain calendar dates.

The job connects as a role that can read DailyFeatures and write only the ML
tables (sql/ml_role.sql).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timezone
from typing import TYPE_CHECKING, Iterator, Mapping, Optional, Sequence
from contextlib import contextmanager
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb

if TYPE_CHECKING:
    from .job import Plan

APP_TZ = ZoneInfo("Africa/Nairobi")
FEATURE_COLUMNS = ("sleepMinutes", "steps", "screenMinutes", "socialMinutes", "focusMinutes", "waterGlasses", "moodValue")


def local_today(now: Optional[datetime] = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(APP_TZ).date()


def to_stored(d: date) -> datetime:
    """Local calendar day -> naive UTC instant of its local midnight (how the API stores days)."""
    return datetime.combine(d, time(0), tzinfo=APP_TZ).astimezone(timezone.utc).replace(tzinfo=None)


def from_stored(ts: datetime) -> date:
    """Stored naive-UTC day start -> local calendar day."""
    return ts.replace(tzinfo=timezone.utc).astimezone(APP_TZ).date()


def _id() -> str:
    return "ml" + uuid.uuid4().hex[:23]  # 25 chars, like Prisma's cuid ids


@contextmanager
def connect(url: str) -> Iterator[psycopg.Connection]:
    # No prepared statements: works through connection poolers (and PGlite in tests)
    with psycopg.connect(url, prepare_threshold=None, autocommit=False) as conn:
        yield conn


def start_run(conn: psycopg.Connection, model_version: str) -> str:
    run_id = _id()
    conn.execute('INSERT INTO "MlModelRun" ("id", "modelVersion", "status") VALUES (%s, %s, %s)',
                 (run_id, model_version, "running"))
    conn.commit()  # visible even if the rest fails
    return run_id


def fail_run(conn: psycopg.Connection, run_id: str, error: str) -> None:
    conn.execute('UPDATE "MlModelRun" SET "status" = %s, "error" = %s, "finishedAt" = %s WHERE "id" = %s',
                 ("failed", error[:2000], datetime.now(timezone.utc).replace(tzinfo=None), run_id))
    conn.commit()


def read_features(conn: psycopg.Connection, since: date) -> dict[str, list[dict]]:
    cols = ", ".join(f'"{c}"' for c in FEATURE_COLUMNS)
    cur = conn.execute(f'SELECT "userId", "date", {cols} FROM "DailyFeatures" WHERE "date" >= %s ORDER BY "userId", "date"',
                       (to_stored(since),))
    out: dict[str, list[dict]] = defaultdict(list)
    for rec in cur:
        uid, ts, *vals = rec
        out[uid].append({"date": from_stored(ts), **dict(zip(FEATURE_COLUMNS, vals))})
    return dict(out)


def read_predictions(conn: psycopg.Connection, outcome: str, since: date, before: date) -> list[dict]:
    cur = conn.execute('SELECT "userId", "date", "mean", "lower", "upper" FROM "MlPrediction" '
                       'WHERE "outcome" = %s AND "date" >= %s AND "date" < %s',
                       (outcome, to_stored(since), to_stored(before)))
    return [{"userId": u, "date": from_stored(d), "mean": m, "lower": lo, "upper": hi} for u, d, m, lo, hi in cur]


def write_results(conn: psycopg.Connection, run_id: str, plan: "Plan", model_version: str) -> None:
    """Publish a run's results in one transaction, so the API never sees half of them."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if plan.status == "succeeded":
        outcomes = {e["outcome"] for e in plan.effects} or {"mood"}
        for oc in outcomes:
            # Replace, not merge: users who no longer have enough data lose stale effects
            conn.execute('DELETE FROM "MlUserEffect" WHERE "outcome" = %s', (oc,))
            conn.execute('DELETE FROM "MlUserModel" WHERE "outcome" = %s', (oc,))
        with conn.cursor() as cur:
            cur.executemany(
                'INSERT INTO "MlUserEffect" ("id", "userId", "outcome", "feature", "unit", "mean", "sd", "probPositive", '
                '"ownShare", "claim", "nDays", "modelVersion", "updatedAt") '
                'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                [(_id(), e["userId"], e["outcome"], e["feature"], e["unit"], e["mean"], e["sd"], e["probPositive"],
                  e["ownShare"], e["claim"], e["nDays"], model_version, now) for e in plan.effects])
            cur.executemany(
                'INSERT INTO "MlUserModel" ("id", "userId", "outcome", "params", "nDays", "modelVersion", "updatedAt") '
                'VALUES (%s, %s, %s, %s, %s, %s, %s)',
                [(_id(), mo["userId"], mo["outcome"], Jsonb(mo["params"]), mo["nDays"], model_version, now)
                 for mo in plan.models])
            cur.executemany(
                'INSERT INTO "MlPrediction" ("id", "userId", "date", "outcome", "mean", "lower", "upper", "nDays", "modelVersion") '
                'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) '
                'ON CONFLICT ("userId", "date", "outcome") DO UPDATE SET '
                '"mean" = EXCLUDED."mean", "lower" = EXCLUDED."lower", "upper" = EXCLUDED."upper", '
                '"nDays" = EXCLUDED."nDays", "modelVersion" = EXCLUDED."modelVersion", "createdAt" = CURRENT_TIMESTAMP',
                [(_id(), p["userId"], to_stored(p["date"]), p["outcome"], p["mean"], p["lower"], p["upper"], p["nDays"],
                  model_version) for p in plan.predictions])
    metrics = dict(plan.metrics)
    if plan.reason:
        metrics["reason"] = plan.reason
    conn.execute('UPDATE "MlModelRun" SET "status" = %s, "finishedAt" = %s, "users" = %s, "rows" = %s, '
                 '"population" = %s, "metrics" = %s WHERE "id" = %s',
                 (plan.status, now, plan.users, plan.rows,
                  Jsonb(plan.population) if plan.population is not None else None, Jsonb(metrics), run_id))
    conn.commit()
