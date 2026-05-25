#!/usr/bin/env python3
"""Backward-compat shim — calls enrich_county_parcels.py with --county martin."""

import os
import sys
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    target = repo_root / "scripts" / "enrich_county_parcels.py"
    if not target.exists():
        sys.stderr.write(f"missing: {target}\n")
        sys.exit(1)
    args = sys.argv[1:]
    if "--county" not in args:
        args = ["--county", "martin", *args]
    os.execv(sys.executable, [sys.executable, str(target), *args])


if __name__ == "__main__":
    main()
