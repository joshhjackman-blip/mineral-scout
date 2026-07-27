'use client'

/**
 * PSA + Mineral Deed offer document generator.
 * Restored from the pre-PR#40 CRM inline editor (commit 2f712a8).
 * Downloads .docx via /api/generate-psa and /api/generate-deed.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { FileText, Package } from 'lucide-react'

export type OfferDeal = {
  id: string
  owner_name: string
  tract_abstract?: string | null
  tract_survey?: string | null
  rrc_lease_id?: string | null
  operator_name?: string | null
  county?: string | null
  surv_name?: string | null
  block?: string | null
  surv_sect?: string | null
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  acreage?: number | null
  offer_amount?: number | null
}

type BuyerEntity = { name: string; address: string; city: string; state: string; zip: string }

const BUYER_ENTITY_STORAGE_KEY = 'mineral_map_buyer_entity'
const DEFAULT_BUYER_ENTITY: BuyerEntity = { name: '', address: '', city: '', state: 'TX', zip: '' }

type DocFieldProps = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  minChars?: number
  style?: CSSProperties
}

const DocField = ({ value, onChange, placeholder, minChars = 10, style }: DocFieldProps) => {
  const chars = Math.max(
    (value?.length ?? 0) + 2,
    (placeholder?.length ?? 0) + 2,
    minChars
  )
  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      size={chars}
      style={{
        borderBottom: '1px solid #3B82F6',
        background: '#EFF6FF',
        padding: '0 4px',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        color: '#1D4ED8',
        outline: 'none',
        minWidth: 120,
        display: 'inline-block',
        ...style,
      }}
    />
  )
}

const DocTextarea = ({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
}) => (
  <textarea
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    style={{
      width: '100%',
      border: '1px solid #3B82F6',
      background: '#EFF6FF',
      padding: '8px 10px',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      color: '#1D4ED8',
      outline: 'none',
      display: 'block',
      marginTop: 8,
      marginBottom: 8,
      resize: 'vertical',
      borderRadius: 2,
    }}
  />
)

const PSA_CLAUSES: { heading: string; body: string }[] = [
  {
    heading: 'Revenues Post-Effective Date',
    body:
      '.  In the event Seller receives revenues from the Interests attributable to production after the Effective Date, Seller agrees to notify Buyer within ten (10) business days and that said revenues shall be owed to Buyer.  Any revenue, costs, expenses, and taxes will be prorated as of the Effective Date.',
  },
  {
    heading: 'Assignment/Conveyance',
    body:
      '.  Buyer shall prepare the assignment(s) on a form that is mutually agreeable to both Buyer and Seller.',
  },
  {
    heading: 'Special Warranty',
    body:
      '.  Seller will warrant title by, through, and under Seller.  Title will be conveyed to Buyer free and clear of any security interests, liens, mortgages, or other encumbrances.',
  },
  {
    heading: 'Restriction on Certain Actions',
    body:
      ".  Seller will not, without Buyer's prior written consent: (a) enter into or modify any oil and gas lease or other agreement with respect to any of the Interests; (b) sell, transfer, or abandon any portion of the Interests; or (c) release, modify or reduce its rights under, any oil, gas, and/or mineral lease forming a part of the Interests.",
  },
  {
    heading: 'Due Diligence',
    body:
      ".  Closing shall be subject to Buyer's review and approval of title and shall be at the sole discretion of the Buyer.  Seller shall in good faith cooperate with Buyer to provide any documentation readily available to address curative matters, and the closing shall further be contingent on the delivery of a properly executed assignment(s).",
  },
  {
    heading: 'Force Majeure',
    body:
      '.  In no event shall Buyer be held responsible or liable for any failure to or delay in Closing or in the performance of its obligations hereunder arising out of or caused by, directly or indirectly, forces beyond its control, including, without limitation, strikes, work stoppages, acts of war or terrorism, civil or military disturbances, natural catastrophes or acts of God, pandemic, or governmental action.',
  },
  {
    heading: 'Confidentiality',
    body:
      '.  This Agreement and its contents are intended to be confidential and are not to be discussed with or disclosed to any third party, except as may be required by contract or law.',
  },
  {
    heading: 'Choice of Law',
    body:
      '.  This Agreement shall be governed by the laws of the State of Texas without regard to conflict of law principles.',
  },
  {
    heading: 'Successors and Assigns',
    body:
      ".  This Agreement shall be binding upon and inure to the benefit of the parties hereto, and their respective successors and assigns. Buyer's rights and obligations under this Agreement may be freely assigned in Buyer's sole discretion at any time prior to Closing.",
  },
]

const numberToWords = (amount: number): string => {
  if (!amount || isNaN(amount)) return ''
  const ones = [
    '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN',
    'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN',
    'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
  ]
  const tens = [
    '', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY',
    'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY',
  ]

  const convertHundreds = (n: number): string => {
    if (n === 0) return ''
    if (n < 20) return ones[n] + ' '
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' '
    return ones[Math.floor(n / 100)] + ' HUNDRED ' + convertHundreds(n % 100)
  }

  const dollars = Math.floor(amount)
  const cents = Math.round((amount - dollars) * 100)

  let result = ''
  if (dollars >= 1000000) {
    result += convertHundreds(Math.floor(dollars / 1000000)) + 'MILLION '
    const thousands = Math.floor((dollars % 1000000) / 1000)
    result += convertHundreds(thousands)
    if (thousands > 0) result += 'THOUSAND '
    result += convertHundreds(dollars % 1000)
  } else if (dollars >= 1000) {
    result += convertHundreds(Math.floor(dollars / 1000)) + 'THOUSAND '
    result += convertHundreds(dollars % 1000)
  } else {
    result += convertHundreds(dollars)
  }

  return result.trim() + ' AND ' + String(cents).padStart(2, '0') + '/100'
}

function formatLong(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function buildLegalDescription(deal: OfferDeal, countyLabel: string): string {
  const abstract = String(deal.tract_abstract ?? '').trim()
  const surv = String(deal.surv_name ?? deal.tract_survey ?? '').trim()
  const block = String(deal.block ?? '').trim()
  const sect = String(deal.surv_sect ?? '').trim()
  const parts = [
    abstract ? (abstract.match(/^A-/i) ? abstract : `A-${abstract}`) : '',
    surv,
    block ? `Block ${block}` : '',
    sect ? `Section ${sect}` : '',
    countyLabel ? `${countyLabel} County, Texas` : 'Texas',
  ].filter(Boolean)
  return parts.join(', ')
}

type Props = {
  deal: OfferDeal
  countyLabel: string
  onOfferSent?: (dealId: string) => void
}

export default function OfferDocuments({ deal, countyLabel, onOfferSent }: Props) {
  const [buyerEntity, setBuyerEntity] = useState<BuyerEntity>(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_BUYER_ENTITY }
    try {
      const saved = window.localStorage.getItem(BUYER_ENTITY_STORAGE_KEY)
      if (!saved) return { ...DEFAULT_BUYER_ENTITY }
      return { ...DEFAULT_BUYER_ENTITY, ...JSON.parse(saved) }
    } catch {
      return { ...DEFAULT_BUYER_ENTITY }
    }
  })
  const [showPSAModal, setShowPSAModal] = useState(false)
  const [showDeedModal, setShowDeedModal] = useState(false)
  const [showFullPackageModal, setShowFullPackageModal] = useState(false)
  const [psaForm, setPsaForm] = useState<Record<string, string>>({})
  const [deedForm, setDeedForm] = useState<Record<string, string>>({})
  const [generatingDoc, setGeneratingDoc] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(BUYER_ENTITY_STORAGE_KEY, JSON.stringify(buyerEntity))
    } catch {
      // ignore quota / private mode
    }
  }, [buyerEntity])

  const openPSAModal = useCallback(() => {
    const today = new Date()
    const effectiveDate = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    const closingDate = new Date(today)
    closingDate.setDate(closingDate.getDate() + 44)
    const offer = Number(deal.offer_amount ?? 0)
    const nra = deal.acreage != null ? Number(deal.acreage) : 0
    const pricePer = offer > 0 && nra > 0 ? offer / nra : 0

    setPsaForm({
      agreementDate: formatLong(today),
      sellerName: deal.owner_name ?? '',
      sellerAddress: deal.mailing_address ?? '',
      sellerCity: deal.mailing_city ?? '',
      sellerState: deal.mailing_state ?? '',
      sellerZip: deal.mailing_zip ?? '',
      buyerName: buyerEntity.name,
      buyerAddress: buyerEntity.address,
      buyerCity: buyerEntity.city,
      buyerState: buyerEntity.state,
      buyerZip: buyerEntity.zip,
      effectiveDate: formatLong(effectiveDate),
      closingDate: formatLong(closingDate),
      legalDescription: buildLegalDescription(deal, countyLabel),
      county: countyLabel || 'Howard',
      nra: nra > 0 ? nra.toFixed(4) : '',
      pricePerNRA: pricePer > 0 ? pricePer.toFixed(2) : '',
      totalPrice: offer > 0 ? offer.toFixed(2) : '',
      totalPriceWritten: offer > 0 ? numberToWords(offer) : '',
      operatorName: deal.operator_name ?? '',
      rrcLeaseId: deal.rrc_lease_id ?? '',
      buyerSignatory: buyerEntity.name || 'Authorized Signatory',
    })
    setShowPSAModal(true)
  }, [deal, buyerEntity, countyLabel])

  const openDeedModal = useCallback(() => {
    const today = new Date()
    const effectiveDate = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    setDeedForm({
      grantorName: deal.owner_name ?? '',
      grantorAddress: deal.mailing_address ?? '',
      grantorCity: deal.mailing_city ?? '',
      grantorState: deal.mailing_state ?? '',
      grantorZip: deal.mailing_zip ?? '',
      granteeName: buyerEntity.name,
      granteeAddress: buyerEntity.address,
      granteeCity: buyerEntity.city,
      granteeState: buyerEntity.state,
      granteeZip: buyerEntity.zip,
      effectiveDate: formatLong(effectiveDate),
      legalDescription: buildLegalDescription(deal, countyLabel),
      county: countyLabel || 'Howard',
    })
    setShowDeedModal(true)
  }, [deal, buyerEntity, countyLabel])

  const openFullPackageModal = useCallback(() => {
    openPSAModal()
    setShowFullPackageModal(true)
  }, [openPSAModal])

  const updatePSAField = useCallback((field: string, value: string) => {
    setPsaForm((prev) => {
      const next = { ...prev, [field]: value }
      const nraNum = Number(next.nra)
      if (field === 'pricePerNRA') {
        const pricePerNra = Number(value.replace(/[,$]/g, ''))
        if (nraNum > 0 && pricePerNra > 0) {
          const total = nraNum * pricePerNra
          next.totalPrice = total.toFixed(2)
          next.totalPriceWritten = numberToWords(total)
        }
      }
      if (field === 'totalPrice') {
        const total = Number(value.replace(/[,$]/g, ''))
        if (nraNum > 0 && total > 0) {
          next.pricePerNRA = (total / nraNum).toFixed(2)
        }
        next.totalPriceWritten = total > 0 ? numberToWords(total) : ''
      }
      if (field === 'nra') {
        const nraNext = Number(value)
        const pricePerNra = Number((next.pricePerNRA ?? '').replace(/[,$]/g, ''))
        if (nraNext > 0 && pricePerNra > 0) {
          const total = nraNext * pricePerNra
          next.totalPrice = total.toFixed(2)
          next.totalPriceWritten = numberToWords(total)
        }
      }
      // Keep buyer entity in sync when editing buyer fields in the doc
      if (field.startsWith('buyer') && field !== 'buyerSignatory') {
        const map: Record<string, keyof BuyerEntity> = {
          buyerName: 'name',
          buyerAddress: 'address',
          buyerCity: 'city',
          buyerState: 'state',
          buyerZip: 'zip',
        }
        const key = map[field]
        if (key) setBuyerEntity((b) => ({ ...b, [key]: value }))
      }
      return next
    })
  }, [])

  const updateDeedField = useCallback((field: string, value: string) => {
    setDeedForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field.startsWith('grantee')) {
        const map: Record<string, keyof BuyerEntity> = {
          granteeName: 'name',
          granteeAddress: 'address',
          granteeCity: 'city',
          granteeState: 'state',
          granteeZip: 'zip',
        }
        const key = map[field]
        if (key) setBuyerEntity((b) => ({ ...b, [key]: value }))
      }
      return next
    })
  }, [])

  const markOfferSent = useCallback(() => {
    onOfferSent?.(deal.id)
  }, [deal.id, onOfferSent])

  const generatePSA = useCallback(async () => {
    setGeneratingDoc(true)
    try {
      const response = await fetch('/api/generate-psa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(psaForm),
      })
      if (!response.ok) throw new Error('Failed to generate PSA')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${psaForm.sellerName?.replace(/[^a-z0-9]/gi, '_') || 'PSA'}_PSA.docx`
      a.click()
      URL.revokeObjectURL(url)
      setShowPSAModal(false)
      markOfferSent()
    } catch (err) {
      console.error('PSA generation error:', err)
      alert('Failed to generate PSA. Please try again.')
    } finally {
      setGeneratingDoc(false)
    }
  }, [psaForm, markOfferSent])

  const generateDeed = useCallback(async () => {
    setGeneratingDoc(true)
    try {
      const response = await fetch('/api/generate-deed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deedForm),
      })
      if (!response.ok) throw new Error('Failed to generate Deed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${deedForm.grantorName?.replace(/[^a-z0-9]/gi, '_') || 'Deed'}_Mineral_Deed.docx`
      a.click()
      URL.revokeObjectURL(url)
      setShowDeedModal(false)
      markOfferSent()
    } catch (err) {
      console.error('Deed generation error:', err)
      alert('Failed to generate Deed. Please try again.')
    } finally {
      setGeneratingDoc(false)
    }
  }, [deedForm, markOfferSent])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50/60 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-800 mr-1">
          Offer documents
        </span>
        <button
          type="button"
          onClick={() => { setShowFullPackageModal(false); openPSAModal() }}
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50"
        >
          <FileText size={13} /> Generate PSA
        </button>
        <button
          type="button"
          onClick={() => { setShowFullPackageModal(false); openDeedModal() }}
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50"
        >
          <FileText size={13} /> Generate Mineral Deed
        </button>
        <button
          type="button"
          onClick={openFullPackageModal}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
        >
          <Package size={13} /> Full package
        </button>
        <span className="text-[11px] text-blue-700/80 ml-auto hidden sm:inline">
          Edit blue fields, then download .docx
        </span>
      </div>

    {showPSAModal && (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-8">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <div>
              <div className="text-lg font-semibold text-gray-900">Purchase &amp; Sale Agreement</div>
              {showFullPackageModal && (
                <div className="text-xs text-amber-700 mt-0.5">
                  Full package: PSA + Mineral Deed will be generated.
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setShowPSAModal(false)
                  setShowFullPackageModal(false)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (showFullPackageModal) {
                    setDeedForm((prev) => ({
                      ...prev,
                      grantorName: psaForm.sellerName ?? prev.grantorName ?? '',
                      grantorAddress: psaForm.sellerAddress ?? prev.grantorAddress ?? '',
                      grantorCity: psaForm.sellerCity ?? prev.grantorCity ?? '',
                      grantorState: psaForm.sellerState ?? prev.grantorState ?? '',
                      grantorZip: psaForm.sellerZip ?? prev.grantorZip ?? '',
                      granteeName: psaForm.buyerName ?? prev.granteeName ?? '',
                      granteeAddress: psaForm.buyerAddress ?? prev.granteeAddress ?? '',
                      granteeCity: psaForm.buyerCity ?? prev.granteeCity ?? '',
                      granteeState: psaForm.buyerState ?? prev.granteeState ?? '',
                      granteeZip: psaForm.buyerZip ?? prev.granteeZip ?? '',
                      effectiveDate: psaForm.effectiveDate ?? prev.effectiveDate ?? '',
                      legalDescription: psaForm.legalDescription ?? prev.legalDescription ?? '',
                      county: psaForm.county ?? prev.county ?? '',
                    }))
                    void generatePSA().then(() => {
                      setShowDeedModal(true)
                    })
                  } else {
                    void generatePSA()
                  }
                }}
                disabled={generatingDoc}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60"
              >
                {generatingDoc && (
                  <span
                    className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
                    aria-hidden
                  />
                )}
                {generatingDoc
                  ? 'Generating…'
                  : showFullPackageModal
                    ? 'Download PSA & Continue'
                    : 'Download PSA'}
              </button>
            </div>
          </div>

          <div
            className="overflow-y-auto"
            style={{
              maxHeight: '85vh',
              padding: '48px 64px',
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 12,
              lineHeight: 1.8,
              color: '#111827',
            }}
          >
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 24 }}>
              PURCHASE AND SALE AGREEMENT
            </div>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              This Purchase and Sale Agreement (the &ldquo;Agreement&rdquo;) is entered into this{' '}
              <DocField
                value={psaForm.agreementDate ?? ''}
                onChange={(v) => updatePSAField('agreementDate', v)}
                placeholder="Agreement date"
              />{' '}
              but is effective as of{' '}
              <DocField
                value={psaForm.effectiveDate ?? ''}
                onChange={(v) => updatePSAField('effectiveDate', v)}
                placeholder="Effective date"
              />
              , by and between{' '}
              <DocField
                value={psaForm.sellerName ?? ''}
                onChange={(v) => updatePSAField('sellerName', v)}
                placeholder="Seller name"
                minChars={20}
                style={{ fontWeight: 700 }}
              />{' '}
              whose address is{' '}
              <DocField
                value={psaForm.sellerAddress ?? ''}
                onChange={(v) => updatePSAField('sellerAddress', v)}
                placeholder="Seller address"
                minChars={18}
              />
              ,{' '}
              <DocField
                value={psaForm.sellerCity ?? ''}
                onChange={(v) => updatePSAField('sellerCity', v)}
                placeholder="City"
              />
              ,{' '}
              <DocField
                value={psaForm.sellerState ?? ''}
                onChange={(v) => updatePSAField('sellerState', v)}
                placeholder="ST"
                minChars={4}
              />{' '}
              <DocField
                value={psaForm.sellerZip ?? ''}
                onChange={(v) => updatePSAField('sellerZip', v)}
                placeholder="Zip"
                minChars={7}
              />{' '}
              (the &ldquo;Seller&rdquo;), and{' '}
              <DocField
                value={psaForm.buyerName ?? ''}
                onChange={(v) => updatePSAField('buyerName', v)}
                placeholder="Buyer entity name"
                minChars={20}
                style={{ fontWeight: 700 }}
              />
              , whose address is{' '}
              <DocField
                value={psaForm.buyerAddress ?? ''}
                onChange={(v) => updatePSAField('buyerAddress', v)}
                placeholder="Buyer address"
                minChars={18}
              />
              ,{' '}
              <DocField
                value={psaForm.buyerCity ?? ''}
                onChange={(v) => updatePSAField('buyerCity', v)}
                placeholder="City"
              />
              ,{' '}
              <DocField
                value={psaForm.buyerState ?? ''}
                onChange={(v) => updatePSAField('buyerState', v)}
                placeholder="ST"
                minChars={4}
              />{' '}
              <DocField
                value={psaForm.buyerZip ?? ''}
                onChange={(v) => updatePSAField('buyerZip', v)}
                placeholder="Zip"
                minChars={7}
              />{' '}
              (the &ldquo;Buyer&rdquo;).
            </p>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              WHEREAS, Seller owns and desires to sell or assign to Buyer certain oil, gas, mineral
              and/or royalty interests (the &ldquo;Interests&rdquo;) owned in{' '}
              <DocField
                value={psaForm.county ?? ''}
                onChange={(v) => updatePSAField('county', v)}
                placeholder="County"
              />{' '}
              County, Texas, in the subject lands described on the attached Exhibit &ldquo;A.&rdquo;
            </p>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              WHEREAS, Buyer desires to purchase such Interests in the lands described in the attached
              Exhibit &ldquo;A.&rdquo;
            </p>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              NOW THEREFORE, Seller and Buyer have reached an agreement regarding such purchase and
              sale with the following terms and conditions:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', rowGap: 6, marginBottom: 16 }}>
              <div>Purchase Price:</div>
              <div>
                $
                <DocField
                  value={psaForm.totalPrice ?? ''}
                  onChange={(v) => updatePSAField('totalPrice', v)}
                  placeholder="0.00"
                />
              </div>
              <div>Number of Net Royalty Acres:</div>
              <div>
                <DocField
                  value={psaForm.nra ?? ''}
                  onChange={(v) => updatePSAField('nra', v)}
                  placeholder="0.0000"
                />
              </div>
              <div>Closing Date:</div>
              <div>
                On or before{' '}
                <DocField
                  value={psaForm.closingDate ?? ''}
                  onChange={(v) => updatePSAField('closingDate', v)}
                  placeholder="Closing date"
                />
                , or thirty (30) business days after the date which both Seller and Buyer have executed
                the Agreement, whichever is later.
              </div>
              <div>Effective Date:</div>
              <div>
                <DocField
                  value={psaForm.effectiveDate ?? ''}
                  onChange={(v) => updatePSAField('effectiveDate', v)}
                  placeholder="Effective date"
                />
              </div>
            </div>

            {PSA_CLAUSES.slice(0, 3).map((c) => (
              <p key={c.heading} style={{ textAlign: 'justify', marginBottom: 14 }}>
                <span style={{ textDecoration: 'underline' }}>{c.heading}</span>
                {c.body}
              </p>
            ))}

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              <span style={{ textDecoration: 'underline' }}>Calculation of Purchase Price</span>. The
              total purchase price for the Interests shall be{' '}
              <DocField
                value={psaForm.totalPriceWritten ?? ''}
                onChange={(v) => updatePSAField('totalPriceWritten', v)}
                placeholder="WRITTEN OUT AMOUNT"
                minChars={40}
                style={{ fontWeight: 700 }}
              />{' '}
              ($
              <DocField
                value={psaForm.totalPrice ?? ''}
                onChange={(v) => updatePSAField('totalPrice', v)}
                placeholder="0.00"
              />
              ) (the &ldquo;Purchase Price&rdquo;), subject to adjustment as set forth herein, based upon
              the Parties&rsquo; belief that Seller owns{' '}
              <DocField
                value={psaForm.nra ?? ''}
                onChange={(v) => updatePSAField('nra', v)}
                placeholder="0.0000"
              />{' '}
              Net Royalty Acres in the lands described on the attached Exhibit &ldquo;A.&rdquo; For
              purposes of calculating the Purchase Price, &ldquo;Net Royalty Acres&rdquo; shall mean one
              (1) net mineral acre of land subject to an oil and gas lease at a one-eighth (1/8)
              royalty, free and clear of any and all burdens outstanding in third parties. In the event
              Buyer establishes that Seller owns less Net Royalty Acres than set forth above, the
              Purchase Price will accordingly be proportionately reduced.
            </p>

            {PSA_CLAUSES.slice(3).map((c) => (
              <p key={c.heading} style={{ textAlign: 'justify', marginBottom: 14 }}>
                <span style={{ textDecoration: 'underline' }}>{c.heading}</span>
                {c.body}
              </p>
            ))}

            <div style={{ marginTop: 40 }}>
              <div style={{ fontWeight: 700 }}>SELLER:</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>
                <DocField
                  value={psaForm.sellerName ?? ''}
                  onChange={(v) => updatePSAField('sellerName', v)}
                  placeholder="SELLER NAME"
                  minChars={24}
                  style={{ fontWeight: 700, textTransform: 'uppercase' }}
                />
              </div>
              <div style={{ marginTop: 16 }}>___________________________</div>
              <div>Date: _______________________</div>
            </div>

            <div style={{ marginTop: 32 }}>
              <div style={{ fontWeight: 700 }}>BUYER:</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>
                <DocField
                  value={psaForm.buyerName ?? ''}
                  onChange={(v) => updatePSAField('buyerName', v)}
                  placeholder="BUYER ENTITY"
                  minChars={24}
                  style={{ fontWeight: 700, textTransform: 'uppercase' }}
                />
              </div>
              <div style={{ marginTop: 16 }}>___________________________</div>
              <div>
                By:&nbsp;&nbsp;&nbsp;&nbsp;
                <DocField
                  value={psaForm.buyerSignatory ?? ''}
                  onChange={(v) => updatePSAField('buyerSignatory', v)}
                  placeholder="Signatory name"
                  minChars={18}
                />
              </div>
              <div>Title:&nbsp;&nbsp;&nbsp;&nbsp;Managing Member</div>
              <div>Date:&nbsp;&nbsp;______________________</div>
            </div>

            <div style={{ marginTop: 48 }}>
              <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 14 }}>
                EXHIBIT &ldquo;A&rdquo;
              </div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                Attached to and made part of that certain Purchase and Sale Agreement dated{' '}
                <DocField
                  value={psaForm.agreementDate ?? ''}
                  onChange={(v) => updatePSAField('agreementDate', v)}
                  placeholder="Agreement date"
                />
                , by and between{' '}
                <DocField
                  value={psaForm.sellerName ?? ''}
                  onChange={(v) => updatePSAField('sellerName', v)}
                  placeholder="Seller"
                  minChars={18}
                />{' '}
                (the &ldquo;Seller&rdquo;) and{' '}
                <DocField
                  value={psaForm.buyerName ?? ''}
                  onChange={(v) => updatePSAField('buyerName', v)}
                  placeholder="Buyer"
                  minChars={18}
                />{' '}
                (the &ldquo;Buyer&rdquo;).
              </div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>LANDS:</div>
              <DocTextarea
                value={psaForm.legalDescription ?? ''}
                onChange={(v) => updatePSAField('legalDescription', v)}
                placeholder="Legal description / Exhibit A lands"
                rows={5}
              />
              <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 14 }}>
                [END OF EXHIBIT &ldquo;A&rdquo;]
              </div>
            </div>
          </div>

          <div className="sr-only">
            <input
              value={psaForm.operatorName ?? ''}
              onChange={(e) => updatePSAField('operatorName', e.target.value)}
              readOnly
            />
            <input
              value={psaForm.rrcLeaseId ?? ''}
              onChange={(e) => updatePSAField('rrcLeaseId', e.target.value)}
              readOnly
            />
          </div>

          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-xl">
            <button
              onClick={() => {
                setBuyerEntity({
                  name: psaForm.buyerName ?? '',
                  address: psaForm.buyerAddress ?? '',
                  city: psaForm.buyerCity ?? '',
                  state: psaForm.buyerState ?? '',
                  zip: psaForm.buyerZip ?? '',
                })
                try {
                  window.localStorage.setItem(
                    BUYER_ENTITY_STORAGE_KEY,
                    JSON.stringify({
                      name: psaForm.buyerName ?? '',
                      address: psaForm.buyerAddress ?? '',
                      city: psaForm.buyerCity ?? '',
                      state: psaForm.buyerState ?? '',
                      zip: psaForm.buyerZip ?? '',
                    })
                  )
                } catch {
                  // ignore
                }
              }}
              className="text-xs font-medium text-amber-700 hover:text-amber-800"
            >
              Save buyer as default →
            </button>
            <div className="text-xs text-gray-400">Click any blue field to edit</div>
          </div>
        </div>
      </div>
    )}


    {showDeedModal && (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-8">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <div className="text-lg font-semibold text-gray-900">Mineral Deed</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setShowDeedModal(false)
                  setShowFullPackageModal(false)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void generateDeed().then(() => {
                    setShowFullPackageModal(false)
                  })
                }}
                disabled={generatingDoc}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60"
              >
                {generatingDoc && (
                  <span
                    className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
                    aria-hidden
                  />
                )}
                {generatingDoc ? 'Generating…' : 'Download Deed'}
              </button>
            </div>
          </div>

          <div
            className="overflow-y-auto"
            style={{
              maxHeight: '85vh',
              padding: '48px 64px',
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 12,
              lineHeight: 1.8,
              color: '#111827',
            }}
          >
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 24 }}>
              MINERAL DEED
            </div>

            <div style={{ marginBottom: 16 }}>
              <div>STATE OF TEXAS&nbsp;&nbsp;&nbsp;§</div>
              <div>&nbsp;&nbsp;&nbsp;§</div>
              <div>
                COUNTY OF{' '}
                <DocField
                  value={(deedForm.county ?? '').toUpperCase()}
                  onChange={(v) => updateDeedField('county', v)}
                  placeholder="COUNTY"
                  style={{ textTransform: 'uppercase' }}
                />
                &nbsp;&nbsp;&nbsp;§
              </div>
            </div>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              <DocField
                value={deedForm.grantorName ?? ''}
                onChange={(v) => updateDeedField('grantorName', v)}
                placeholder="Grantor name"
                minChars={22}
                style={{ fontWeight: 700 }}
              />
              , whose address is{' '}
              <DocField
                value={deedForm.grantorAddress ?? ''}
                onChange={(v) => updateDeedField('grantorAddress', v)}
                placeholder="Grantor address"
                minChars={18}
              />
              ,{' '}
              <DocField
                value={deedForm.grantorCity ?? ''}
                onChange={(v) => updateDeedField('grantorCity', v)}
                placeholder="City"
              />
              ,{' '}
              <DocField
                value={deedForm.grantorState ?? ''}
                onChange={(v) => updateDeedField('grantorState', v)}
                placeholder="ST"
                minChars={4}
              />{' '}
              <DocField
                value={deedForm.grantorZip ?? ''}
                onChange={(v) => updateDeedField('grantorZip', v)}
                placeholder="Zip"
                minChars={7}
              />{' '}
              (&ldquo;Grantor&rdquo;), for the sum of Ten Dollars ($10.00) and other good and valuable
              consideration, the receipt and sufficiency of which are hereby acknowledged, does hereby
              grant, bargain, sell, transfer, convey, assign and deliver all of Grantor&rsquo;s
              interest in and to the oil, gas, and minerals (the &ldquo;Mineral Interest&rdquo;) in and
              under and that may be produced from the lands as set forth and identified in
              &ldquo;Exhibit A,&rdquo; which is attached to and made a part of this Mineral Deed for
              all purposes (the &ldquo;Lands&rdquo;), to{' '}
              <DocField
                value={deedForm.granteeName ?? ''}
                onChange={(v) => updateDeedField('granteeName', v)}
                placeholder="Grantee name"
                minChars={22}
                style={{ fontWeight: 700 }}
              />
              , whose address is{' '}
              <DocField
                value={deedForm.granteeAddress ?? ''}
                onChange={(v) => updateDeedField('granteeAddress', v)}
                placeholder="Grantee address"
                minChars={18}
              />
              ,{' '}
              <DocField
                value={deedForm.granteeCity ?? ''}
                onChange={(v) => updateDeedField('granteeCity', v)}
                placeholder="City"
              />
              ,{' '}
              <DocField
                value={deedForm.granteeState ?? ''}
                onChange={(v) => updateDeedField('granteeState', v)}
                placeholder="ST"
                minChars={4}
              />{' '}
              <DocField
                value={deedForm.granteeZip ?? ''}
                onChange={(v) => updateDeedField('granteeZip', v)}
                placeholder="Zip"
                minChars={7}
              />{' '}
              (&ldquo;Grantee&rdquo;).
            </p>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              This Mineral Deed is effective for all purposes, including runs of oil and deliveries of
              gas and other hydrocarbons, as of{' '}
              <DocField
                value={deedForm.effectiveDate ?? ''}
                onChange={(v) => updateDeedField('effectiveDate', v)}
                placeholder="Effective date"
              />{' '}
              (the &ldquo;Effective Date&rdquo;). Grantor also conveys to Grantee any and all revenues
              attributable to the Mineral Interest that are held in suspense, unremitted, or otherwise
              unpaid regardless of the Effective Date.
            </p>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              TO HAVE AND TO HOLD the above-described Lands and Mineral Interest, together with all and
              singular the rights and appurtenances thereto and anywise belonging, unto Grantee and
              Grantee&rsquo;s heirs, successors, and assigns forever; and Grantor, their heirs and
              successors warrant and agree to forever defend title to the Lands unto Grantee and
              Grantee&rsquo;s heirs, successors, and assigns against all claims of every person
              claiming or to claim the same or any part thereof.
            </p>

            <p style={{ textAlign: 'justify', marginBottom: 14 }}>
              <span style={{ fontWeight: 700 }}>IN WITNESS WHEREOF</span>, this Mineral Deed is
              executed on the date of acknowledgement, but shall be effective as of the Effective Date
              provided herein.
            </p>

            <div style={{ marginTop: 40 }}>
              <div style={{ fontWeight: 700 }}>GRANTOR:</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>
                <DocField
                  value={deedForm.grantorName ?? ''}
                  onChange={(v) => updateDeedField('grantorName', v)}
                  placeholder="GRANTOR NAME"
                  minChars={24}
                  style={{ fontWeight: 700, textTransform: 'uppercase' }}
                />
              </div>
              <div style={{ marginTop: 16 }}>___________________________</div>
              <div>Date: _______________________</div>
            </div>

            <div style={{ marginTop: 48 }}>
              <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 14 }}>EXHIBIT A</div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                Attached and made a part of that Mineral Deed effective{' '}
                <DocField
                  value={deedForm.effectiveDate ?? ''}
                  onChange={(v) => updateDeedField('effectiveDate', v)}
                  placeholder="Effective date"
                />{' '}
                between{' '}
                <DocField
                  value={deedForm.grantorName ?? ''}
                  onChange={(v) => updateDeedField('grantorName', v)}
                  placeholder="Grantor"
                  minChars={18}
                />{' '}
                (&ldquo;Grantor&rdquo;), and{' '}
                <DocField
                  value={deedForm.granteeName ?? ''}
                  onChange={(v) => updateDeedField('granteeName', v)}
                  placeholder="Grantee"
                  minChars={18}
                />{' '}
                (&ldquo;Grantee&rdquo;).
              </div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>LANDS:</div>
              <DocTextarea
                value={deedForm.legalDescription ?? ''}
                onChange={(v) => updateDeedField('legalDescription', v)}
                placeholder="Legal description / Exhibit A lands"
                rows={5}
              />
              <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 14 }}>
                END OF EXHIBIT A
              </div>
            </div>
          </div>

          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-xl">
            <button
              onClick={() => {
                setBuyerEntity({
                  name: deedForm.granteeName ?? '',
                  address: deedForm.granteeAddress ?? '',
                  city: deedForm.granteeCity ?? '',
                  state: deedForm.granteeState ?? '',
                  zip: deedForm.granteeZip ?? '',
                })
                try {
                  window.localStorage.setItem(
                    BUYER_ENTITY_STORAGE_KEY,
                    JSON.stringify({
                      name: deedForm.granteeName ?? '',
                      address: deedForm.granteeAddress ?? '',
                      city: deedForm.granteeCity ?? '',
                      state: deedForm.granteeState ?? '',
                      zip: deedForm.granteeZip ?? '',
                    })
                  )
                } catch {
                  // ignore
                }
              }}
              className="text-xs font-medium text-amber-700 hover:text-amber-800"
            >
              Save grantee as default →
            </button>
            <div className="text-xs text-gray-400">Click any blue field to edit</div>
          </div>
        </div>
      </div>
    )}

    </>
  )
}
