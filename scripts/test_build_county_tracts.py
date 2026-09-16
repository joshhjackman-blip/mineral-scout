#!/usr/bin/env python3
"""Parser cases for Pecos / Reeves LEGAL_DESC (no lot-grid, no junk blocks)."""
from __future__ import annotations

from build_county_tracts import parcel_info


def expect(legal: str, key_prefix: str | None, **fields) -> None:
    got = parcel_info(legal)
    if key_prefix is None:
        assert got is None, f"{legal!r} should drop, got {got}"
        return
    assert got is not None, f"{legal!r} should parse"
    tkey, abstract, block, twn, sec = got
    assert tkey.startswith(key_prefix), f"{legal!r} key {tkey}"
    if "abstract" in fields:
        assert abstract == fields["abstract"], f"{legal!r} abs {abstract}"
    if "block" in fields:
        assert block == fields["block"], f"{legal!r} block {block}"
    if "sec" in fields:
        assert sec == fields["sec"], f"{legal!r} sec {sec}"
    if "twn" in fields:
        assert twn == fields["twn"], f"{legal!r} twn {twn}"


def main() -> None:
    # Pecos T&P countryside — previously None, which left the CAD hole.
    expect("5270  48-8 T&P   SEC 20 UND INT", "A:", abstract="5270", block="48", twn="T8", sec="20")
    expect("9394  48-10 T&P  SEC 35 UND 1/2 INT", "A:", abstract="9394", block="48", sec="35")
    expect("8455  51-10 T&P SEC 34", "A:", abstract="8455", block="51", sec="34")
    expect("8370-71  48-9 T&P  SEC 42 UND INT", "A:", abstract="8370", sec="42")
    expect("7270  129 T&STLSEC 30 UND 1/2 INT", "A:", abstract="7270", sec="30")
    expect("2298  132 T&STL  SE 17 UND 1/2 INT", "A:", abstract="2298", sec="17")
    expect("6934&5544     C-4 GC&SF SEC 44", "A:", abstract="6934", sec="44")
    expect("9447{3  3 H&TC   SEC 6", "A:", abstract="9447", sec="6")
    expect("6709  8 H&GN SEC 78 UND INT", "A:", abstract="6709", block="8", sec="78")
    expect("6291  D GC&SF  SEC 84 TR 1", "A:", abstract="6291", block="D", sec="84")

    # Reeves glued tokens / PSL suffix
    expect("AB 5603BLK 55 SEC 33PSL", "A:", abstract="5603", block="55", sec="33")
    expect("AB 3570 BLK 53 SEC 22PSL", "A:", abstract="3570", block="53", sec="22")
    expect("AB 4930 BLK C-16 SEC 16PSL", "A:", abstract="4930", block="C-16", sec="16")
    expect("AB-5835 BLK 58-6 SEC 14 T&P (UND 363 AC)", "A:", abstract="5835", block="58", sec="14")

    # Existing Midland / Ward / Reagan / Upton shapes must still parse
    expect("N/2SW/4, SEC:  47, BLK:  39-T4S", "G:", block="39", twn="T4S", sec="47")
    expect("SEC 34 (A425) BLOCK 1 H&TC", "A:", abstract="425", block="1", sec="34")
    expect("UNIVERSITY LAND BLOCK 5 SECT 19 227 AC", "G:", block="5", sec="19")
    expect("AB 935 SEC 2 D L CARVER", "A:", abstract="935", sec="2")
    expect("1270 PATTERSON W A SEC 98 1303 AC", "A:", abstract="1270", sec="98")

    # Town lots and junk blocks must not become tracts or BlockMOBILE labels
    expect("LOT 5 BLK 9 MEADOWBROOK PECOS", None)
    expect("12  4 WEST END", None)
    expect("LT 1-2-3 BLK 63  ORIGTOYAH", None)
    expect("BLOCK MOBILE HOME PARK LOT 4", None)
    expect("3  4 QUAIL RUN 2ND FILING", None)

    print("ok")


if __name__ == "__main__":
    main()
