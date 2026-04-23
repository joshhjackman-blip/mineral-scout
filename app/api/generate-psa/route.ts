import { NextRequest, NextResponse } from 'next/server'
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  TabStopType,
} from 'docx'

export async function POST(req: NextRequest) {
  const form = await req.json()

  const {
    agreementDate, sellerName, sellerAddress, sellerCity, sellerState, sellerZip,
    buyerName, buyerAddress, buyerCity, buyerState, buyerZip,
    effectiveDate, closingDate, county, nra, totalPrice, totalPriceWritten,
    legalDescription, buyerSignatory,
  } = form

  const sellerFullAddress = `${sellerAddress}, ${sellerCity}, ${sellerState} ${sellerZip}`
  const buyerFullAddress = `${buyerAddress}, ${buyerCity}, ${buyerState} ${buyerZip}`

  const bold = (text: string) => new TextRun({ text, bold: true })
  const normal = (text: string) => new TextRun({ text })
  const underline = (text: string) => new TextRun({ text, underline: {} })

  const para = (children: TextRun[], alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.JUSTIFIED, spacing = 200) =>
    new Paragraph({ children, alignment, spacing: { after: spacing } })

  const emptyPara = () => new Paragraph({ children: [new TextRun('')], spacing: { after: 100 } })

  const sellerNameUpper = String(sellerName ?? '').toUpperCase()
  const buyerNameUpper = String(buyerName ?? '').toUpperCase()
  const totalPriceNum = Number(totalPrice)
  const totalPriceFormatted = Number.isFinite(totalPriceNum) && totalPriceNum > 0
    ? totalPriceNum.toLocaleString('en-US', { minimumFractionDigits: 2 })
    : String(totalPrice ?? '')

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
          children: [new TextRun({ text: 'PURCHASE AND SALE AGREEMENT', bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),

        para([
          normal(`This Purchase and Sale Agreement (the "Agreement") is entered into this ${agreementDate} but is effective as of the date set forth below, by and between `),
          bold(sellerName ?? ''),
          normal(` whose address is ${sellerFullAddress} (the "Seller"), and `),
          bold(buyerName ?? ''),
          normal(`, whose address is ${buyerFullAddress} (the "Buyer").`),
        ]),

        emptyPara(),

        para([
          normal(`WHEREAS, Seller owns and desires to sell or assign to Buyer certain oil, gas, mineral and/or royalty interests (the "Interests") owned in ${county} County, Texas, in the subject lands described on the attached Exhibit "A."`),
        ]),

        emptyPara(),

        para([
          normal('WHEREAS, Buyer desires to purchase such Interests in the lands described in the attached Exhibit "A."'),
        ]),

        emptyPara(),

        para([
          normal('NOW THEREFORE, Seller and Buyer have reached an agreement regarding such purchase and sale with the following terms and conditions:'),
        ]),

        emptyPara(),

        new Paragraph({
          children: [
            new TextRun({ text: 'Purchase Price:  \t' }),
            new TextRun({ text: `$${totalPriceFormatted}` }),
          ],
          tabStops: [{ type: TabStopType.LEFT, position: 2880 }],
          spacing: { after: 100 },
        }),

        new Paragraph({
          children: [
            new TextRun({ text: 'Number of Net Royalty Acres:  \t' }),
            new TextRun({ text: `${nra ?? ''}` }),
          ],
          tabStops: [{ type: TabStopType.LEFT, position: 2880 }],
          spacing: { after: 100 },
        }),

        new Paragraph({
          children: [
            new TextRun({ text: 'Closing Date:  \t' }),
            new TextRun({ text: `On or before ${closingDate}, or thirty (30) business days after the date which both Seller and Buyer have executed the Agreement, whichever is later.` }),
          ],
          tabStops: [{ type: TabStopType.LEFT, position: 2880 }],
          spacing: { after: 100 },
        }),

        new Paragraph({
          children: [
            new TextRun({ text: 'Effective Date:  \t\t' }),
            new TextRun({ text: `${effectiveDate ?? ''}` }),
          ],
          tabStops: [{ type: TabStopType.LEFT, position: 2880 }],
          spacing: { after: 200 },
        }),

        emptyPara(),

        para([
          underline('Revenues Post-Effective Date'),
          normal('.  In the event Seller receives revenues from the Interests attributable to production after the Effective Date, Seller agrees to notify Buyer within ten (10) business days and that said revenues shall be owed to Buyer.  Any revenue, costs, expenses, and taxes will be prorated as of the Effective Date.'),
        ]),

        emptyPara(),

        para([
          underline('Assignment/Conveyance'),
          normal('.  Buyer shall prepare the assignment(s) on a form that is mutually agreeable to both Buyer and Seller.'),
        ]),

        emptyPara(),

        para([
          underline('Special Warranty'),
          normal('.  Seller will warrant title by, through, and under Seller.  Title will be conveyed to Buyer free and clear of any security interests, liens, mortgages, or other encumbrances.'),
        ]),

        emptyPara(),

        para([
          underline('Calculation of Purchase Price'),
          normal('. The total purchase price for the Interests shall be '),
          bold(totalPriceWritten ?? ''),
          normal(` ($${totalPriceFormatted}) (the "Purchase Price"), subject to adjustment as set forth herein, based upon the Parties' belief that Seller owns ${nra ?? ''} Net Royalty Acres in the lands described on the attached Exhibit "A." For purposes of calculating the Purchase Price, "Net Royalty Acres" shall mean one (1) net mineral acre of land subject to an oil and gas lease at a one-eighth (1/8) royalty, free and clear of any and all burdens outstanding in third parties. In the event Buyer establishes that Seller owns less Net Royalty Acres than set forth above, the Purchase Price will accordingly be proportionately reduced.`),
        ]),

        emptyPara(),

        para([
          underline('Restriction on Certain Actions'),
          normal(".  Seller will not, without Buyer's prior written consent: (a) enter into or modify any oil and gas lease or other agreement with respect to any of the Interests; (b) sell, transfer, or abandon any portion of the Interests; or (c) release, modify or reduce its rights under, any oil, gas, and/or mineral lease forming a part of the Interests."),
        ]),

        emptyPara(),

        para([
          underline('Due Diligence'),
          normal(".  Closing shall be subject to Buyer's review and approval of title and shall be at the sole discretion of the Buyer.  Seller shall in good faith cooperate with Buyer to provide any documentation readily available to address curative matters, and the closing shall further be contingent on the delivery of a properly executed assignment(s)."),
        ]),

        emptyPara(),

        para([
          underline('Force Majeure'),
          normal('.  In no event shall Buyer be held responsible or liable for any failure to or delay in Closing or in the performance of its obligations hereunder arising out of or caused by, directly or indirectly, forces beyond its control, including, without limitation, strikes, work stoppages, acts of war or terrorism, civil or military disturbances, natural catastrophes or acts of God, pandemic, or governmental action.'),
        ]),

        emptyPara(),

        para([
          underline('Confidentiality'),
          normal('.  This Agreement and its contents are intended to be confidential and are not to be discussed with or disclosed to any third party, except as may be required by contract or law.'),
        ]),

        emptyPara(),

        para([
          underline('Choice of Law'),
          normal('.  This Agreement shall be governed by the laws of the State of Texas without regard to conflict of law principles.'),
        ]),

        emptyPara(),

        para([
          underline('Successors and Assigns'),
          normal(".  This Agreement shall be binding upon and inure to the benefit of the parties hereto, and their respective successors and assigns. Buyer's rights and obligations under this Agreement may be freely assigned in Buyer's sole discretion at any time prior to Closing."),
        ]),

        emptyPara(),
        emptyPara(),

        new Paragraph({ children: [bold('SELLER:')], spacing: { after: 100 } }),
        new Paragraph({ children: [bold(sellerNameUpper)], spacing: { after: 300 } }),
        new Paragraph({ children: [normal('___________________________')], spacing: { after: 100 } }),
        new Paragraph({ children: [normal('Date: _______________________')], spacing: { after: 300 } }),

        emptyPara(),
        emptyPara(),

        new Paragraph({ children: [bold('BUYER:')], spacing: { after: 100 } }),
        new Paragraph({ children: [bold(buyerNameUpper)], spacing: { after: 200 } }),
        new Paragraph({ children: [normal('_________________________')], spacing: { after: 100 } }),
        new Paragraph({ children: [normal(`By:\t${buyerSignatory || ''}`)] }),
        new Paragraph({ children: [normal('Title:\tManaging Member')] }),
        new Paragraph({ children: [normal('Date:  ______________________')], spacing: { after: 400 } }),

        emptyPara(),
        emptyPara(),
        emptyPara(),

        new Paragraph({
          children: [bold('EXHIBIT "A"')],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),

        new Paragraph({
          children: [normal(`Attached to and made part of that certain Purchase and Sale Agreement dated ${agreementDate}, by and between ${sellerName} (the "Seller") and ${buyerName} (the "Buyer").`)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),

        new Paragraph({
          children: [bold('LANDS:')],
          spacing: { after: 200 },
        }),

        new Paragraph({
          children: [normal(legalDescription || `${county} County, Texas`)],
          spacing: { after: 400 },
        }),

        new Paragraph({
          children: [bold('[END OF EXHIBIT "A"]')],
          alignment: AlignmentType.CENTER,
        }),
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const safeName = String(sellerName ?? 'Seller').replace(/[^a-z0-9]/gi, '_')

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}_PSA.docx"`,
    },
  })
}
