"""Pad activity detection — Rig → Completion crew change.

Phase 1 ships:
  * Supabase tables (pad_imagery_log / pad_change_log / pad_activity_events)
  * RRC transition detector (real weekly signal from permits/wells)
  * Sentinel-2 chip pull + change/classify modules (scaffolded; opt-in)
  * Propensity bump + CRM hot-tag on completion-consistent events

Phase 2a: Sentinel chip crop → Raw-Data/pad-imagery + pad_imagery_log.
Phase 2b: before/after change + classify → pad_change_log +
pad_activity_events with before_path/after_path (--enable-sentinel).
Phase 2c (later): calibrate thresholds on labeled RRC completions;
optional high-res confirmation for ambiguous high-propensity pads.
"""

__all__ = ["PERMIAN_PAD_COUNTIES"]

# Full 12-county AOI list from the product spec. Active ownership/wells
# tables today are howard + martin; the rest are coming-soon but kept
# here so the weekly job can expand without a code change.
PERMIAN_PAD_COUNTIES = (
    "howard",
    "martin",
    "loving",
    "pecos",
    "reeves",
    "winkler",
    "upton",
    "glasscock",
    "ward",
    "crane",
    "midland",
    "reagan",
)
