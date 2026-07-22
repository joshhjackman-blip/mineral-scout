"""Shared config for the pad-activity weekly pipeline."""

from __future__ import annotations

# Buffer around each well surface location when cropping a chip (meters).
PAD_BUFFER_M = 150

# Chip size in pixels at Sentinel-2 10 m/px (~640 m / ~1280 m FOV).
CHIP_SIZE_PX = 64

# Cloud cover filter for Sentinel-2 L2A scenes.
MAX_CLOUD_COVER_PCT = 20.0

# Change-score thresholds (start conservative — fewer false positives).
# Tunable once we have a labeled RRC completion-date sample.
CHANGE_MINOR_THRESHOLD = 0.12
CHANGE_MAJOR_THRESHOLD = 0.28

# Signature classifier confidence below which we mark AMBIGUOUS.
CLASSIFY_CONFIDENCE_FLOOR = 0.55

# Propensity bump for completion-consistent MAJOR_CHANGE (0–10 scale).
# Comparable to / stronger than a new permit filing in the product story.
COMPLETION_PROPENSITY_BUMP = 3
PROPENSITY_SCORE_CAP = 10

# Lookback for the Phase-1 RRC transition bridge (days).
RRC_COMPLETION_LOOKBACK_DAYS = 14

# Supabase Storage bucket + key prefix (matches existing Raw-Data pattern).
STORAGE_BUCKET = "Raw-Data"
STORAGE_PREFIX = "pad-imagery"

# Element84 Earth Search STAC (free Sentinel-2).
STAC_API_URL = "https://earth-search.aws.element84.com/v1"
STAC_COLLECTION = "sentinel-2-l2a"
