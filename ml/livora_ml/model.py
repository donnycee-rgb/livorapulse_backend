"""Hierarchical Bayesian linear regression for daily mood.

For user u on day t (inputs within-person centred and standardised, see
features.py):

    y_ut - ybar_u = x_ut . b_u + e_ut,      e_ut ~ N(0, sigma^2)
    b_u ~ N(mu, diag(tau^2))                (what's typical across users)

Given the population (mu, tau^2, sigma^2) each user's posterior is closed-form
(conjugate normal):

    Sigma_u = (diag(1/tau^2) + X'X / sigma^2)^-1
    m_u     = Sigma_u (mu / tau^2 + X'y / sigma^2)

A new user starts at the population average and moves toward their own
pattern as their days add up. The population itself is fitted by empirical
Bayes (EM): alternate the user posteriors above with

    mu    = mean_u m_u
    tau^2 = mean_u [(m_u - mu)^2 + diag(Sigma_u)]
    sigma^2 = sum_u [ |y_u - X_u m_u|^2 + tr(X_u' X_u Sigma_u) ] / (N - U)

(N - U: each user's own mean uses up one degree of freedom.)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from math import erf, sqrt
from typing import Mapping, Optional, Sequence

import numpy as np

from .features import FEATURES, P, UserData, centred, population_scale, row_inputs

MODEL_VERSION = "mood-hbr-1"
Z80 = 1.2815515655446004  # 80% two-sided interval
MOOD_MIN, MOOD_MAX = 1.0, 5.0

# When can we tell someone "for YOU, this habit helps"? Only when we're quite
# sure of the direction AND most of that certainty comes from their own days,
# not from what's typical. Checked on simulated users (python -m
# livora_ml.evaluate): these claims had the wrong sign about 1% of the time,
# vs 6-10% when the own-data rule is left out.
CLAIM_PROB = 0.95
CLAIM_OWN_SHARE = 0.5


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + erf(z / sqrt(2.0)))


@dataclass
class Population:
    mu: np.ndarray  # (P,) typical effect, standardised units
    tau2: np.ndarray  # (P,) how much people differ
    sigma2: float  # day-to-day noise
    scale: np.ndarray  # (P,) standardising spreads (natural units per 1 SD)
    iterations: int = 0
    converged: bool = False


@dataclass
class UserPosterior:
    m: np.ndarray  # (P,) posterior mean, standardised units
    S: np.ndarray  # (P, P) posterior covariance, standardised units
    n: int
    data: Optional[UserData] = None

    def effect(self, pop: Population, j: int) -> tuple[float, float, float]:
        """Effect of feature j in natural units: (mean, sd, P(effect > 0))."""
        mean = float(self.m[j] / pop.scale[j])
        sd = float(np.sqrt(self.S[j, j]) / pop.scale[j])
        p_pos = _normal_cdf(mean / sd) if sd > 0 else float(mean > 0)
        return mean, sd, p_pos

    def own_share(self, pop: Population, j: int) -> float:
        """How much of the certainty about feature j comes from this user's own
        days (0 = all from the population, 1 = all their own)."""
        return float(min(1.0, max(0.0, 1.0 - self.S[j, j] / pop.tau2[j])))

    def claim(self, pop: Population, j: int) -> str:
        """"personal": safe to say "for you"; "typical": only "for most people";
        "unclear": don't say anything."""
        _, _, p_pos = self.effect(pop, j)
        sure = p_pos >= CLAIM_PROB or p_pos <= 1 - CLAIM_PROB
        if sure and self.own_share(pop, j) >= CLAIM_OWN_SHARE:
            return "personal"
        typical = _normal_cdf(float(pop.mu[j] / np.sqrt(pop.tau2[j])))  # P(effect > 0) for a typical person
        if typical >= CLAIM_PROB or typical <= 1 - CLAIM_PROB:
            return "typical"
        return "unclear"


@dataclass
class FitResult:
    population: Population
    users: dict[str, UserPosterior] = field(default_factory=dict)


def _posterior(X: np.ndarray, y: np.ndarray, mu: np.ndarray, tau2: np.ndarray, sigma2: float) -> tuple[np.ndarray, np.ndarray]:
    prec = np.diag(1.0 / tau2) + X.T @ X / sigma2
    # Solve rather than invert where possible; the covariance is needed anyway
    S = np.linalg.inv(prec)
    S = (S + S.T) / 2
    m = S @ (mu / tau2 + X.T @ y / sigma2)
    return m, S


def fit(users: Mapping[str, UserData], max_iter: int = 1000, tol: float = 1e-6,
        tau2_floor: float = 1e-4) -> FitResult:
    """Fit the population by EM, then every user's posterior."""
    scale = population_scale(list(users.values()))
    prepared = {}
    for uid, u in users.items():
        if u.n == 0:
            continue
        X = centred(u.raw, u.means, scale)
        y = u.y - u.y_mean
        prepared[uid] = (X, y, u)

    N = sum(len(y) for _, y, _ in prepared.values())
    U = len(prepared)
    y_var = float(np.mean(np.concatenate([y for _, y, _ in prepared.values()]) ** 2)) if N else 1.0

    mu = np.zeros(P)
    tau2 = np.full(P, 0.1)
    sigma2 = max(y_var, 1e-3)
    converged = False
    it = 0
    for it in range(1, max_iter + 1):
        ms, Ss, rss = [], [], 0.0
        for X, y, _ in prepared.values():
            m, S = _posterior(X, y, mu, tau2, sigma2)
            ms.append(m)
            Ss.append(S)
            r = y - X @ m
            rss += float(r @ r + np.trace(X.T @ X @ S))
        if not ms:
            break
        M = np.array(ms)
        new_mu = M.mean(axis=0)
        new_tau2 = np.maximum(((M - new_mu) ** 2).mean(axis=0) + np.array([np.diag(S) for S in Ss]).mean(axis=0), tau2_floor)
        new_sigma2 = max(rss / max(N - U, 1), 1e-4)
        delta = max(np.max(np.abs(new_mu - mu)), np.max(np.abs(new_tau2 - tau2)), abs(new_sigma2 - sigma2))
        mu, tau2, sigma2 = new_mu, new_tau2, new_sigma2
        if delta < tol:
            converged = True
            break

    pop = Population(mu=mu, tau2=tau2, sigma2=sigma2, scale=scale, iterations=it, converged=converged)
    result = FitResult(population=pop)
    for uid, (X, y, u) in prepared.items():
        m, S = _posterior(X, y, mu, tau2, sigma2)
        result.users[uid] = UserPosterior(m=m, S=S, n=u.n, data=u)
    return result


def prior_posterior(pop: Population) -> UserPosterior:
    """What the model believes about someone it has no data for yet."""
    return UserPosterior(m=pop.mu.copy(), S=np.diag(pop.tau2), n=0)


@dataclass
class Forecast:
    mean: float
    lower: float  # 80% interval
    upper: float
    sd: float


def forecast(pop: Population, post: UserPosterior, today: Optional[Mapping[str, object]],
             yesterday: Optional[Mapping[str, object]], d: date) -> Optional[Forecast]:
    """Morning forecast of day d's mood. None until the user has any mood history."""
    u = post.data
    if u is None or u.n == 0:
        return None
    x = centred(row_inputs(today, yesterday, d)[None, :], u.means, pop.scale)[0]
    mean = u.y_mean + float(x @ post.m)
    # Noise + uncertainty in the effects + uncertainty in the user's own average
    var = pop.sigma2 + float(x @ post.S @ x) + pop.sigma2 / u.n
    sd = float(np.sqrt(var))
    clip = lambda v: float(min(MOOD_MAX, max(MOOD_MIN, v)))
    return Forecast(mean=clip(mean), lower=clip(mean - Z80 * sd), upper=clip(mean + Z80 * sd), sd=sd)


def effects_table(pop: Population, post: UserPosterior, actionable_only: bool = True) -> list[dict]:
    """Per-feature effects in natural units, for MlUserEffect."""
    rows = []
    for j, f in enumerate(FEATURES):
        if actionable_only and not f.actionable:
            continue
        mean, sd, p_pos = post.effect(pop, j)
        rows.append({"feature": f.name, "unit": f.unit, "mean": mean, "sd": sd, "probPositive": p_pos,
                     "ownShare": post.own_share(pop, j), "claim": post.claim(pop, j), "nDays": post.n})
    return rows


def day_before(d: date) -> date:
    return d - timedelta(days=1)


def no_pooling(users: Mapping[str, UserData], scale: np.ndarray, ridge: float = 1e-3) -> dict[str, np.ndarray]:
    """Baseline: each user on their own (near-plain least squares), standardised units."""
    out = {}
    for uid, u in users.items():
        if u.n == 0:
            continue
        X = centred(u.raw, u.means, scale)
        y = u.y - u.y_mean
        out[uid] = np.linalg.solve(X.T @ X + ridge * np.eye(P), X.T @ y)
    return out


def complete_pooling(users: Mapping[str, UserData], scale: np.ndarray, ridge: float = 1e-3) -> np.ndarray:
    """Baseline: one set of effects for everyone, standardised units."""
    Xs, ys = [], []
    for u in users.values():
        if u.n == 0:
            continue
        Xs.append(centred(u.raw, u.means, scale))
        ys.append(u.y - u.y_mean)
    X, y = np.vstack(Xs), np.concatenate(ys)
    return np.linalg.solve(X.T @ X + ridge * np.eye(P), X.T @ y)


def summarise_population(pop: Population) -> dict:
    """JSON-friendly population summary for MlModelRun.population (natural units)."""
    return {
        f.name: {"typical": float(pop.mu[j] / pop.scale[j]), "spread": float(np.sqrt(pop.tau2[j]) / pop.scale[j]), "unit": f.unit}
        for j, f in enumerate(FEATURES)
    } | {"noiseSd": float(np.sqrt(pop.sigma2)), "iterations": pop.iterations, "converged": pop.converged}


def users_from_rows(rows_by_user: Mapping[str, Sequence[Mapping[str, object]]]) -> dict[str, UserData]:
    from .features import build_user
    return {uid: build_user(rows) for uid, rows in rows_by_user.items()}
