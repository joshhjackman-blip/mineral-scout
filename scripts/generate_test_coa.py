#!/usr/bin/env python3
"""Generate a realistic test COA PDF for extraction testing."""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas


def draw_line(pdf: canvas.Canvas, x: float, y: float, text: str, bold: bool = False) -> float:
    pdf.setFont("Helvetica-Bold" if bold else "Helvetica", 11)
    pdf.drawString(x, y, text)
    return y - 0.24 * inch


def build_test_coa(output_path: Path) -> None:
    pdf = canvas.Canvas(str(output_path), pagesize=LETTER)
    width, height = LETTER
    left = 0.9 * inch
    y = height - 0.9 * inch

    pdf.setTitle("Certificate of Analysis - Test Document")

    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(left, y, "CERTIFICATE OF ANALYSIS (COA)")
    y -= 0.35 * inch

    pdf.setStrokeColorRGB(0.75, 0.75, 0.75)
    pdf.line(left, y, width - left, y)
    y -= 0.3 * inch

    y = draw_line(pdf, left, y, "Supplier Name: Shenzhen BioAPI Sciences Co. Ltd", bold=True)
    y = draw_line(pdf, left, y, "Compound Name: Semaglutide")
    y = draw_line(pdf, left, y, "Lot Number: SG-SEM-2026-03-A17")
    y = draw_line(pdf, left, y, "Manufacture Date: 2026-01-15")
    y = draw_line(pdf, left, y, "Expiry Date: 2027-01-14")
    y = draw_line(pdf, left, y, "Purity Percentage: 99.2")
    y = draw_line(pdf, left, y, "Assay Result: Conforms to USP specification")
    y = draw_line(pdf, left, y, "Lab Name: Hangzhou Analytical QA Laboratory")
    y -= 0.08 * inch

    y = draw_line(pdf, left, y, "Additional Test Results", bold=True)
    y = draw_line(pdf, left, y, "- Identity (HPLC): Pass")
    y = draw_line(pdf, left, y, "- Water Content: 0.6%")
    y = draw_line(pdf, left, y, "- Heavy Metals (Pb): < 1.0 ppm")
    y = draw_line(pdf, left, y, "- Residual Solvents (Methanol): 120 ppm")
    y -= 0.08 * inch

    y = draw_line(pdf, left, y, "Authorized by: Dr. Mei Chen, QA Director")
    y = draw_line(pdf, left, y, "Issue Date: 2026-03-13")
    y = draw_line(pdf, left, y, "Document ID: COA-PT-TEST-0001")

    pdf.setFont("Helvetica-Oblique", 9)
    pdf.drawString(left, 0.7 * inch, "This is synthetic test data for development use only.")

    pdf.showPage()
    pdf.save()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a test COA PDF.")
    parser.add_argument(
        "--output",
        default="test_coa.pdf",
        help="Output PDF filename (default: test_coa.pdf)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    build_test_coa(output_path)
    print(f"Generated test COA PDF at: {output_path}")


if __name__ == "__main__":
    main()
