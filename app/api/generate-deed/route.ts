import { NextRequest, NextResponse } from 'next/server'
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'

export async function POST(req: NextRequest) {
  const form = await req.json()
  const {
    grantorName, grantorAddress, grantorCity, grantorState, grantorZip,
    granteeName, granteeAddress, granteeCity, granteeState, granteeZip,
    effectiveDate, legalDescription, county,
  } = form

  const grantorFullAddress = `${grantorAddress}, ${grantorCity}, ${grantorState} ${grantorZip}`
  const granteeFullAddress = `${granteeAddress}, ${granteeCity}, ${granteeState} ${granteeZip}`

  const bold = (text: string) => new TextRun({ text, bold: true })
  const normal = (text: string) => new TextRun({ text })
  const emptyPara = () => new Paragraph({ children: [new TextRun('')], spacing: { after: 100 } })
  const para = (children: TextRun[], spacing = 200) =>
    new Paragraph({ children, alignment: AlignmentType.JUSTIFIED, spacing: { after: spacing } })

  const countyUpper = String(county ?? '').toUpperCase()
  const grantorNameUpper = String(grantorName ?? '').toUpperCase()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: 'MINERAL DEED', bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),

        new Paragraph({ children: [normal('STATE OF TEXAS\t\t\t§')], spacing: { after: 50 } }),
        new Paragraph({ children: [normal('\t\t\t\t§')], spacing: { after: 50 } }),
        new Paragraph({ children: [normal(`COUNTY OF ${countyUpper}\t\t\t§`)], spacing: { after: 200 } }),

        emptyPara(),

        para([
          bold(grantorName ?? ''),
          normal(`, whose address is ${grantorFullAddress} ("Grantor"), for the sum of Ten Dollars ($10.00) and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, does hereby grant, bargain, sell, transfer, convey, assign and deliver all of Grantor's interest in and to the oil, gas, and minerals (the "Mineral Interest") in and under and that may be produced from the lands as set forth and identified in "Exhibit A," which is attached to and made a part of this Mineral Deed for all purposes (the "Lands"), to `),
          bold(granteeName ?? ''),
          normal(`, whose address is ${granteeFullAddress} ("Grantee").`),
        ]),

        emptyPara(),

        para([
          normal(`This Mineral Deed is effective for all purposes, including runs of oil and deliveries of gas and other hydrocarbons, as of ${effectiveDate} (the "Effective Date"). Grantor also conveys to Grantee any and all revenues attributable to the Mineral Interest that are held in suspense, unremitted, or otherwise unpaid regardless of the Effective Date.`),
        ]),

        emptyPara(),

        para([
          normal("TO HAVE AND TO HOLD the above-described Lands and Mineral Interest, together with all and singular the rights and appurtenances thereto and anywise belonging, unto Grantee and Grantee's heirs, successors, and assigns forever; and Grantor, their heirs and successors warrant and agree to forever defend title to the Lands unto Grantee and Grantee's heirs, successors, and assigns against all claims of every person claiming or to claim the same or any part thereof."),
        ]),

        emptyPara(),

        para([
          new TextRun({ text: 'IN WITNESS WHEREOF', bold: true }),
          normal(', this Mineral Deed is executed on the date of acknowledgement, but shall be effective as of the Effective Date provided herein.'),
        ]),

        emptyPara(),
        emptyPara(),

        new Paragraph({ children: [bold('GRANTOR:')], spacing: { after: 100 } }),
        new Paragraph({ children: [bold(grantorNameUpper)], spacing: { after: 300 } }),
        new Paragraph({ children: [normal('___________________________')], spacing: { after: 100 } }),
        new Paragraph({ children: [normal('Date: _______________________')], spacing: { after: 400 } }),

        emptyPara(),
        emptyPara(),
        emptyPara(),

        new Paragraph({
          children: [bold('EXHIBIT A')],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),

        new Paragraph({
          children: [normal(`Attached and made a part of that Mineral Deed effective ${effectiveDate} between ${grantorName} ("Grantor"), and ${granteeName} ("Grantee").`)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),

        new Paragraph({ children: [bold('LANDS:')], spacing: { after: 200 } }),

        new Paragraph({
          children: [normal(legalDescription || `${county} County, Texas`)],
          spacing: { after: 400 },
        }),

        new Paragraph({
          children: [bold('END OF EXHIBIT A')],
          alignment: AlignmentType.CENTER,
        }),
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const safeName = String(grantorName ?? 'Grantor').replace(/[^a-z0-9]/gi, '_')

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}_Mineral_Deed.docx"`,
    },
  })
}
