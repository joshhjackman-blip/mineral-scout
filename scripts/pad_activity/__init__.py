"""Pad activity detection — Rig → Completion crew change.

Phase 1 ships:
  * Supabase tables (pad_imagery_log / pad_change_log / pad_activity_events)
  * RRC transition detector (real weekly signal from permits/wells)
  * Sentinel-2 chip pull + change/classify modules (scaffolded; opt-in)
  * Propensity bump + CRM hot-tag on completion-consistent events

Phase 2a: Sentinel chip crop → Raw-Data/pad-imagery + pad_imagery_log.
Phase 2b: before/after change + classify → pad_change_log +
pad_activity_events with before_path/after_path (--enable-sentinel).
Phase 2c: NAIP (~60 cm) hi-res confirmation for Needs Review pads
  * On-demand: POST /api/pad-activity/hires { event_id }
  * Batch: python -m scripts.pad_activity.hires --county howard
  * Weekly opt-in: --enable-hires (after Sentinel AMBIGUOUS events)
  Still later: calibrate thresholds on labeled RRC completions.
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
