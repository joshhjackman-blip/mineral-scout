#!/usr/bin/env python3
"""Backward-compat shim — calls load_county_wells_shapefile.py with --county martin."""

import os
import sys
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    target = repo_root / "scripts" / "load_county_wells_shapefile.py"
    if not target.exists():
        sys.stderr.write(f"missing: {target}\n")
        sys.exit(1)
    args = sys.argv[1:]
    if "--county" not in args:
        args = ["--county", "martin", *args]
    if "--fips" not in args:
        args = ["--fips", "317", *args]
    if "--zip" not in args:
        args = ["--zip", str(repo_root / "data" / "well317.zip"), *args]
    os.execv(sys.executable, [sys.executable, str(target), *args])


if __name__ == "__main__":
    main()
