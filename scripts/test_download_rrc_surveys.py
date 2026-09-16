#!/usr/bin/env python3
"""Field mapping for RRC survey polygons (no network)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from download_rrc_surveys import bare_abstract, feature_to_row  # noqa: E402


def main() -> None:
    assert bare_abstract("A-2210") == "2210"
    assert bare_abstract("2210") == "2210"
    assert bare_abstract("") == ""

    row = feature_to_row({
        "properties": {
            "ABSTRACT_NUMBER": "2210",
            "ABSTRACT_LABEL": "A-2210",
            "LEVEL1_SURVEY_NAME": "T&P RR CO",
            "LEVEL2_BLOCK_NUMBER": "57 T2S",
            "LEVEL3_SURVEY_NUMBER": "46",
            "LEVEL4_SURVEY_NAME": "",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[-103.5, 31.5], [-103.4, 31.5], [-103.4, 31.6], [-103.5, 31.6], [-103.5, 31.5]]],
        },
    })
    assert row is not None
    assert row["ABSTRACT_L"] == "A-2210"
    assert row["ABSTRACT_N"] == "2210"
    assert row["LEVEL2_BLO"] == "57 T2S"
    assert row["Surv_Sect"] == "46"

    dropped = feature_to_row({"properties": {}, "geometry": None})
    assert dropped is None
    print("ok")


if __name__ == "__main__":
    main()
