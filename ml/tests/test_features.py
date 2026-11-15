from datetime import date

import numpy as np

from livora_ml.features import FEATURE_NAMES, build_user, centred, population_scale

J = {name: i for i, name in enumerate(FEATURE_NAMES)}


def row(d, **kw):
    base = {"date": d, "sleepMinutes": None, "steps": None, "screenMinutes": None, "socialMinutes": None,
            "focusMinutes": None, "waterGlasses": None, "moodValue": None}
    return base | kw


def test_inputs_use_last_night_and_yesterday_in_natural_units():
    u = build_user([
        row(date(2026, 3, 2), steps=8000, screenMinutes=180, moodValue=3.0),
        row(date(2026, 3, 3), sleepMinutes=450, moodValue=4.0),
    ])
    assert u.dates == [date(2026, 3, 2), date(2026, 3, 3)]
    x = u.raw[1]
    assert x[J["sleepHours"]] == 7.5          # today's row = last night
    assert x[J["stepsK"]] == 8.0              # yesterday's steps
    assert x[J["screenHours"]] == 3.0
    assert x[J["moodYesterday"]] == 3.0
    assert np.isnan(x[J["waterGlasses"]])     # never logged -> missing, not zero


def test_a_gap_in_logging_never_borrows_an_older_day():
    u = build_user([
        row(date(2026, 3, 1), steps=12000, moodValue=3.0),
        row(date(2026, 3, 3), moodValue=4.0),  # 2 March missing
    ])
    assert np.isnan(u.raw[1][J["stepsK"]])
    assert np.isnan(u.raw[1][J["moodYesterday"]])


def test_days_without_mood_are_not_training_rows_but_still_feed_the_next_day():
    u = build_user([
        row(date(2026, 3, 6), steps=4000),               # no mood: not a row
        row(date(2026, 3, 7), moodValue=2.5),             # Saturday
    ])
    assert u.n == 1
    assert u.raw[0][J["stepsK"]] == 4.0
    assert u.raw[0][J["weekend"]] == 1.0


def test_missing_values_sit_at_the_users_own_average():
    u = build_user([row(date(2026, 3, d), sleepMinutes=s, moodValue=3.0)
                    for d, s in ((2, 360), (3, 480), (4, None))])
    x = centred(u.raw, u.means, population_scale([u]))
    assert x[2][J["sleepHours"]] == 0.0
    assert x[0][J["sleepHours"]] < 0 < x[1][J["sleepHours"]]


def test_accepts_datetimes_from_the_database():
    from datetime import datetime
    u = build_user([row(datetime(2026, 3, 3, 0, 0), sleepMinutes=420, moodValue=3.5)])
    assert u.dates == [date(2026, 3, 3)]
