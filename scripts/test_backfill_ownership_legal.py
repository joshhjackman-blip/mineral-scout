#!/usr/bin/env python3
"""Legal backfill only rewrites ghost/missing abstracts."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from abstract_match import parse_legal_description  # noqa: E402
from backfill_ownership_legal import is_ghost_abstract, survey_text  # noqa: E402


def main() -> None:
    assert is_ghost_abstract("B")
    assert is_ghost_abstract("AB")
    assert not is_ghost_abstract("2210")
    assert not is_ghost_abstract("A-2210")
    assert not is_ghost_abstract(None)

    parsed = parse_legal_description("AB 2210 BLK T2S 57 SEC 46 /T&P RR CO SUR")
    assert parsed["abstract"] == "2210", parsed
    assert is_ghost_abstract("B")
    assert not is_ghost_abstract(parsed["abstract"])

    row = {
        "abstract": "B",
        "survey": "short",
        "raw_record": {"survey": "AB 2210 BLK T2S 57 SEC 46 /T&P RR CO SUR"},
    }
    assert "AB 2210" in survey_text(row)
    print("ok")


if __name__ == "__main__":
    main()
