#!/usr/bin/env python3
"""Owner-roll legal parse cases for Reeves AB / Pecos B-n S-n / Howard T&P."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from abstract_match import grid_from_text, parse_legal_description  # noqa: E402


def main() -> None:
    p = parse_legal_description("AB 2210 BLK T2S 57 SEC 46 /T&P RR CO SUR")
    assert p["abstract"] == "2210", p
    assert p["section"] == "46", p
    assert p["block"] == "57 T2S", p

    p = parse_legal_description("T1N BLK 35 SEC 36 A-1013")
    assert p["abstract"] == "1013", p
    assert p["block"] == "35 T1N", p
    assert p["section"] == "36", p

    p = parse_legal_description("T&P RR T1S BLK 35 SEC 4 A-654")
    assert p["abstract"] == "654", p
    assert p["block"] == "35 T1S", p
    assert p["section"] == "4", p

    p = parse_legal_description("GC&SF B-119 S-18")
    assert p["abstract"] is None, p
    assert p["block"] == "119", p
    assert p["section"] == "18", p

    p = parse_legal_description("GC&SF S2 B-119 S-17")
    assert p["block"] == "119", p
    assert p["section"] == "17", p

    p = parse_legal_description("AB 868 BLK 55-5 SEC 31T&P LTS 32 & 51")
    assert p["abstract"] == "868", p
    assert p["block"] and p["block"].startswith("55"), p
    assert p["section"] == "31", p

    blk, twn, sec = grid_from_text("AB 2210 BLK T2S 57 SEC 46")
    assert (blk, twn, sec) == ("57", "T2S", "46"), (blk, twn, sec)

    # Must not treat AB as abstract B
    p = parse_legal_description("AB 4930 BLK C-16 SEC 16PSL")
    assert p["abstract"] == "4930", p

    print("ok")


if __name__ == "__main__":
    main()
