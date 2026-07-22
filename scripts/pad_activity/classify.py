"""Signature classification for MAJOR_CHANGE pads.

At Sentinel-2 10 m resolution we cannot resolve individual trucks.
Use engineered features from the change mask (cluster count / area /
spectral heterogeneity) plus a rule-based scorer. Swap in XGBoost
once a labeled RRC completion-date sample exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .config import CLASSIFY_CONFIDENCE_FLOOR


@dataclass
class SignatureResult:
    signature: str
    confidence: float
    features: dict[str, Any]


def _change_mask(before: np.ndarray, after: np.ndarray, thr: float = 0.12) -> np.ndarray:
    a = np.asarray(before, dtype=np.float32)
    b = np.asarray(after, dtype=np.float32)
    if a.ndim == 2:
        a = a[..., None]
        b = b[..., None]
    if a.max() > 1.5:
        a = a / 255.0
        b = b / 255.0
    delta = np.mean(np.abs(a[..., :3] - b[..., :3]), axis=-1)
    return delta >= thr


def _connected_components(mask: np.ndarray) -> tuple[int, float]:
    """4-connected component count + mean area (pixels). Pure numpy BFS."""
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    sizes: list[int] = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or visited[y, x]:
                continue
            stack = [(y, x)]
            visited[y, x] = True
            size = 0
            while stack:
                cy, cx = stack.pop()
                size += 1
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            sizes.append(size)
    if not sizes:
        return 0, 0.0
    return len(sizes), float(np.mean(sizes))


def classify_signature(
    before: np.ndarray,
    after: np.ndarray,
    metrics: dict[str, Any] | None = None,
    *,
    confidence_floor: float = CLASSIFY_CONFIDENCE_FLOOR,
) -> SignatureResult:
    mask = _change_mask(before, after)
    n_clusters, mean_area = _connected_components(mask)
    changed_frac = float(mask.mean()) if mask.size else 0.0
    edge_delta = float((metrics or {}).get("edge_delta") or 0.0)
    spectral = float((metrics or {}).get("spectral_delta") or 0.0)

    features = {
        "n_clusters": n_clusters,
        "mean_cluster_area": mean_area,
        "changed_frac": changed_frac,
        "edge_delta": edge_delta,
        "spectral_delta": spectral,
    }

    # Rule-based starter. Completion crews → many new clusters + high
    # edge density. Rig move-in → fewer clusters + bare-earth spectral
    # jump. Rig move-out → structures disappear (negative edge delta
    # with moderate spectral change). Everything else → AMBIGUOUS /
    # NON_RELEVANT.
    if n_clusters >= 3 and mean_area >= 4 and edge_delta > 0.02:
        signature = "COMPLETION_CREW"
        confidence = min(0.9, 0.5 + 0.08 * n_clusters + 0.3 * changed_frac)
    elif n_clusters in (1, 2) and spectral > 0.08 and edge_delta > 0.01:
        signature = "RIG_MOVE_IN"
        confidence = min(0.85, 0.45 + spectral + edge_delta)
    elif edge_delta < -0.01 and spectral > 0.05:
        signature = "RIG_MOVE_OUT"
        confidence = min(0.8, 0.4 + spectral)
    elif changed_frac < 0.02:
        signature = "NON_RELEVANT"
        confidence = 0.7
    else:
        signature = "AMBIGUOUS"
        confidence = 0.4

    if confidence < confidence_floor and signature not in {"NON_RELEVANT"}:
        signature = "AMBIGUOUS"

    return SignatureResult(
        signature=signature,
        confidence=float(np.clip(confidence, 0.0, 1.0)),
        features=features,
    )


def summary_for_signature(
    signature: str,
    confidence: float,
    *,
    lease_name: str | None = None,
) -> str:
    lease = lease_name or "this lease"
    pct = int(round(confidence * 100))
    if signature == "COMPLETION_CREW":
        return (
            f"Well activity update: new equipment cluster detected on {lease}, "
            f"consistent with completion crew mobilization (confidence: {pct}%). "
            f"Production and payout likely imminent — recommended follow-up."
        )
    if signature == "RIG_MOVE_IN":
        return (
            f"Well activity update: fresh pad clearing / single structure "
            f"appeared on {lease} (confidence: {pct}%). Drilling may be starting."
        )
    if signature == "RIG_MOVE_OUT":
        return (
            f"Well activity update: equipment departed {lease} "
            f"(confidence: {pct}%). Pad going quiet."
        )
    if signature == "RRC_COMPLETION":
        return (
            f"Well activity update: RRC completion reported on {lease}. "
            f"Production and payout likely imminent — recommended follow-up."
        )
    return (
        f"Well activity update: imagery change on {lease} "
        f"(confidence: {pct}%) — review side-by-side before calling."
    )
