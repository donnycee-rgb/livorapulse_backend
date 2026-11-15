"""Synthetic users with known "true" habit effects.

The real database is new and small, so the model is developed and checked
here first: simulate people whose effects we know, fit the model, and see how
close it gets. Rows have the same fields as DailyFeatures, so the whole
pipeline (features -> model -> outputs) is exercised.

Each person has their own effects (drawn around a population average), their
own typical habits, and their own logging habits (some log mood most days,
some rarely; some never log water). Mood is a 1-5 value like moodValue.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from .features import FEATURES

# Typical effect on mood (natural units) and how much people differ.
TRUE_POPULATION: dict[str, tuple[float, float]] = {
    "sleepHours": (0.22, 0.12),     # +0.22 mood per extra hour of sleep
    "stepsK": (0.03, 0.025),        # per 1,000 steps the day before
    "screenHours": (-0.06, 0.05),   # per hour of screen time
    "socialHours": (-0.10, 0.07),   # per hour of social media
    "focusHours": (0.05, 0.05),     # per hour of focus
    "waterGlasses": (0.015, 0.015), # per glass of water
    "moodYesterday": (0.30, 0.10),  # mood carries over
    "weekend": (0.15, 0.10),
}


@dataclass
class SimUser:
    id: str
    rows: list[dict]
    true_effects: dict[str, float]  # natural units, same names as FEATURES


def _clip(v: float, lo: float, hi: float) -> float:
    return float(min(hi, max(lo, v)))


def simulate_user(rng: np.random.Generator, uid: str, n_days: int, start: date,
                  population: dict[str, tuple[float, float]] = TRUE_POPULATION) -> SimUser:
    eff = {name: float(rng.normal(m, s)) for name, (m, s) in population.items()}

    # Personal habits
    sleep_mu, sleep_sd = rng.normal(7.0, 0.7), abs(rng.normal(0.9, 0.25))
    steps_mu = rng.lognormal(np.log(5500), 0.4)
    screen_mu = rng.normal(4.0, 1.0)
    social_share = rng.uniform(0.2, 0.6)
    focus_mu = abs(rng.normal(1.2, 0.6))
    water_mu = rng.normal(5.0, 1.5)
    base_mood = _clip(rng.normal(3.3, 0.45), 1.8, 4.6)
    noise_sd = abs(rng.normal(0.45, 0.1))

    # Personal logging habits: probability each thing is logged on a day
    p_log = {
        "mood": rng.uniform(0.45, 0.95),
        "sleep": rng.uniform(0.3, 0.95),
        "steps": rng.uniform(0.2, 0.9),
        "screen": rng.uniform(0.2, 0.9),
        "focus": rng.uniform(0.1, 0.8),
        "water": rng.choice([0.0, rng.uniform(0.3, 0.9)]),
    }

    # Habits each day (true values exist even when not logged)
    days = [start + timedelta(days=i) for i in range(n_days)]
    sleep = np.clip(rng.normal(sleep_mu, sleep_sd, n_days), 3.5, 11)
    steps = np.clip(rng.normal(steps_mu, steps_mu * 0.35, n_days), 300, 25000)
    screen = np.clip(rng.normal(screen_mu, 1.2, n_days), 0.3, 12)
    social = screen * np.clip(rng.normal(social_share, 0.1, n_days), 0.05, 0.9)
    focus = np.clip(rng.normal(focus_mu, 0.7, n_days), 0, 6)
    water = np.clip(np.round(rng.normal(water_mu, 1.5, n_days)), 0, 12)

    # Effects act on deviations from the person's own typical day
    dev = {
        "sleepHours": sleep - sleep_mu,
        "stepsK": (steps - steps_mu) / 1000,
        "screenHours": screen - screen_mu,
        "socialHours": social - social_share * screen_mu,
        "focusHours": focus - focus_mu,
        "waterGlasses": water - water_mu,
    }

    mood = np.zeros(n_days)
    for t, d in enumerate(days):
        m = base_mood + eff["sleepHours"] * dev["sleepHours"][t]
        if t > 0:
            for name in ("stepsK", "screenHours", "socialHours", "focusHours", "waterGlasses"):
                m += eff[name] * dev[name][t - 1]
            m += eff["moodYesterday"] * (mood[t - 1] - base_mood)
        if d.weekday() >= 5:
            m += eff["weekend"]
        mood[t] = _clip(m + rng.normal(0, noise_sd), 1.0, 5.0)

    rows = []
    for t, d in enumerate(days):
        logged = lambda key: rng.random() < p_log[key]
        rows.append({
            "date": d,
            "sleepMinutes": int(round(sleep[t] * 60)) if logged("sleep") else None,
            "steps": int(round(steps[t])) if logged("steps") else None,
            "screenMinutes": int(round(screen[t] * 60)) if logged("screen") else None,
            "socialMinutes": int(round(social[t] * 60)) if logged("screen") else None,
            "focusMinutes": int(round(focus[t] * 60)) if logged("focus") else None,
            "waterGlasses": int(water[t]) if logged("water") else None,
            "moodValue": round(float(mood[t]), 2) if logged("mood") else None,
        })
    # Only the inputs the model uses are reported as "true"
    names = {f.name for f in FEATURES}
    return SimUser(id=uid, rows=rows, true_effects={k: v for k, v in eff.items() if k in names})


def simulate(n_users: int, n_days: int | tuple[int, int], seed: int = 0,
             start: date = date(2026, 1, 5)) -> list[SimUser]:
    """n_days: a fixed length, or (min, max) to give users different history lengths."""
    rng = np.random.default_rng(seed)
    users = []
    for i in range(n_users):
        n = n_days if isinstance(n_days, int) else int(rng.integers(n_days[0], n_days[1] + 1))
        users.append(simulate_user(rng, f"sim-{i:04d}", n, start))
    return users
