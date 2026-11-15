"""From DailyFeatures rows to model inputs.

The model answers one question each morning: "how is today likely to go?"
The outcome is the day's mood (moodValue, 1-5). Inputs are only things known
by that morning:

* last night's sleep (DailyFeatures.sleepMinutes is the night that ended on
  the morning of that day), and
* yesterday's habits and yesterday's mood.

Each input is compared with the user's OWN average ("within-person"). That
separates "this person is generally happier" from "this person feels better on
days they sleep more", which is the effect we want to report. A missing value
becomes the user's average, so it adds no information either way.
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable, Iterable, Mapping, Optional, Sequence

import numpy as np

Row = Mapping[str, object]  # one DailyFeatures row: {"date": date, "sleepMinutes": 420, ...}


def _num(row: Optional[Row], key: str) -> Optional[float]:
    if row is None:
        return None
    v = row.get(key)
    return None if v is None else float(v)  # type: ignore[arg-type]


@dataclass(frozen=True)
class Feature:
    name: str
    unit: str  # what one step of the feature means, shown to users
    actionable: bool  # a habit the user can change (vs. a control like weekends)
    read: Callable[[Optional[Row], Optional[Row], date], Optional[float]]  # (today, yesterday, today's date)


FEATURES: tuple[Feature, ...] = (
    Feature("sleepHours", "1 hour of sleep", True,
            lambda today, yday, d: None if _num(today, "sleepMinutes") is None else _num(today, "sleepMinutes") / 60),
    Feature("stepsK", "1,000 steps the day before", True,
            lambda today, yday, d: None if _num(yday, "steps") is None else _num(yday, "steps") / 1000),
    Feature("screenHours", "1 hour of screen time the day before", True,
            lambda today, yday, d: None if _num(yday, "screenMinutes") is None else _num(yday, "screenMinutes") / 60),
    Feature("socialHours", "1 hour of social media the day before", True,
            lambda today, yday, d: None if _num(yday, "socialMinutes") is None else _num(yday, "socialMinutes") / 60),
    Feature("focusHours", "1 hour of focused work the day before", True,
            lambda today, yday, d: None if _num(yday, "focusMinutes") is None else _num(yday, "focusMinutes") / 60),
    Feature("waterGlasses", "1 glass of water the day before", True,
            lambda today, yday, d: _num(yday, "waterGlasses")),
    # Controls: improve the forecast and keep the habit effects honest, but
    # aren't advice ("be in a better mood yesterday" isn't actionable).
    Feature("moodYesterday", "1 point of mood the day before", False,
            lambda today, yday, d: _num(yday, "moodValue")),
    Feature("weekend", "a weekend day", False,
            lambda today, yday, d: 1.0 if d.weekday() >= 5 else 0.0),
)

FEATURE_NAMES = tuple(f.name for f in FEATURES)
P = len(FEATURES)
OUTCOME = "moodValue"


@dataclass
class UserData:
    """One user's days, ready for the model."""
    dates: list[date]  # days with an observed outcome
    raw: np.ndarray  # (n, P) inputs in natural units, NaN = missing
    y: np.ndarray  # (n,) outcome
    means: np.ndarray  # (P,) the user's own average of each input (NaN if never seen)
    y_mean: float

    @property
    def n(self) -> int:
        return len(self.y)


def _as_date(v: object) -> date:
    if isinstance(v, date):
        return v if type(v) is date else v.date()  # datetime -> date
    raise TypeError(f"expected a date, got {v!r}")


def row_inputs(today: Optional[Row], yday: Optional[Row], d: date) -> np.ndarray:
    out = np.full(P, np.nan)
    for j, f in enumerate(FEATURES):
        v = f.read(today, yday, d)
        if v is not None:
            out[j] = v
    return out


def build_user(rows: Iterable[Row]) -> UserData:
    """Turn one user's DailyFeatures rows into model inputs.

    "Yesterday" must be the calendar day before: after a gap in logging, the
    day-before inputs are missing rather than taken from an older day.
    """
    by_date = {_as_date(r["date"]): r for r in rows}
    dates, raws, ys = [], [], []
    for d in sorted(by_date):
        today = by_date[d]
        y = _num(today, OUTCOME)
        if y is None:
            continue
        x = row_inputs(today, by_date.get(d - timedelta(days=1)), d)
        dates.append(d)
        raws.append(x)
        ys.append(y)

    raw = np.array(raws, dtype=float).reshape(-1, P)
    y = np.array(ys, dtype=float)
    with warnings.catch_warnings():  # an input never logged -> mean NaN, expected
        warnings.simplefilter("ignore", RuntimeWarning)
        means = np.nanmean(raw, axis=0) if len(raw) else np.full(P, np.nan)
    y_mean = float(y.mean()) if len(y) else float("nan")
    return UserData(dates=dates, raw=raw, y=y, means=means, y_mean=y_mean)


def centred(raw: np.ndarray, means: np.ndarray, scale: np.ndarray) -> np.ndarray:
    """Within-person, standardised inputs: (x - user mean) / population scale; missing -> 0."""
    x = (raw - means) / scale
    return np.where(np.isfinite(x), x, 0.0)


def population_scale(users: Sequence[UserData]) -> np.ndarray:
    """Typical within-person spread of each input across all users (for standardising)."""
    devs = [u.raw - u.means for u in users if u.n]
    if not devs:
        return np.ones(P)
    d = np.vstack(devs)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        s = np.nanstd(d, axis=0)
    return np.where(np.isfinite(s) & (s > 1e-9), s, 1.0)
