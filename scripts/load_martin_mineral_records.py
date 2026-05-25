#!/usr/bin/env python3
"""Backward-compat shim — calls load_county_mineral_records.py with --county martin."""

import os
import sys
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    target = repo_root / "scripts" / "load_county_mineral_records.py"
    if not target.exists():
        sys.stderr.write(f"missing: {target}\n")
        sys.exit(1)
    args = sys.argv[1:]
    if "--county" not in args:
        args = ["--county", "martin", *args]
    if "--input" not in args:
        default_input = repo_root / "data" / "owners__2025_Martin.xlsx"
        args = ["--input", str(default_input), *args]
    os.execv(sys.executable, [sys.executable, str(target), *args])


if __name__ == "__main__":
    main()
