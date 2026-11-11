"""Classification, calibration, and auto-act coverage metrics."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

import numpy as np


@dataclass(frozen=True)
class ClassReport:
    accuracy: float
    n: int
    per_label: dict[str, float]


def accuracy(y_true: list[str], y_pred: list[str]) -> ClassReport:
    n = len(y_true)
    if n == 0:
        return ClassReport(accuracy=float("nan"), n=0, per_label={})
    hits = sum(a == b for a, b in zip(y_true, y_pred, strict=True))
    labels = sorted(set(y_true) | set(y_pred))
    per_label: dict[str, float] = {}
    for label in labels:
        mask = [t == label for t in y_true]
        denom = sum(mask)
        if denom == 0:
            per_label[label] = float("nan")
            continue
        correct = sum(p == label for t, p, keep in zip(y_true, y_pred, mask, strict=True) if keep)
        per_label[label] = correct / denom
    return ClassReport(accuracy=hits / n, n=n, per_label=per_label)


def mae(y_true: list[float], y_pred: list[float]) -> float:
    if not y_true:
        return float("nan")
    return float(np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred))))


def brier(y_true_bin: list[int], p: list[float]) -> float:
    if not y_true_bin:
        return float("nan")
    yt = np.asarray(y_true_bin, dtype=float)
    pp = np.clip(np.asarray(p, dtype=float), 0.0, 1.0)
    return float(np.mean((pp - yt) ** 2))


def ece(y_true_bin: list[int], p: list[float], n_bins: int = 10) -> float:
    """Expected calibration error for binary probabilities."""
    if not y_true_bin:
        return float("nan")
    yt = np.asarray(y_true_bin, dtype=float)
    pp = np.clip(np.asarray(p, dtype=float), 0.0, 1.0)
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    total = 0.0
    for lo, hi in zip(bins[:-1], bins[1:], strict=True):
        mask = (pp >= lo) & (pp < hi) if hi < 1.0 else (pp >= lo) & (pp <= hi)
        if not np.any(mask):
            continue
        total += float(np.mean(mask) * abs(np.mean(pp[mask]) - np.mean(yt[mask])))
    return total


def precision_coverage_curve(
    y_true_bin: list[int],
    p: list[float],
    thresholds: Iterable[float] | None = None,
) -> list[dict[str, float]]:
    """Precision and coverage of the auto-act set {p >= t}."""
    if not y_true_bin:
        return []
    ts = list(thresholds) if thresholds is not None else [round(x, 2) for x in np.linspace(0.5, 0.95, 10)]
    yt = np.asarray(y_true_bin, dtype=int)
    pp = np.asarray(p, dtype=float)
    n = len(yt)
    rows: list[dict[str, float]] = []
    for t in ts:
        acted = pp >= t
        coverage = float(np.mean(acted)) if n else 0.0
        if not np.any(acted):
            rows.append({"threshold": float(t), "coverage": 0.0, "precision": float("nan"), "n_acted": 0})
            continue
        precision = float(np.mean(yt[acted]))
        rows.append(
            {
                "threshold": float(t),
                "coverage": coverage,
                "precision": precision,
                "n_acted": int(np.sum(acted)),
            }
        )
    return rows


def coverage_at_precision(
    curve: list[dict[str, float]], min_precision: float = 0.95
) -> dict[str, float]:
    eligible = [row for row in curve if row["precision"] == row["precision"] and row["precision"] >= min_precision]
    if not eligible:
        return {"min_precision": min_precision, "coverage": 0.0, "threshold": float("nan")}
    best = max(eligible, key=lambda row: row["coverage"])
    return {
        "min_precision": min_precision,
        "coverage": best["coverage"],
        "threshold": best["threshold"],
        "precision": best["precision"],
    }


def split_indices(ids: list[str], seed: int = 7) -> dict[str, set[str]]:
    """Deterministic 60/20/20 split by example id."""
    rng = np.random.default_rng(seed)
    shuffled = list(ids)
    rng.shuffle(shuffled)
    n = len(shuffled)
    n_train = int(n * 0.6)
    n_calib = int(n * 0.2)
    return {
        "train": set(shuffled[:n_train]),
        "calib": set(shuffled[n_train : n_train + n_calib]),
        "test": set(shuffled[n_train + n_calib :]),
    }


def group_by(items: Iterable[dict], key: str) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        grouped[str(item[key])].append(item)
    return dict(grouped)
