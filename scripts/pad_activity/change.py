"""Chip-to-chip change detection (Sentinel-2 weekly workhorse).

Pure-numpy implementation so the weekly job doesn't need OpenCV.
When chips are unavailable the RRC bridge still produces events;
this module is exercised once pad_imagery_log has before/after paths.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .config import CHANGE_MAJOR_THRESHOLD, CHANGE_MINOR_THRESHOLD


@dataclass
class ChangeResult:
    change_score: float
    classification: str  # NO_CHANGE | MINOR_CHANGE | MAJOR_CHANGE
    metrics: dict[str, Any]


def _to_float_rgb(chip: np.ndarray) -> np.ndarray:
    """Accept HxWxC uint8/float; return float32 HxWx3 in [0, 1]."""
    arr = np.asarray(chip, dtype=np.float32)
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    if arr.shape[-1] > 3:
        arr = arr[..., :3]
    if arr.max() > 1.5:
        arr = arr / 255.0
    return np.clip(arr, 0.0, 1.0)


def spectral_delta(a: np.ndarray, b: np.ndarray) -> float:
    a3, b3 = _to_float_rgb(a), _to_float_rgb(b)
    return float(np.mean(np.abs(a3 - b3)))


def ssim_approx(a: np.ndarray, b: np.ndarray) -> float:
    """Lightweight SSIM proxy on luminance (no skimage dependency)."""
    a3, b3 = _to_float_rgb(a), _to_float_rgb(b)
    ay = 0.299 * a3[..., 0] + 0.587 * a3[..., 1] + 0.114 * a3[..., 2]
    by = 0.299 * b3[..., 0] + 0.587 * b3[..., 1] + 0.114 * b3[..., 2]
    mu_a, mu_b = float(ay.mean()), float(by.mean())
    sig_a = float(ay.var())
    sig_b = float(by.var())
    sig_ab = float(((ay - mu_a) * (by - mu_b)).mean())
    c1, c2 = 0.01**2, 0.03**2
    num = (2 * mu_a * mu_b + c1) * (2 * sig_ab + c2)
    den = (mu_a**2 + mu_b**2 + c1) * (sig_a + sig_b + c2)
    if den <= 0:
        return 0.0
    return float(np.clip(num / den, -1.0, 1.0))


def edge_density(chip: np.ndarray) -> float:
    """Laplacian-variance proxy for equipment clutter / edge density."""
    a3 = _to_float_rgb(chip)
    y = 0.299 * a3[..., 0] + 0.587 * a3[..., 1] + 0.114 * a3[..., 2]
    # 3x3 Laplacian kernel via slicing
    center = y[1:-1, 1:-1]
    lap = (
        y[:-2, 1:-1] + y[2:, 1:-1] + y[1:-1, :-2] + y[1:-1, 2:]
        - 4.0 * center
    )
    return float(lap.var())


def compare_chips(
    before: np.ndarray,
    after: np.ndarray,
    *,
    minor_threshold: float = CHANGE_MINOR_THRESHOLD,
    major_threshold: float = CHANGE_MAJOR_THRESHOLD,
) -> ChangeResult:
    spec = spectral_delta(before, after)
    ssim = ssim_approx(before, after)
    edge_before = edge_density(before)
    edge_after = edge_density(after)
    edge_delta = abs(edge_after - edge_before)

    # Higher spectral delta + lower SSIM + higher edge delta => change.
    # Weights are starting points; calibrate on labeled completions.
    score = (
        0.45 * spec
        + 0.35 * max(0.0, 1.0 - ssim)
        + 0.20 * min(1.0, edge_delta * 5.0)
    )
    score = float(np.clip(score, 0.0, 1.0))

    if score >= major_threshold:
        classification = "MAJOR_CHANGE"
    elif score >= minor_threshold:
        classification = "MINOR_CHANGE"
    else:
        classification = "NO_CHANGE"

    return ChangeResult(
        change_score=score,
        classification=classification,
        metrics={
            "spectral_delta": spec,
            "ssim": ssim,
            "edge_density_before": edge_before,
            "edge_density_after": edge_after,
            "edge_delta": edge_delta,
        },
    )
