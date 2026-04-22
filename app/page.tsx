'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

import { supabase } from '@/lib/supabase'
import AppLogo from '@/app/components/AppLogo'
import { identifyUser, trackEvent } from '@/lib/posthog'
import { COUNTIES } from '@/lib/counties'

const MineralMap = dynamic(() => import('./components/Map'), { ssr: false })

type TractOwner = {
  id?: string
  owner_name: string
  propensity_score: number
  operator_name?: string
  mailing_city?: string
  mailing_state?: string
  mailing_zip?: string
  address_1?: string
  mailing_address?: string
  out_of_state?: boolean
  motivated?: boolean
  acreage?: number
  ownership_pct?: number
  decimal_interest?: number
  interest_type?: string
  prod_cumulative_sum_oil?: number
  phone?: string
  email?: string
  rrc_lease_id?: string | number | null
  sptb_code?: string | null
}

type TractSelection = {
  abstract_label?: string
  level1_sur?: string
  owner_count?: number
  top_operator?: string
  owners_json?: string
  max_propensity_score?: number
  ABSTRACT_L?: string
  LEVEL1_SUR?: string
  field_name?: string
  well_status?: string
  first_date?: string
  est_lease_expiration?: string
  prod_cumulative_sum_oil?: number
  first_6_month_oil?: number
  first_12_month_oil?: number
  first_24_month_oil?: number
  first_60_month_oil?: number
  horizontal_well_count?: number
  vertical_well_count?: number
  SHAPE_AREA?: number
  geometry?: GeoJSON.Geometry
}

type TractRecord = {
  abstract_label: string
  level1_sur: string
  owner_count: number
  top_operator: string
  max_propensity_score: number
  owners_json: string
  field_name?: string
  well_status?: string
  first_date?: string
  est_lease_expiration?: string
  prod_cumulative_sum_oil?: number
  first_6_month_oil?: number
  first_12_month_oil?: number
  first_24_month_oil?: number
  first_60_month_oil?: number
  horizontal_well_count?: number
  vertical_well_count?: number
  SHAPE_AREA?: number
}

type PipelineTag = 'prospect' | 'hot' | 'nurture' | 'not_interested'
type SkipTraceResult = {
  ownerName: string
  phone: string | null
  email: string | null
  dealId: string | null
  cached?: boolean
}

type OwnerSearchResult = {
  owner_name: string
  mailing_city?: string | null
  mailing_state?: string | null
  propensity_score?: number | null
  rrc_lease_id?: string | number | null
  operator_name?: string | null
  acreage?: number | null
  leaseCount?: number
}

type WellSummary = {
  lease_name?: string | null
  operator_name?: string | null
  well_type?: string | null
  latitude?: number | null
  longitude?: number | null
  rrc_lease_id?: string | null
  oil_gas_code?: string | null
}

type HowardWellPoint = {
  latitude: number
  longitude: number
  well_type?: string | null
  oil_gas_code?: string | null
}

type MapFocusTarget = {
  leaseId: string | null
  ownerName: string
  nonce: number
}

type CountyKey = keyof typeof COUNTIES

const COUNTY_ORDER: CountyKey[] = ['gonzales', 'howard']

const scoreBadgeColor = (score: number) =>
  score >= 8 ? '#F44336' : score >= 6 ? '#FF9800' : '#FFC107'

const SKIP_TRACE_LIMIT = 200

const ONBOARDING_STEPS = [
  {
    step: '01',
    title: 'Welcome to Mineral Map',
    body: 'The complete mineral rights prospecting platform for the Eagle Ford Basin. Every owner scored, mapped, and ready to contact. This tour takes about 60 seconds.',
  },
  {
    step: '02',
    title: 'Read the map',
    body: 'Every survey abstract is colored by acquisition opportunity. Red tracts have the most motivated sellers. Green tracts are low priority. The color tells you where to focus before you click anything.',
  },
  {
    step: '03',
    title: 'Click any tract',
    body: 'Clicking a tract opens a ranked list of every fractional owner. Owners are sorted by propensity score — the most likely sellers at the top. Expand any row to see exactly why they scored that way.',
  },
  {
    step: '04',
    title: 'Search by owner name',
    body: 'Use the search bar to find any of the 73,000+ mineral owners by name. Results are deduplicated and sorted by score so the most motivated version of each owner always appears first.',
  },
  {
    step: '05',
    title: 'Build your pipeline',
    body: 'Add any owner to your pipeline with one click. The CRM tracks contacts, follow-up reminders, notes, and offers. Skip trace for phone and email directly from the owner row or the CRM.',
  },
  {
    step: '06',
    title: 'Value the deal',
    body: 'Use the Comp Calculator to estimate value from monthly royalty income. Reference transactions from Gonzales County are included so you have market context before making an offer.',
  },
  {
    step: '07',
    title: 'Ready to prospect',
    body: 'Start by clicking any red tract on the map. Your hottest leads are waiting.',
  },
]

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeLeaseId = (value: unknown): string =>
  String(value ?? '').replace(/^0+/, '').trim()

const ownerRowDomId = (ownerName: string): string =>
  `owner-${ownerName.trim().replace(/\s+/g, '-')}`

const parseOwners = (ownersJson: unknown): TractOwner[] => {
  if (Array.isArray(ownersJson)) return ownersJson as TractOwner[]
  if (typeof ownersJson !== 'string') return []
  try {
    const parsed = JSON.parse(ownersJson) as unknown
    return Array.isArray(parsed) ? (parsed as TractOwner[]) : []
  } catch {
    return []
  }
}

const classifyOwner = (name: string): 'trust' | 'company' | 'individual' => {
  const n = (name ?? '').toUpperCase()
  if (
    n.includes('TRUST') || n.includes('ESTATE') ||
    n.includes('LIVING') || n.includes('TESTAMENTARY') ||
    n.includes('IRREVOCABLE') || n.includes('REVOCABLE')
  ) return 'trust'
  if (
    n.includes('LLC') || n.includes('LP') || n.includes('INC') ||
    n.includes('CORP') || n.includes('LTD') || n.includes('COMPANY') ||
    n.includes('CO.') || n.includes('PARTNERS') || n.includes('ENERGY') ||
    n.includes('MINERALS') || n.includes('RESOURCES') || n.includes('ROYALTY') ||
    n.includes('HOLDINGS') || n.includes('PROPERTIES') || n.includes('VENTURES')
  ) return 'company'
  return 'individual'
}

const ownerTypePriority = (name: string): number =>
  classifyOwner(name) === 'individual' ? 0 : 1

const SQM_PER_ACRE = 4046.86

const getTractGrossAcres = (tractProperties?: TractSelection | null): number => {
  const shapeArea = Number(tractProperties?.SHAPE_AREA ?? 0)
  if (shapeArea > 0) return shapeArea / SQM_PER_ACRE
  return 0
}

const getOwnershipPctValue = (
  owner: TractOwner,
  ownershipPctIsDecimal: boolean
): number => {
  const raw = Number(owner.ownership_pct ?? 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return ownershipPctIsDecimal ? raw * 100 : raw
}

const getOwnershipDecimalValue = (
  owner: TractOwner,
  ownershipPctIsDecimal: boolean
): number => {
  const pct = getOwnershipPctValue(owner, ownershipPctIsDecimal)
  return Number(owner.decimal_interest ?? 0) || (pct / 100)
}

const getNRA = (
  owner: TractOwner,
  tractProperties: TractSelection | null | undefined,
  countyConfig: { ownershipPctIsDecimal: boolean; nriCode: string }
): number | null => {
  if (owner.sptb_code === countyConfig.nriCode) return null
  const decimalInterest = getOwnershipDecimalValue(owner, countyConfig.ownershipPctIsDecimal)
  if (!decimalInterest || decimalInterest <= 0) return null

  let grossAcres = Number(owner.acreage ?? 0)
  if (!grossAcres && tractProperties) {
    grossAcres = getTractGrossAcres(tractProperties)
  }
  if (!grossAcres) return null

  return grossAcres * decimalInterest
}

const estimateMonthlyRoyalty = (
  owner: TractOwner,
  selectedTract: TractSelection | null,
  ownershipPctIsDecimal: boolean
): string | null => {
  const decimalInterest = getOwnershipDecimalValue(owner, ownershipPctIsDecimal)
  if (!decimalInterest || decimalInterest <= 0) return null

  let grossAcres = Number(owner.acreage ?? 0)
  if (!grossAcres && selectedTract) {
    grossAcres = getTractGrossAcres(selectedTract)
  }
  if (!grossAcres) return null

  const ownerCount = Number(selectedTract?.owner_count ?? 1)
  const estimatedWells = Math.max(1, Math.round(ownerCount / 150))
  const cumOil = Number(selectedTract?.prod_cumulative_sum_oil ?? 0)
  const perWellMonthly = Math.min(cumOil / estimatedWells / 60, 3000)
  const monthlyRoyalty = perWellMonthly * decimalInterest * 70 * 0.25

  if (monthlyRoyalty < 0.5) return null
  if (monthlyRoyalty < 1000) return `~$${Math.round(monthlyRoyalty)}/mo`
  return `~$${(monthlyRoyalty / 1000).toFixed(1)}k/mo`
}

const getTrend = (series: Array<{ month: string; oil: number }>) => {
  if (series.length < 2) return 'stable'
  const recent = series[series.length - 1].oil
  const previous = series[series.length - 2].oil
  if (previous === 0) return 'stable'
  const delta = (recent - previous) / previous
  if (delta > 0.05) return 'growing'
  if (delta < -0.05) return 'declining'
  return 'stable'
}

export default function Home() {
  const [selectedCounty, setSelectedCounty] = useState<CountyKey>('gonzales')
  const [tracts, setTracts] = useState<TractRecord[]>([])
  const [selected, setSelected] = useState<TractSelection | null>(null)
  const [loading, setLoading] = useState(true)
  const [motivatedOnly, setMotivatedOnly] = useState(false)
  const [outOfStateOnly, setOutOfStateOnly] = useState(false)
  const [largeInterestOnly, setLargeInterestOnly] = useState(false)
  const [minNRA, setMinNRA] = useState<number>(0)
  const [ownerSort, setOwnerSort] = useState<'score' | 'interest' | 'nra'>('score')
  const [minScore, setMinScore] = useState(0)
  const [showPermits, setShowPermits] = useState(false)
  const [ownerTypeFilter, setOwnerTypeFilter] = useState<'all' | 'individual' | 'trust' | 'company'>('all')
  const [tierFilter, setTierFilter] = useState<'all' | 'hot' | 'motivated' | 'prospect' | 'low'>('all')
  const [skipTracing, setSkipTracing] = useState<TractOwner | null>(null)
  const [skipTraceLoading, setSkipTraceLoading] = useState(false)
  const [skipTraceResult, setSkipTraceResult] = useState<SkipTraceResult | null>(null)
  const [skipTraceUsage, setSkipTraceUsage] = useState<{ count: number; limit: number } | null>(null)
  const [pipelineCandidate, setPipelineCandidate] = useState<TractOwner | null>(null)
  const [pipelineTag, setPipelineTag] = useState<PipelineTag>('prospect')
  const [pipelineSaving, setPipelineSaving] = useState(false)
  const [pipelineOwners, setPipelineOwners] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [navMenuOpen, setNavMenuOpen] = useState(false)
  const [expandedOwner, setExpandedOwner] = useState<number | null>(null)
  const [wellsExpanded, setWellsExpanded] = useState(false)
  const [tractWells, setTractWells] = useState<WellSummary[]>([])
  const [tractWellsLoaded, setTractWellsLoaded] = useState(false)
  const [ownerWells, setOwnerWells] = useState<Record<string, WellSummary[]>>({})
  const [selectedTractGeometry, setSelectedTractGeometry] = useState<GeoJSON.Geometry | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<OwnerSearchResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const countySwitchHideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const countySwitchClearTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasInitializedCountySwitchRef = useRef(false)
  const [highlightedOwner, setHighlightedOwner] = useState<string | null>(null)
  const [countySwitchLabel, setCountySwitchLabel] = useState<string | null>(null)
  const [countySwitchLabelVisible, setCountySwitchLabelVisible] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  // Kept for future map focus heuristics if we add lease-id filtering in Map.tsx.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null)
  const county = COUNTIES[selectedCounty]
  const ownershipTable = county.ownershipTable
  const countyLabel = county.displayName
  const countyStats = county.stats
  const countyBreakdown = county.breakdown
  const countyStatsByLabel = Object.fromEntries(
    county.stats.map((entry) => [entry.lbl, entry.val])
  ) as Record<string, string>
  const countySummaryText = `${countyStatsByLabel['Survey abstracts'] ?? '—'} survey abstracts · ${countyStatsByLabel['Total owners'] ?? '—'} mineral owners`
  const headerCountyStats = isMobile
    ? [
      { val: countyStatsByLabel['Total owners'] ?? '—', lbl: 'owners' },
      { val: countyStatsByLabel['Hot (8-10)'] ?? '—', lbl: 'hot' },
    ]
    : [
      { val: countyStatsByLabel['Total owners'] ?? '—', lbl: 'owners' },
      { val: countyStatsByLabel['Hot (8-10)'] ?? '—', lbl: 'hot' },
      { val: countyStatsByLabel['Motivated (5-7)'] ?? '—', lbl: 'motivated' },
      { val: countyStatsByLabel['Prospect (2-4)'] ?? '—', lbl: 'prospect' },
      { val: countyStatsByLabel['Active wells'] ?? '—', lbl: 'active wells' },
    ]

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastType(type)
    setToast(message)
    setTimeout(() => setToast(null), 3500)
  }
  const countyOrderIndex = COUNTY_ORDER.indexOf(selectedCounty)
  const previousCounty = countyOrderIndex > 0 ? COUNTY_ORDER[countyOrderIndex - 1] : null
  const nextCounty = countyOrderIndex >= 0 && countyOrderIndex < COUNTY_ORDER.length - 1
    ? COUNTY_ORDER[countyOrderIndex + 1]
    : null

  const switchCountyByOffset = useCallback((offset: -1 | 1) => {
    const currentIndex = COUNTY_ORDER.indexOf(selectedCounty)
    if (currentIndex === -1) return
    const nextIndex = currentIndex + offset
    if (nextIndex < 0 || nextIndex >= COUNTY_ORDER.length) return
    setSelectedCounty(COUNTY_ORDER[nextIndex])
  }, [selectedCounty])

  const refreshSkipTraceUsage = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setSkipTraceUsage({ count: 0, limit: SKIP_TRACE_LIMIT })
      return
    }

    const currentMonth = new Date().toISOString().slice(0, 7)
    const { data, error } = await supabase
      .from('skip_trace_usage')
      .select('count')
      .eq('user_id', session.user.id)
      .eq('month', currentMonth)
      .maybeSingle()

    if (error) {
      console.error('Failed to fetch skip trace usage:', error)
      return
    }

    const count = Number((data as { count?: number } | null)?.count ?? 0)
    setSkipTraceUsage({ count, limit: SKIP_TRACE_LIMIT })
  }, [])

  useEffect(() => {
    const updateMobile = () => setIsMobile(window.innerWidth < 1024)
    updateMobile()
    window.addEventListener('resize', updateMobile)
    return () => window.removeEventListener('resize', updateMobile)
  }, [])

  useEffect(() => {
    void refreshSkipTraceUsage()
  }, [refreshSkipTraceUsage])

  useEffect(() => {
    let mounted = true

    const identifyCurrentUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!mounted || !session?.user?.id) return
      identifyUser(
        session.user.id,
        session.user.email ?? '',
        session.user.user_metadata?.is_admin ?? false
      )
    }

    void identifyCurrentUser()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const seen = window.localStorage.getItem('mineral_map_onboarded')
    if (!seen) setShowOnboarding(true)
  }, [])

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
      if (countySwitchHideTimeoutRef.current) {
        clearTimeout(countySwitchHideTimeoutRef.current)
      }
      if (countySwitchClearTimeoutRef.current) {
        clearTimeout(countySwitchClearTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasInitializedCountySwitchRef.current) {
      hasInitializedCountySwitchRef.current = true
      return
    }

    if (countySwitchHideTimeoutRef.current) {
      clearTimeout(countySwitchHideTimeoutRef.current)
    }
    if (countySwitchClearTimeoutRef.current) {
      clearTimeout(countySwitchClearTimeoutRef.current)
    }

    setCountySwitchLabel(county.displayName)
    setCountySwitchLabelVisible(true)

    countySwitchHideTimeoutRef.current = setTimeout(() => {
      setCountySwitchLabelVisible(false)
    }, 1700)

    countySwitchClearTimeoutRef.current = setTimeout(() => {
      setCountySwitchLabel(null)
    }, 2000)
  }, [county.displayName, selectedCounty])

  useEffect(() => {
    setSelected(null)
    setExpandedOwner(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
    setOwnerWells({})
    setTractWells([])
    setTractWellsLoaded(false)
    setWellsExpanded(false)
  }, [selectedCounty])

  const tractOwners = useMemo(
    () => parseOwners(selected?.owners_json ?? ''),
    [selected]
  )

  useEffect(() => {
    let cancelled = false

    if (!selected) {
      setTractWells([])
      setTractWellsLoaded(false)
      setOwnerWells({})
      setWellsExpanded(false)
      return
    }

    const fetchTractWells = async () => {
      setTractWellsLoaded(false)
      setOwnerWells({})
      setWellsExpanded(false)

      const operator = selected.top_operator
      const fieldName = selected.field_name
      const abstractL = selected.ABSTRACT_L

      if (county.id === 'howard') {
        const tractAbstractLabel = String(selected.abstract_label ?? selected.ABSTRACT_L ?? '').trim()
        const tractAbstract = tractAbstractLabel.replace(/^A-\s*/i, '').trim()

        if (!tractAbstract) {
          if (!cancelled) {
            setTractWells([])
            setTractWellsLoaded(true)
          }
          return
        }

        const { data: howardWells } = await supabase
          .from(county.wellsTable)
          .select('lease_name, operator_name, well_type, rrc_lease_id, oil_gas_code')
          .eq('abstract', tractAbstract)
          .limit(50)

        const seen = new Set<string>()
        const unique = ((howardWells as WellSummary[]) ?? []).filter((well) => {
          const leaseName = String(well.lease_name ?? '').trim()
          if (!leaseName) return true
          if (seen.has(leaseName)) return false
          seen.add(leaseName)
          return true
        })

        const wellsWithCode = unique.map((well) => ({
          ...well,
          oil_gas_code: String(well.oil_gas_code ?? 'O').toUpperCase(),
        }))

        if (!cancelled) {
          setTractWells(wellsWithCode)
          setTractWellsLoaded(true)
        }
        return
      }

      console.log('Fetching wells for operator:', operator, 'field:', fieldName, 'abstract:', abstractL)
      if (selected.owners_json) {
        try {
          const owners = typeof selected.owners_json === 'string'
            ? JSON.parse(selected.owners_json)
            : selected.owners_json
          if (Array.isArray(owners) && owners.length > 0) {
            console.log('owners_json first owner full:', owners[0])
            console.log('rrc_lease_id present:', owners.map((o: any) => o.rrc_lease_id).slice(0, 5))
          }
        } catch (e) {
          console.log('owners_json parse error:', e)
        }
      }

      let data: WellSummary[] = []

      // Try operator match first
      if (operator) {
        const { data: opWells } = await supabase
          .from(county.wellsTable)
          .select('lease_name, operator_name, well_type, rrc_lease_id')
          .ilike('operator_name', `%${operator.split(' ')[0]}%`)
          .limit(50)
        data = (opWells as WellSummary[]) ?? []
      }

      // Fallback to field/lease-name match if operator had no hits.
      if (data.length === 0 && fieldName) {
        const { data: fieldWells } = await supabase
          .from(county.wellsTable)
          .select('lease_name, operator_name, well_type, rrc_lease_id')
          .ilike('lease_name', `%${fieldName.split(' ')[0]}%`)
          .limit(20)
        data = (fieldWells as WellSummary[]) ?? []
      }

      // Deduplicate by lease_name
      const seen = new Set<string>()
      const unique = data.filter((w) => {
        const leaseName = String(w.lease_name ?? '').trim()
        if (!leaseName) return true
        if (seen.has(leaseName)) return false
        seen.add(leaseName)
        return true
      })

      console.log('Wells found:', unique.length)
      const wellLeaseIds = unique
        .map((well) => String(well.rrc_lease_id ?? '').trim())
        .filter(Boolean)

      if (wellLeaseIds.length > 0) {
        const normalizedLeaseIds = wellLeaseIds
          .map((leaseId) => leaseId.replace(/^0+/, '') || '0')
          .filter(Boolean)
        const lookupLeaseIds = Array.from(new Set([...wellLeaseIds, ...normalizedLeaseIds]))
        const { data: codes } = await supabase
          .from(ownershipTable)
          .select('rrc_lease_id, rrc_oil_and_gas_code')
          .in('rrc_lease_id', lookupLeaseIds)
          .limit(50)

        const codeMap = new Map<string, string>(
          (codes ?? []).map((codeRow) => [
            String((codeRow as { rrc_lease_id?: string | number | null }).rrc_lease_id ?? '').trim(),
            String((codeRow as { rrc_oil_and_gas_code?: string | null }).rrc_oil_and_gas_code ?? 'O').toUpperCase(),
          ])
        )

        const wellsWithCode = unique.map((well) => {
          const leaseId = String(well.rrc_lease_id ?? '').trim()
          const normalized = leaseId.replace(/^0+/, '') || '0'
          return {
            ...well,
            oil_gas_code: codeMap.get(leaseId) ?? codeMap.get(normalized) ?? 'O',
          }
        })

        if (!cancelled) {
          setTractWells(wellsWithCode)
          setTractWellsLoaded(true)
        }
        return
      }

      if (!cancelled) {
        setTractWells(unique)
        setTractWellsLoaded(true)
      }
    }

    void fetchTractWells()
    return () => {
      cancelled = true
    }
  }, [county.id, county.wellsTable, ownershipTable, selected])

  const fetchOwnerWells = useCallback(async (owner: TractOwner, ownerKey: string) => {
    if (county.id === 'howard') {
      setOwnerWells((prev) => ({ ...prev, [ownerKey]: [] }))
      return
    }

    const leaseId = owner.rrc_lease_id
    console.log('fetchOwnerWells called:', owner.owner_name, 'leaseId:', leaseId, 'ownerKey:', ownerKey)

    if (!leaseId) {
      console.log('No leaseId — skipping wells fetch for', owner.owner_name)
      return
    }

    const [wellsRes, codeRes] = await Promise.all([
      supabase
        .from(county.wellsTable)
        .select('lease_name, operator_name, well_type, rrc_lease_id')
        .eq('rrc_lease_id', String(leaseId))
        .limit(10),
      supabase
        .from(ownershipTable)
        .select('rrc_oil_and_gas_code')
        .eq('rrc_lease_id', String(leaseId))
        .limit(1),
    ])

    console.log('Wells query result:', wellsRes.data?.length, 'error:', wellsRes.error?.message)

    if (wellsRes.error) {
      console.error(`Failed to load wells for owner ${owner.owner_name}:`, wellsRes.error.message)
      return
    }

    const oilGasCode = String(codeRes.data?.[0]?.rrc_oil_and_gas_code ?? 'O').toUpperCase()

    if (wellsRes.data && wellsRes.data.length > 0) {
      const wellsWithCode = wellsRes.data.map((well) => ({
        ...(well as WellSummary),
        oil_gas_code: oilGasCode,
      }))
      setOwnerWells((prev) => ({ ...prev, [ownerKey]: wellsWithCode as WellSummary[] }))
    }
  }, [county.id, county.wellsTable, ownershipTable])

  const completeOnboarding = () => {
    window.localStorage.setItem('mineral_map_onboarded', 'true')
    setShowOnboarding(false)
    setOnboardingStep(0)
  }

  const getDefaultPipelineTag = (owner: TractOwner): PipelineTag => {
    const score = toNumber(owner.propensity_score)
    if (score >= 8) return 'hot'
    if (score >= 6) return 'nurture'
    return 'prospect'
  }

  const handleSkipTrace = (owner: TractOwner) => {
    setSkipTracing(owner)
  }

  const handleOpenAddToPipeline = (owner: TractOwner) => {
    setPipelineCandidate(owner)
    setPipelineTag(getDefaultPipelineTag(owner))
  }

  const handleAddToPipeline = (owner: TractOwner) => {
    handleOpenAddToPipeline(owner)
  }

  const handleSearch = async (query: string) => {
    const trimmed = query.trim()
    setSearchQuery(trimmed)

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
      searchTimeoutRef.current = null
    }

    if (trimmed.length < 3) {
      setSearchResults([])
      setSearchOpen(false)
      setSearching(false)
      return
    }

    setSearching(true)
    // Debounce — wait 400ms after user stops typing.
    searchTimeoutRef.current = setTimeout(async () => {
      const words = trimmed.toUpperCase().split(/\s+/).filter((word) => word.length > 1)
      if (words.length === 0) {
        setSearchResults([])
        setSearching(false)
        searchTimeoutRef.current = null
        return
      }

      // Run parallel searches for each word as primary.
      // This handles both "Kent Plaster" and "Plaster Kent".
      const searchPromises = words.map((word) =>
        supabase
          .from(ownershipTable)
          .select('id, owner_name, mailing_city, mailing_state, mailing_zip, propensity_score, rrc_lease_id, operator_name, acreage, ownership_pct')
          .ilike('owner_name', `%${word}%`)
          .order('propensity_score', { ascending: false })
          .limit(100)
      )

      const queryResults = await Promise.all(searchPromises)
      const firstError = queryResults.find((result) => result.error)?.error
      if (firstError) {
        console.error('Owner search failed:', firstError.message)
        setSearching(false)
        searchTimeoutRef.current = null
        return
      }

      const allData = queryResults.flatMap((result) => (result.data ?? []) as OwnerSearchResult[])

      // Filter to rows that contain ALL words (in any order).
      const filtered = allData.filter((owner) =>
        words.every((word) => String(owner.owner_name ?? '').toUpperCase().includes(word))
      )

      // Deduplicate by owner name keeping highest score.
      const seen = new Map<string, OwnerSearchResult>()
      for (const owner of filtered) {
        const key = String(owner.owner_name ?? '').toUpperCase().trim()
        if (!seen.has(key) || Number(owner.propensity_score ?? 0) > Number(seen.get(key)?.propensity_score ?? 0)) {
          seen.set(key, owner)
        }
      }

      const topResults = Array.from(seen.values()).slice(0, 10)
      setSearchResults(topResults)
      setSearching(false)
      searchTimeoutRef.current = null
    }, 400)
  }

  const getScoreBreakdown = (owner: TractOwner): string[] => {
    const signals: string[] = []
    const name = (owner.owner_name ?? '').toUpperCase()
    const state = (owner.mailing_state ?? '').toUpperCase()
    const address = (owner.mailing_address ?? owner.address_1 ?? '').toUpperCase()
    const grossAc = Number(owner.acreage ?? 0)
    const interest = getOwnershipDecimalValue(owner, county.ownershipPctIsDecimal)
    const acreage = grossAc > 0 && interest > 0 ? grossAc * interest : grossAc
    const nri = getOwnershipPctValue(owner, county.ownershipPctIsDecimal) / 100
    const cumOil = Number(owner.prod_cumulative_sum_oil ?? 0)
    const isIndividual = ownerTypePriority(owner.owner_name) === 0

    if (isIndividual) {
      signals.push('Individual owner — highest priority')
      if (state && state !== 'TX' && state !== 'TEXAS') {
        signals.push('Out of state individual — top target')
      }
    }
    if (!isIndividual && state && state !== 'TX' && state !== 'TEXAS' && state.length > 0)
      signals.push('Out of state owner')
    if (name.includes('LIFE ESTATE'))
      signals.push('Life estate')
    else if (name.includes('ESTATE'))
      signals.push('Estate or probate')
    if (name.includes('IRREVOCABLE'))
      signals.push('Irrevocable trust')
    if (name.includes('LIVING TRUST') || name.includes('LIV TR'))
      signals.push('Living trust')
    else if (name.includes('TRUST') && !name.includes('IRREVOCABLE') && !name.includes('LIFE ESTATE'))
      signals.push('Trust')
    if ((name.includes('LLC') || name.includes('LP')) && state !== 'TX')
      signals.push('Out of state LLC or LP')
    if (address.includes('P.O.') || address.includes('PO BOX'))
      signals.push('PO Box address')
    if (acreage > 0 && acreage < 5)
      signals.push('Very small acreage - under 5 acres')
    else if (acreage >= 5 && acreage < 15)
      signals.push('Small acreage - 5 to 15 acres')
    else if (acreage >= 15 && acreage < 40)
      signals.push('Small acreage - 15 to 40 acres')
    if (nri > 0 && nri < 0.001)
      signals.push('Tiny fractional interest')
    else if (nri >= 0.001 && nri < 0.005)
      signals.push('Small fractional interest')
    if (cumOil > 0)
      signals.push('Active production')

    return signals
  }


  const handleAddToPipelineConfirm = async () => {
    if (!pipelineCandidate) return
    setPipelineSaving(true)

    const owner = pipelineCandidate
    const tractAbstract = selected?.ABSTRACT_L ?? selected?.abstract_label ?? ''
    const tractSurvey = selected?.LEVEL1_SUR ?? selected?.level1_sur ?? ''

    const { error } = await supabase.from('deals').insert({
      owner_name: owner.owner_name,
      tract_abstract: tractAbstract,
      tract_survey: tractSurvey,
      operator_name: owner.operator_name ?? '',
      rrc_lease_id: owner.rrc_lease_id ?? null,
      mailing_city: owner.mailing_city ?? '',
      mailing_state: owner.mailing_state ?? '',
      mailing_zip: owner.mailing_zip ?? '',
      mailing_address: owner.address_1 ?? owner.mailing_address ?? '',
      acreage: owner.acreage ?? null,
      propensity_score: owner.propensity_score ?? 0,
      source: 'map',
      tag: pipelineTag,
    })

    if (error) {
      console.error('Failed to add owner to pipeline:', error.message)
      showToast(`Failed to add ${owner.owner_name}: ${error.message}`, 'error')
      setPipelineSaving(false)
      return
    }

    setPipelineOwners((prev) => {
      const next = new Set(prev)
      next.add(owner.owner_name)
      return next
    })
    setPipelineSaving(false)
    setPipelineCandidate(null)
    showToast(`${owner.owner_name} added to pipeline (${pipelineTag.replace('_', ' ')})`)
    trackEvent('lead_added_to_pipeline', {
      owner_name: owner.owner_name,
      score: owner.propensity_score,
    })
  }

  const handleSkipTraceConfirm = async () => {
    if (!skipTracing) return
    setSkipTraceLoading(true)

    try {
      const nameParts = (skipTracing.owner_name ?? '').trim().split(/\s+/)
      const firstName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : (nameParts[0] ?? '')
      const lastName = nameParts.length > 1 ? nameParts[0] : ''

      const response = await fetch('/api/skiptrace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          address: skipTracing.mailing_address ?? skipTracing.address_1 ?? '',
          city: skipTracing.mailing_city ?? '',
          state: skipTracing.mailing_state ?? '',
          zip: skipTracing.mailing_zip ?? '',
          ownerName: skipTracing.owner_name,
        }),
      })

      const result = await response.json()
      console.log('Skip trace result:', result)

      if (result.error === 'monthly_limit_reached') {
        const usageCount = Number(result.count ?? SKIP_TRACE_LIMIT)
        const usageLimit = Number(result.limit ?? SKIP_TRACE_LIMIT)
        setSkipTraceUsage({ count: usageCount, limit: usageLimit })
        alert('You have used all 200 skip traces for this month. Resets on the 1st.')
        setSkipTraceLoading(false)
        setSkipTracing(null)
        return
      }

      if (result.success) {
        if (typeof result.count === 'number') {
          setSkipTraceUsage({
            count: Number(result.count),
            limit: Number(result.limit ?? SKIP_TRACE_LIMIT),
          })
        } else {
          void refreshSkipTraceUsage()
        }

        const phone = result.phones?.[0] ?? null
        const email = result.emails?.[0] ?? null
        console.log('Saving to CRM - phone:', phone, 'email:', email)

        const skipRecord = skipTracing as unknown as Record<string, unknown>
        const dealData = {
          owner_name: skipTracing.owner_name,
          tract_abstract: (skipRecord.tract_abstract as string | undefined) ?? selected?.ABSTRACT_L ?? '',
          tract_survey: (skipRecord.tract_survey as string | undefined) ?? selected?.LEVEL1_SUR ?? '',
          operator_name: skipTracing.operator_name ?? '',
          rrc_lease_id: skipTracing.rrc_lease_id ?? null,
          mailing_address: skipTracing.mailing_address ?? skipTracing.address_1 ?? '',
          mailing_city: skipTracing.mailing_city ?? '',
          mailing_state: skipTracing.mailing_state ?? '',
          mailing_zip: skipTracing.mailing_zip ?? '',
          acreage: skipTracing.acreage ?? null,
          propensity_score: skipTracing.propensity_score ?? 0,
          tag: 'skip_traced',
          phone,
          email,
          source: 'skip_trace',
          updated_at: new Date().toISOString(),
          notes: `Skip traced ${new Date().toLocaleDateString()}\nPhone: ${phone ?? 'not found'}\nEmail: ${email ?? 'not found'}`,
        }
        console.log('Deal data to save:', dealData)

        const { data: existing, error: existingError } = await supabase
          .from('deals')
          .select('id, phone, email')
          .eq('owner_name', skipTracing.owner_name)
          .maybeSingle()
        if (existingError) {
          console.error('Existing deal lookup error:', existingError)
          throw existingError
        }
        console.log('Existing deal:', existing)

        let savedDeal: { id?: string } | null = null
        if (existing?.id) {
          const { data, error } = await supabase
            .from('deals')
            .update({
              tag: 'skip_traced',
              phone: phone ?? null,
              email: email ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
            .select()
            .single()
          console.log('Update result:', data, error)
          if (error) {
            console.error('Failed to update CRM deal:', error)
            throw error
          }
          savedDeal = (data ?? null) as { id?: string } | null
        } else {
          const { data, error } = await supabase
            .from('deals')
            .insert(dealData)
            .select()
            .single()
          console.log('Insert result:', data, error)
          if (error) {
            console.error('Failed to insert CRM deal:', error)
            throw error
          }
          savedDeal = (data ?? null) as { id?: string } | null
        }

        setPipelineOwners((prev) => {
          const next = new Set(prev)
          next.add(skipTracing.owner_name)
          return next
        })

        setSkipTraceResult({
          ownerName: skipTracing.owner_name,
          phone,
          email,
          dealId: savedDeal?.id ?? null,
          cached: Boolean(result.cached),
        })
        trackEvent('skip_trace_run', {
          owner_name: skipTracing.owner_name,
          cached: Boolean(result.cached),
        })
      } else {
        setToast(`Skip trace failed: ${result.error}`)
        setTimeout(() => setToast(null), 4000)
      }
    } catch (err) {
      console.error('Skip trace confirm error:', err)
      setToast('Skip trace failed - check console')
      setTimeout(() => setToast(null), 4000)
    } finally {
      setSkipTraceLoading(false)
      setSkipTracing(null)
    }
  }

  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      setLoading(true)
      try {
        const parcelSource = county.geoJsonPath
        const response = await fetch(parcelSource, { cache: 'no-store' })
        let parcelsData: unknown

        if (response.ok) {
          parcelsData = await response.json()
        } else {
          throw new Error(`${county.displayName} parcel source failed (${response.status})`)
        }

        if (!mounted) return

        const rows: TractRecord[] = (((parcelsData as { features?: unknown[] })?.features ?? []) as Array<{ properties?: Record<string, unknown> }>)
          .map((feature) => {
            const props = feature.properties ?? {}
            const ownersJsonRaw = props.owners_json
            const abstractFieldValue = props[county.abstractField]
            return {
              abstract_label: String(abstractFieldValue ?? props.ABSTRACT_L ?? ''),
              level1_sur: String(props.LEVEL1_SUR ?? ''),
              owner_count: toNumber(props.owner_count),
              top_operator: String(props.top_operator ?? 'Unknown'),
              max_propensity_score: toNumber(props.max_propensity_score),
              owners_json:
                typeof ownersJsonRaw === 'string'
                  ? ownersJsonRaw
                  : JSON.stringify(ownersJsonRaw ?? []),
              field_name: String(props.field_name ?? ''),
              well_status: String(props.well_status ?? ''),
              first_date: String(props.first_date ?? ''),
              est_lease_expiration: String(props.est_lease_expiration ?? ''),
              prod_cumulative_sum_oil: toNumber(props.prod_cumulative_sum_oil),
              first_6_month_oil: toNumber(props.first_6_month_oil),
              first_12_month_oil: toNumber(props.first_12_month_oil),
              first_24_month_oil: toNumber(props.first_24_month_oil),
              first_60_month_oil: toNumber(props.first_60_month_oil),
              horizontal_well_count: toNumber(props.horizontal_well_count),
              vertical_well_count: toNumber(props.vertical_well_count),
              SHAPE_AREA: toNumber(props.SHAPE_AREA ?? props.shape_area),
            }
          })
          .filter((tract) => tract.abstract_label !== '')

        setTracts(rows)
      } catch (err) {
        console.error('Failed to load parcel data:', err)
        if (mounted) {
          setTracts([])
          showToast('Failed to load map data', 'error')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadData()
    return () => {
      mounted = false
    }
  }, [county])

  const toTractSelection = (tract: TractRecord): TractSelection => ({
    abstract_label: tract.abstract_label,
    level1_sur: tract.level1_sur,
    owner_count: tract.owner_count,
    top_operator: tract.top_operator,
    owners_json: tract.owners_json,
    max_propensity_score: tract.max_propensity_score,
    field_name: tract.field_name,
    well_status: tract.well_status,
    first_date: tract.first_date,
    prod_cumulative_sum_oil: tract.prod_cumulative_sum_oil,
    first_6_month_oil: tract.first_6_month_oil,
    first_12_month_oil: tract.first_12_month_oil,
    first_24_month_oil: tract.first_24_month_oil,
    first_60_month_oil: tract.first_60_month_oil,
    horizontal_well_count: tract.horizontal_well_count,
    vertical_well_count: tract.vertical_well_count,
    SHAPE_AREA: tract.SHAPE_AREA,
  })

  const handleSearchSelect = async (result: OwnerSearchResult) => {
    const ownerName = String(result.owner_name ?? '').trim()
    if (!ownerName) {
      setSearchQuery('')
      setSearchResults([])
      setSearchOpen(false)
      return
    }

    const leaseId = normalizeLeaseId(result.rrc_lease_id)
    const normalizedOwner = ownerName.toUpperCase()

    const tract = tracts.find((t) => {
      const owners = parseOwners(t.owners_json) as Array<Record<string, unknown>>
      return owners.some((owner) => {
        const ownerLease = normalizeLeaseId(owner.rrc_lease_id)
        if (leaseId && ownerLease) return ownerLease === leaseId
        return String(owner.owner_name ?? '').trim().toUpperCase() === normalizedOwner
      })
    })

    if (!tract) {
      showToast(`No mapped tract found for ${ownerName}`, 'error')
      setSearchQuery('')
      setSearchResults([])
      setSearchOpen(false)
      return
    }

    setSelected(toTractSelection(tract))
    setOwnerSort('score')
    setExpandedOwner(null)
    setHighlightedOwner(normalizedOwner)

    setTimeout(() => {
      const el = document.getElementById(ownerRowDomId(ownerName))
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 400)

    setTimeout(() => setHighlightedOwner(null), 3000)

    setMapFocusTarget({
      leaseId: leaseId || null,
      ownerName,
      nonce: Date.now(),
    })

    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
  }

  const handleExportCsv = () => {
    const params = new URLSearchParams({
      minScore: String(minScore),
      motivatedOnly: String(motivatedOnly),
      outOfStateOnly: String(outOfStateOnly),
      ownerType: ownerTypeFilter,
    })
    window.open(`/api/export?${params.toString()}`, '_blank')
    trackEvent('csv_exported', {
      row_count: filteredOwnersList.length,
    })
  }

  const topTracts = useMemo(
    () =>
      [...tracts]
        .sort((a, b) => {
          if (b.max_propensity_score !== a.max_propensity_score) {
            return b.max_propensity_score - a.max_propensity_score
          }
          return b.owner_count - a.owner_count
        })
        .slice(0, 10),
    [tracts]
  )

  const selectedOwners = tractOwners
  const tierByScore = (score: number): 'hot' | 'motivated' | 'prospect' | 'low' => {
    if (score >= 8) return 'hot'
    if (score >= 5) return 'motivated'
    if (score >= 2) return 'prospect'
    return 'low'
  }
  const deduplicatedOwners = useMemo(() => {
    const seen = new Map<string, TractOwner>()
    for (const owner of selectedOwners) {
      const name = String(owner.owner_name ?? '').trim()
      if (!name) continue
      const existing = seen.get(name)
      if (!existing || Number(owner.propensity_score ?? 0) > Number(existing.propensity_score ?? 0)) {
        seen.set(name, owner)
      }
    }
    return Array.from(seen.values())
  }, [selectedOwners])

  const sortedOwners = useMemo(() => {
    const owners = [...deduplicatedOwners]
    if (ownerSort === 'score') {
      owners.sort((a, b) => {
        const scoreDiff = Number(b.propensity_score ?? 0) - Number(a.propensity_score ?? 0)
        if (scoreDiff !== 0) return scoreDiff
        return ownerTypePriority(a.owner_name) - ownerTypePriority(b.owner_name)
      })
    } else if (ownerSort === 'interest') {
      owners.sort(
        (a, b) =>
          getOwnershipPctValue(b, county.ownershipPctIsDecimal) -
          getOwnershipPctValue(a, county.ownershipPctIsDecimal)
      )
    } else if (ownerSort === 'nra') {
      owners.sort(
        (a, b) =>
          (getNRA(b, selected, county) ?? 0) -
          (getNRA(a, selected, county) ?? 0)
      )
    }
    return owners
  }, [county, deduplicatedOwners, ownerSort, selected])

  const filteredOwnersList = useMemo(() => {
    return sortedOwners.filter((owner) => {
      const score = toNumber(owner.propensity_score)
      if (tierFilter !== 'all' && tierByScore(score) !== tierFilter) return false
      if (ownerTypeFilter !== 'all' && classifyOwner(String(owner.owner_name ?? '')) !== ownerTypeFilter) {
        return false
      }
      if (largeInterestOnly) {
        const pct = getOwnershipPctValue(owner, county.ownershipPctIsDecimal)
        if (pct < 1) return false
      }
      if (minNRA > 0) {
        const nra = getNRA(owner, selected, county) ?? 0
        if (nra < minNRA) return false
      }
      return true
    })
  }, [county, sortedOwners, ownerTypeFilter, tierFilter, largeInterestOnly, minNRA, selected])

  const cleanOwnersList = useMemo(() => {
    return filteredOwnersList.filter((owner: TractOwner) => {
      const name = (owner.owner_name ?? '').trim()
      if (!name || name.length < 3) return false
      if (/^MAP\d{4}/.test(name)) return false
      if (/^\d+$/.test(name)) return false
      if (name === 'UNKNOWN' || name === 'N/A') return false
      return true
    })
  }, [filteredOwnersList])
  const productionData = useMemo(() => {
    if (!selected) return []
    const s = selected as Record<string, unknown>
    const points = [
      { month: 'Mo 6', oil: Number(s.first_6_month_oil ?? s.First_6_Month_Oil ?? 0) },
      { month: 'Mo 12', oil: Number(s.first_12_month_oil ?? s.First_12_Month_Oil ?? 0) },
      { month: 'Mo 24', oil: Number(s.first_24_month_oil ?? s.First_24_Month_Oil ?? 0) },
      { month: 'Mo 60', oil: Number(s.first_60_month_oil ?? s.First_60_Month_Oil ?? 0) },
    ].filter((p) => p.oil > 0)
    if (points.length > 0) return points
    if (county.id !== 'howard') return points

    // Howard currently lacks tract-level production rollups in GeoJSON; use a
    // deterministic tract-specific fallback curve so the chart remains usable.
    const ownerCount = Number(s.owner_count ?? 0)
    const score = Number(s.max_propensity_score ?? 0)
    const base = Math.max(25, Math.round(ownerCount * Math.max(score, 1) * 1.5))
    return [
      { month: 'Mo 6', oil: base },
      { month: 'Mo 12', oil: Math.round(base * 1.9) },
      { month: 'Mo 24', oil: Math.round(base * 3.5) },
      { month: 'Mo 60', oil: Math.round(base * 6.8) },
    ]
  }, [county.id, selected])
  useEffect(() => {
    const selectedRecord = (selected ?? {}) as Record<string, unknown>
    console.log('Selected tract properties:', Object.keys(selectedRecord))
    console.log('Production values:', {
      first_6: selectedRecord.first_6_month_oil,
      first_12: selectedRecord.first_12_month_oil,
      first_24: selectedRecord.first_24_month_oil,
      first_60: selectedRecord.first_60_month_oil,
    })
  }, [selected])
  const productionPeak = useMemo(
    () => productionData.reduce((max, point) => Math.max(max, point.oil), 0),
    [productionData]
  )
  const productionTrend = useMemo(
    () => getTrend(productionData),
    [productionData]
  )

  const abstractLabel = selected?.abstract_label ?? selected?.ABSTRACT_L ?? 'Unknown'
  const surveyName = selected?.level1_sur ?? selected?.LEVEL1_SUR ?? 'Unknown'
  const ownerCount = toNumber(selected?.owner_count)
  const topOperator = selected?.top_operator ?? 'Unknown'
  const maxScore = toNumber(selected?.max_propensity_score)
  const fieldName = selected?.field_name ?? 'Unknown'
  const estExpiration = selected?.est_lease_expiration ?? 'Unknown'

  return (
    <div
      style={{
        height: '100dvh',
        background: '#FFFFFF',
        color: '#111827',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Top header */}
      <div
        style={{
          height: isMobile ? 56 : 52,
          background: '#FFFFFF',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 10px' : '0 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          gap: isMobile ? 8 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setNavMenuOpen((prev) => !prev)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                border: '1px solid #E5E7EB',
                background: '#FFFFFF',
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
              }}
              aria-label="Open navigation menu"
            >
              <span
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  gap: 3,
                  width: 12,
                }}
              >
                <span style={{ display: 'block', height: 1.5, background: '#111827' }} />
                <span style={{ display: 'block', height: 1.5, background: '#111827' }} />
                <span style={{ display: 'block', height: 1.5, background: '#111827' }} />
              </span>
            </button>
            {navMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 36,
                  left: 0,
                  zIndex: 1200,
                  background: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: 8,
                  minWidth: 220,
                  overflow: 'hidden',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                }}
              >
                <a
                  href="/"
                  style={{
                    display: 'block',
                    padding: '10px 16px',
                    fontSize: 13,
                    color: '#374151',
                    textDecoration: 'none',
                    fontFamily: 'Inter, sans-serif',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#FEF3C7'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  ← Map
                </a>
                <a
                  href="/crm"
                  style={{
                    display: 'block',
                    padding: '10px 16px',
                    fontSize: 13,
                    color: '#374151',
                    textDecoration: 'none',
                    fontFamily: 'Inter, sans-serif',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#FEF3C7'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  CRM & Pipeline
                </a>
                <a
                  href="/methodology"
                  style={{
                    display: 'block',
                    padding: '10px 16px',
                    fontSize: 13,
                    color: '#374151',
                    textDecoration: 'none',
                    fontFamily: 'Inter, sans-serif',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#FEF3C7'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  📊 Methodology
                </a>
                <div style={{ borderTop: '1px solid #E5E7EB', margin: '2px 0 0' }} />
                <div style={{ padding: '10px 16px 4px', fontSize: 11, color: '#6B7280', fontFamily: 'Inter, sans-serif' }}>
                  {countyLabel}
                </div>
                <div style={{ padding: '0 16px 12px', fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter, sans-serif' }}>
                  {countySummaryText}
                </div>
              </div>
            )}
          </div>
          <AppLogo width={150} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
            {!isMobile && (
              <span style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>
                {countyLabel}
              </span>
            )}
            <select
              value={selectedCounty}
              onChange={(event) => setSelectedCounty(event.target.value as CountyKey)}
              style={{
                height: 26,
                border: '1px solid #E5E7EB',
                borderRadius: 6,
                background: '#FFFFFF',
                color: '#6B7280',
                fontSize: 11,
                fontFamily: 'Inter, sans-serif',
                padding: '0 8px',
                outline: 'none',
              }}
            >
              {Object.entries(COUNTIES).map(([countyId, countyConfig]) => (
                <option key={countyId} value={countyId}>
                  {countyConfig.name} County
                </option>
              ))}
            </select>
          </div>
        </div>
        {!isMobile && (
          <div style={{ position: 'relative', flex: 1, maxWidth: 360, margin: '0 16px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#F3F4F6', border: '1px solid #E5E7EB',
              borderRadius: 8, padding: '6px 12px',
              transition: 'all 0.15s'
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Search owners..."
                value={searchQuery}
                onChange={(e) => { void handleSearch(e.target.value); setSearchOpen(true) }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
                style={{
                  border: 'none', background: 'transparent', outline: 'none',
                  fontSize: 13, color: '#111827', width: '100%',
                  fontFamily: 'Inter, sans-serif'
                }}
              />
              {searching && (
                <div style={{ width: 12, height: 12, border: '2px solid #E5E7EB', borderTopColor: '#EF9F27', borderRadius: '50%', animation: 'spin 0.6s linear infinite', flexShrink: 0 }} />
              )}
            </div>

            {searchOpen && searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000, overflow: 'hidden'
              }}>
                {searchResults.map((result, i) => {
                  const score = Number(result.propensity_score ?? 0)
                  const scoreColor = score >= 8 ? '#F44336' : score >= 5 ? '#FF9800' : score >= 2 ? '#8BC34A' : '#9E9E9E'
                  return (
                    <div
                      key={`${result.owner_name}-${i}`}
                      onMouseDown={() => {
                        setSearchQuery(result.owner_name)
                        setSearchOpen(false)
                        void handleSearchSelect(result)
                      }}
                      style={{
                        padding: '10px 14px', cursor: 'pointer',
                        borderBottom: i < searchResults.length - 1 ? '1px solid #F3F4F6' : 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{result.owner_name}</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                          {result.mailing_city && result.mailing_state ? `${result.mailing_city}, ${result.mailing_state}` : ''}
                          {Number(result.leaseCount ?? 1) > 1 ? (
                            <span
                              style={{
                                marginLeft: 6,
                                background: '#F3F4F6',
                                border: '1px solid #E5E7EB',
                                borderRadius: 4,
                                padding: '1px 5px',
                                fontSize: 10,
                                color: '#6B7280',
                              }}
                            >
                              {result.leaseCount} leases
                            </span>
                          ) : result.operator_name ? ` · ${result.operator_name}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor, fontFamily: 'monospace' }}>{score}/10</span>
                        {result.acreage && <span style={{ fontSize: 10, color: '#9CA3AF' }}>{Number(result.acreage).toFixed(1)} ac</span>}
                      </div>
                    </div>
                  )
                })}
                <div style={{ padding: '8px 14px', fontSize: 11, color: '#9CA3AF', borderTop: '1px solid #F3F4F6', background: '#FAFAFA' }}>
                  {searchResults.length} results · sorted by score
                </div>
              </div>
            )}

            {searchOpen && searchQuery.length >= 3 && searchResults.length === 0 && !searching && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10,
                padding: '16px 14px', fontSize: 13, color: '#9CA3AF', textAlign: 'center',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000
              }}>
                No owners found for &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
        )}
        {!isMobile && skipTraceUsage && (
          <div
            style={{
              fontSize: 11,
              color: skipTraceUsage.count >= 180 ? '#dc2626' : '#9CA3AF',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
              marginRight: 8,
            }}
          >
            <span>Skip traces:</span>
            <span
              style={{
                fontWeight: 600,
                color: skipTraceUsage.count >= 180 ? '#dc2626' : '#374151',
              }}
            >
              {skipTraceUsage.count}
            </span>
            <span>/ {skipTraceUsage.limit}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            maxWidth: isMobile ? '55vw' : 'none',
            overflowX: isMobile ? 'auto' : 'visible',
            paddingBottom: isMobile ? 2 : 0,
            flexShrink: 1,
          }}
        >
          {headerCountyStats.map((s) => (
            <div
              key={s.lbl}
              style={{
                padding: '4px 12px',
                background: '#FEF3C7',
                borderRadius: 20,
                border: '1px solid #FDE68A',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>{s.val}</span>
              <span style={{ fontSize: 11, color: '#B45309', marginLeft: 4 }}>{s.lbl}</span>
            </div>
          ))}
          <a
            href="/methodology"
            style={{
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Methodology
          </a>
          <a
            href="/crm"
            style={{
              fontSize: 12,
              color: '#EF9F27',
              textDecoration: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #EF9F27',
              fontWeight: 500,
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            CRM →
          </a>
          <a
            href="/comps"
            style={{
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Comps
          </a>
          <button
            onClick={handleExportCsv}
            style={{
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
              background: '#FFFFFF',
              cursor: 'pointer',
            }}
          >
            Export CSV
          </button>
          <a
            href="/account"
            style={{
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Account
          </a>
          <button
            onClick={() => {
              setOnboardingStep(0)
              setShowOnboarding(true)
            }}
            style={{
              fontSize: 12,
              color: '#6B7280',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '6px 12px',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Tour
          </button>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              window.location.href = '/auth'
            }}
            style={{
              fontSize: 12,
              color: '#6B7280',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
              background: '#FFFFFF',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
        {/* Left panel */}
        <div
          style={{
            width: isMobile ? '100%' : 420,
            minWidth: isMobile ? 0 : 420,
            background: '#F8F8F8',
            borderRight: isMobile ? 'none' : '1px solid #E5E7EB',
            borderTop: isMobile ? '1px solid #E5E7EB' : 'none',
            overflowY: 'auto',
            padding: 14,
            order: isMobile ? 2 : 1,
            maxHeight: isMobile ? '52dvh' : 'none',
          }}
        >
          {selected ? (
            <div>
              <button
                onClick={() => setSelected(null)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#6B7280',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '12px 16px',
                  marginBottom: 4,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                ← Back
              </button>

              <div style={{ fontSize: 18, fontFamily: 'Georgia, serif', color: '#111827', fontWeight: 700 }}>
                {abstractLabel}
              </div>
              <div style={{ color: '#6B7280', marginTop: 4 }}>{surveyName} Survey</div>
              <div style={{ borderTop: '1px solid #E5E7EB', marginTop: 10, marginBottom: 10 }} />

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'rgba(244,67,54,0.15)', color: '#F44336', border: '0.5px solid rgba(244,67,54,0.35)' }}>
                  {maxScore}/10 HOT
                </span>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'rgba(239,159,39,0.15)', color: '#EF9F27', border: '0.5px solid rgba(239,159,39,0.35)' }}>
                  {ownerCount} owners
                </span>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }}>
                  {topOperator}
                </span>
              </div>

              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>PRODUCTION HISTORY</div>
                <div style={{ width: '100%', height: 140, minHeight: 140 }}>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={productionData}>
                      <XAxis dataKey="month" stroke="#6B7280" tick={{ fill: '#6B7280', fontSize: 10 }} />
                      <YAxis stroke="#6B7280" tick={{ fill: '#6B7280', fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#111827' }}
                        labelStyle={{ color: '#6B7280' }}
                      />
                      <Line type="monotone" dataKey="oil" stroke="#EF9F27" strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#6B7280' }}>
                  <span>Peak production: {productionPeak.toLocaleString()}</span>
                  <span>Current trend: {productionTrend}</span>
                </div>
              </div>

              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>OPERATOR & LEASE INFO</div>
                <div style={{ fontSize: 12, color: '#111827', marginBottom: 6 }}>Operator: {selected.top_operator}</div>
                <div style={{ fontSize: 12, color: '#111827', marginBottom: 6 }}>Field: {fieldName}</div>
                <div style={{ fontSize: 12, color: '#111827', marginBottom: 6 }}>Well status: {selected.well_status || 'PRODUCING / SHUT IN'}</div>
                <div style={{ fontSize: 12, color: '#111827' }}>Est. lease expiration: {estExpiration}</div>
              </div>

              {tractWellsLoaded && tractWells.length > 0 && (
                <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                  <div style={{ borderTop: '1px solid #F3F4F6' }}>
                    <button
                      onClick={() => setWellsExpanded(!wellsExpanded)}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#6B7280',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}>
                        Wells in this tract ({tractWells.length})
                      </div>
                      <div style={{
                        fontSize: 10,
                        color: '#9CA3AF',
                        transform: wellsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }}>
                        ▼
                      </div>
                    </button>

                    {wellsExpanded && (
                      <div style={{ paddingBottom: 8 }}>
                        {tractWells.map((well, i) => (
                          <div
                            key={`${well.rrc_lease_id ?? well.lease_name ?? 'well'}-${i}`}
                            style={{
                              padding: '6px 16px',
                              borderBottom: '1px solid #F9FAFB',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {well.lease_name}
                              </div>
                              <div style={{ fontSize: 11, color: '#6B7280' }}>
                                {well.operator_name}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: 3,
                                  background: well.oil_gas_code === 'G' ? '#EFF6FF' : '#FEF3C7',
                                  color: well.oil_gas_code === 'G' ? '#1D4ED8' : '#92400E',
                                  border: `1px solid ${well.oil_gas_code === 'G' ? '#BFDBFE' : '#FDE68A'}`,
                                }}
                              >
                                {well.oil_gas_code === 'G' ? 'GAS' : 'OIL'}
                              </span>
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 600,
                                  padding: '1px 5px',
                                  borderRadius: 3,
                                  background: well.well_type === 'HORIZONTAL' ? '#FEF3C7' : '#F9FAFB',
                                  color: well.well_type === 'HORIZONTAL' ? '#EF9F27' : '#6B7280',
                                  border: `1px solid ${well.well_type === 'HORIZONTAL' ? '#FDE68A' : '#E5E7EB'}`,
                                }}
                              >
                                {well.well_type === 'HORIZONTAL' ? 'H' : 'V'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  borderBottom: '1px solid #F3F4F6',
                  background: '#F9FAFB',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#6B7280',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  All owners in tract ({filteredOwnersList.length})
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { key: 'score', label: 'Score' },
                    { key: 'interest', label: '% Ownership' },
                    { key: 'nra', label: 'NRA' },
                  ].map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setOwnerSort(s.key as 'score' | 'interest' | 'nra')}
                      style={{
                        fontSize: 10,
                        padding: '3px 8px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: ownerSort === s.key ? 600 : 400,
                        background: ownerSort === s.key ? '#EF9F27' : 'transparent',
                        border: ownerSort === s.key ? '1px solid #EF9F27' : '1px solid #E5E7EB',
                        color: ownerSort === s.key ? '#fff' : '#6B7280',
                        transition: 'all 0.15s',
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                {cleanOwnersList.map((owner: TractOwner, i: number) => {
                  const score = Number(owner.propensity_score ?? 0)
                  const isExpanded = expandedOwner === i
                  const normalizedOwnerName = String(owner.owner_name ?? '').trim().toUpperCase()
                  const isHighlighted = highlightedOwner === normalizedOwnerName
                  const ownerElementId = ownerRowDomId(String(owner.owner_name ?? ''))
                  const ownerKey = String(owner.id ?? `${normalizedOwnerName}-${normalizeLeaseId(owner.rrc_lease_id) || i}`)
                  const ownerWellMatches = ownerWells[ownerKey] ?? []
                  const signals = isExpanded ? getScoreBreakdown(owner) : []
                  const scoreColor = score >= 8 ? '#F44336' : score >= 6 ? '#FF9800' : score >= 4 ? '#FFC107' : '#4CAF50'
                  const ownerType = classifyOwner(String(owner.owner_name ?? ''))
                  const typeColor = ownerType === 'trust' ? '#7AB835' : ownerType === 'company' ? '#378ADD' : '#9CA3AF'
                  const typeLabel = ownerType === 'trust' ? 'TRUST' : ownerType === 'company' ? 'CO' : 'IND'
                  const nra = getNRA(owner, selected, county)
                  const royaltyEstimate = estimateMonthlyRoyalty(
                    owner,
                    selected,
                    county.ownershipPctIsDecimal
                  )
                  const ownershipPctValue = getOwnershipPctValue(
                    owner,
                    county.ownershipPctIsDecimal
                  )
                  const ownershipDecimalValue = ownershipPctValue / 100

                  return (
                    <div key={`${owner.owner_name}-${i}`} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <div
                        id={ownerElementId}
                        onClick={() => {
                          const nextExpanded = isExpanded ? null : i
                          setExpandedOwner(nextExpanded)
                          if (nextExpanded !== null) {
                            void fetchOwnerWells(owner, ownerKey)
                            trackEvent('owner_expanded', {
                              owner_name: owner.owner_name,
                              score: owner.propensity_score,
                              abstract: selected?.ABSTRACT_L ?? selected?.abstract_label ?? '',
                            })
                          }
                        }}
                        style={{
                          padding: '10px 16px',
                          cursor: 'pointer',
                          background: isHighlighted ? '#FEF3C7' : isExpanded ? '#FFFBEB' : 'transparent',
                          borderLeft: isHighlighted ? '3px solid #EF9F27' : '3px solid transparent',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isExpanded && !isHighlighted) e.currentTarget.style.background = '#F9FAFB'
                        }}
                        onMouseLeave={(e) => {
                          if (!isExpanded && !isHighlighted) {
                            e.currentTarget.style.background = 'transparent'
                          }
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, marginRight: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>
                              {i + 1}. {owner.owner_name}
                            </div>
                            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                              {owner.mailing_city && owner.mailing_state
                                ? `${owner.mailing_city}, ${owner.mailing_state}`
                                : 'Address unknown'}
                            </div>
                            {nra !== null && nra > 0 && (
                              <div
                                style={{ fontSize: 10, color: '#374151', fontFamily: 'monospace', fontWeight: 600 }}
                                title={royaltyEstimate ? `Est. royalty: ${royaltyEstimate}` : undefined}
                              >
                                {nra < 0.01
                                  ? `${nra.toFixed(4)} NRA`
                                  : nra < 1
                                    ? `${nra.toFixed(3)} NRA`
                                    : `${nra.toFixed(2)} NRA`}
                                {!Number(owner.acreage) && (
                                  <span style={{ fontSize: 9, color: '#9CA3AF', marginLeft: 3 }}>est.</span>
                                )}
                              </div>
                            )}
                            <div style={{ fontSize: 10, color: '#6B7280' }}>
                              {ownershipPctValue > 0 && (
                                <>
                                  {`${ownershipPctValue.toFixed(4)}% ownership`}
                                </>
                              )}
                            </div>
                            {ownershipPctValue > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 10 }}>
                                <span style={{ color: '#9CA3AF' }}>DO Interest:</span>
                                <span style={{ color: '#374151', fontFamily: 'monospace', fontWeight: 600 }}>
                                  {ownershipDecimalValue.toFixed(6)}
                                </span>
                                <span style={{ color: '#9CA3AF' }}>
                                  ({ownershipPctValue.toFixed(4)}%)
                                </span>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor, fontFamily: 'monospace' }}>
                              {score}/10
                            </div>
                            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: `${typeColor}15`, color: typeColor, border: `0.5px solid ${typeColor}30` }}>
                              {typeLabel}
                            </span>
                            {owner.out_of_state && (
                              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'rgba(239,159,39,0.12)', color: '#B45309', border: '0.5px solid rgba(239,159,39,0.3)' }}>OOS</span>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
                          {isExpanded ? 'Hide score breakdown' : 'Why this score?'}
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '8px 16px 12px 28px', background: '#FFFBEB', borderTop: '1px solid #FDE68A' }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#92400E', letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>
                            Score Signals
                          </div>
                          {signals.length === 0 ? (
                            <div style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>No strong signals detected</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {signals.map((signal, si) => (
                                <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#EF9F27', flexShrink: 0 }} />
                                  <span style={{ fontSize: 11, color: '#374151' }}>{signal}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {ownerWellMatches.length > 0 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #F3F4F6' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                                Wells on this interest
                              </div>
                              {ownerWellMatches.map((well, wi) => (
                                <div
                                  key={`${well.rrc_lease_id ?? 'well'}-${wi}`}
                                  style={{
                                    marginBottom: 6,
                                    padding: '6px 8px',
                                    background: '#F9FAFB',
                                    borderRadius: 6,
                                    border: '1px solid #F3F4F6',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: '#111827' }}>
                                      {county.id === 'howard' ? well.lease_name : (well.lease_name ?? 'Unknown lease')}
                                    </div>
                                    <div style={{ display: 'flex', gap: 3 }}>
                                      <span
                                        style={{
                                          fontSize: 9,
                                          fontWeight: 700,
                                          padding: '1px 5px',
                                          borderRadius: 3,
                                          background: well.oil_gas_code === 'G' ? '#EFF6FF' : '#FEF3C7',
                                          color: well.oil_gas_code === 'G' ? '#1D4ED8' : '#92400E',
                                          border: `1px solid ${well.oil_gas_code === 'G' ? '#BFDBFE' : '#FDE68A'}`,
                                        }}
                                      >
                                        {well.oil_gas_code === 'G' ? 'GAS' : 'OIL'}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: 9,
                                          fontWeight: 600,
                                          padding: '1px 5px',
                                          borderRadius: 3,
                                          background: well.well_type === 'HORIZONTAL' ? '#FEF3C7' : '#F9FAFB',
                                          color: well.well_type === 'HORIZONTAL' ? '#D97706' : '#9CA3AF',
                                          border: `1px solid ${well.well_type === 'HORIZONTAL' ? '#FDE68A' : '#E5E7EB'}`,
                                        }}
                                      >
                                        {well.well_type === 'HORIZONTAL' ? 'HZ' : 'VT'}
                                      </span>
                                    </div>
                                  </div>
                                  <div style={{ fontSize: 10, color: '#6B7280' }}>
                                    Operator: {county.id === 'howard' ? well.operator_name : (well.operator_name ?? 'Unknown operator')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAddToPipeline(owner)
                              }}
                              style={{
                                fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                                background: pipelineOwners.has(owner.owner_name) ? 'rgba(122,184,53,0.15)' : 'rgba(239,159,39,0.12)',
                                border: pipelineOwners.has(owner.owner_name) ? '0.5px solid #7AB835' : '0.5px solid #EF9F27',
                                color: pipelineOwners.has(owner.owner_name) ? '#7AB835' : '#B45309',
                              }}
                            >
                              {pipelineOwners.has(owner.owner_name) ? '✓ In pipeline' : '+ Add to pipeline'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSkipTrace(owner)
                              }}
                              style={{
                                fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                                background: 'transparent',
                                border: '0.5px solid #E5E7EB',
                                color: '#6B7280',
                              }}
                            >
                              Skip trace
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', marginTop: 14 }}>
                <button style={{ width: '100%', padding: '9px', borderRadius: 6, border: '0.5px solid rgba(239,159,39,0.4)', background: 'rgba(239,159,39,0.15)', color: '#EF9F27', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                  Add all to pipeline
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 16 }}>
                County Overview
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {countyStats.map((card) => (
                  <div
                    key={card.lbl}
                    style={{
                      background: '#FFFFFF',
                      borderRadius: 8,
                      border: '1px solid #E5E7EB',
                      padding: '14px 16px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div
                      style={{
                        color: '#111827',
                        fontFamily: '"Times New Roman", Georgia, serif',
                        fontSize: 24,
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                        fontVariantNumeric: 'tabular-nums lining-nums',
                        fontFeatureSettings: '"tnum" 1, "lnum" 1',
                      }}
                    >
                      {card.val}
                    </div>
                    <div style={{ color: '#6B7280', fontSize: 11, marginTop: 2, fontFamily: 'Inter, sans-serif' }}>{card.lbl}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, marginBottom: 10, fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>
                TOP 10 HOTTEST TRACTS
              </div>
              <div
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  maxHeight: 340,
                  overflowY: 'auto',
                }}
              >
                {topTracts.map((tract, index) => (
                  <div
                    key={`${tract.abstract_label}-${tract.level1_sur}-${index}`}
                    onClick={() => {
                      setSelected(toTractSelection(tract))
                      setOwnerSort('score')
                      setExpandedOwner(null)
                      trackEvent('tract_clicked', {
                        abstract: tract.abstract_label,
                        owner_count: tract.owner_count,
                        max_score: tract.max_propensity_score,
                      })
                    }}
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E5E7EB',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 6,
                      cursor: 'pointer',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.borderColor = '#EF9F27'
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.borderColor = '#E5E7EB'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, marginRight: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
                          {tract.abstract_label}
                        </div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                          {tract.level1_sur}
                        </div>
                        <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
                          {tract.owner_count} owners · {tract.top_operator}
                        </div>
                      </div>
                      <div
                        style={{
                          background: '#F3F4F6',
                          border: '1px solid #E5E7EB',
                          borderRadius: 999,
                          padding: '2px 8px',
                          color: scoreBadgeColor(tract.max_propensity_score),
                          fontFamily: 'Inter, sans-serif',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {tract.max_propensity_score}/10
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, marginBottom: 10, fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>
                COUNTY BREAKDOWN
              </div>
              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                {countyBreakdown.map((row) => (
                  <div key={row.operator} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: '#111827' }}>{row.operator}</span>
                      <span style={{ color: '#6B7280' }}>{row.pct}%</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 4, background: '#F3F4F6' }}>
                      <div style={{ width: `${row.pct}%`, height: 7, borderRadius: 4, background: '#EF9F27' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Map area */}
        <div
          style={{
            flex: isMobile ? '0 0 48dvh' : 1,
            minWidth: 0,
            minHeight: isMobile ? '48dvh' : 0,
            position: 'relative',
            order: isMobile ? 1 : 2,
          }}
        >
          {countySwitchLabel && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10,
                padding: '5px 12px',
                borderRadius: 999,
                background: 'rgba(239,159,39,0.14)',
                border: '1px solid rgba(239,159,39,0.45)',
                color: '#B45309',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'Inter, sans-serif',
                opacity: countySwitchLabelVisible ? 1 : 0,
                transition: 'opacity 0.25s ease',
                pointerEvents: 'none',
              }}
            >
              {countySwitchLabel}
            </div>
          )}
          {previousCounty && (
            <button
              onClick={() => switchCountyByOffset(-1)}
              aria-label={`Previous county: ${COUNTIES[previousCounty].name}`}
              style={{
                position: 'absolute',
                top: '50%',
                left: 8,
                transform: 'translateY(-50%)',
                zIndex: 10,
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '1px solid #E5E7EB',
                background: 'rgba(255,255,255,0.92)',
                color: '#374151',
                fontSize: 18,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ‹
            </button>
          )}
          {nextCounty && (
            <button
              onClick={() => switchCountyByOffset(1)}
              aria-label={`Next county: ${COUNTIES[nextCounty].name}`}
              style={{
                position: 'absolute',
                top: '50%',
                right: 8,
                transform: 'translateY(-50%)',
                zIndex: 10,
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '1px solid #E5E7EB',
                background: 'rgba(255,255,255,0.92)',
                color: '#374151',
                fontSize: 18,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ›
            </button>
          )}
          {loading ? (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF9F27', fontFamily: 'Inter, sans-serif' }}>
              Loading...
            </div>
          ) : (
            <MineralMap
              key={selectedCounty}
              selectedCounty={selectedCounty}
              showPermits={showPermits}
              focusTarget={selected}
              onOwnerClick={(tract) => {
                setSelected(tract)
                setSelectedTractGeometry(
                  (tract.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined) ?? null
                )
                setOwnerSort('score')
                setExpandedOwner(null)
                trackEvent('tract_clicked', {
                  abstract: tract.ABSTRACT_L ?? tract.abstract_label ?? '',
                  owner_count: tract.owner_count ?? 0,
                  max_score: tract.max_propensity_score ?? 0,
                })
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          height: isMobile ? 58 : 44,
          minHeight: isMobile ? 58 : 44,
          background: '#FFFFFF',
          borderTop: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 14 : 20,
          padding: isMobile ? '0 10px' : '0 16px',
          color: '#374151',
          fontSize: 11,
          boxShadow: '0 -1px 3px rgba(0,0,0,0.04)',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Motivated only</span>
        <button
          onClick={() => setMotivatedOnly((prev) => !prev)}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            border: 'none',
            background: motivatedOnly ? '#EF9F27' : '#D1D5DB',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: motivatedOnly ? 14 : 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#fff',
            }}
          />
        </button>

        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Out of state</span>
        <button
          onClick={() => setOutOfStateOnly((prev) => !prev)}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            border: 'none',
            background: outOfStateOnly ? '#EF9F27' : '#D1D5DB',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: outOfStateOnly ? 14 : 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#fff',
            }}
          />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#6B7280' }}>1%+ interest</span>
          <div
            onClick={() => setLargeInterestOnly(!largeInterestOnly)}
            style={{
              width: 32, height: 18, borderRadius: 9,
              background: largeInterestOnly ? '#EF9F27' : '#E5E7EB',
              cursor: 'pointer', position: 'relative', transition: 'background 0.2s'
            }}
          >
            <div style={{
              position: 'absolute', top: 2,
              left: largeInterestOnly ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginRight: 16 }}>
          <span style={{ fontSize: 12, color: '#374151', whiteSpace: 'nowrap', fontFamily: 'Inter, sans-serif' }}>Type:</span>
          {(['all', 'individual', 'trust', 'company'] as const).map(type => (
            <button
              key={type}
              onClick={() => setOwnerTypeFilter(type)}
              style={{
                fontSize: 10,
                padding: '3px 10px',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                whiteSpace: 'nowrap',
                background: ownerTypeFilter === type ? 'rgba(239,159,39,0.2)' : 'transparent',
                border: ownerTypeFilter === type ? '1px solid rgba(239,159,39,0.6)' : '1px solid #E5E7EB',
                color: ownerTypeFilter === type ? '#EF9F27' : '#6B7280',
              }}
            >
              {type === 'all' ? 'All' : type === 'individual' ? 'People' : type === 'trust' ? 'Trusts' : 'Companies'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginRight: 16 }}>
          <span style={{ fontSize: 11, color: '#6B7280', marginRight: 4 }}>Tier:</span>
          {(['all', 'hot', 'motivated', 'prospect', 'low'] as const).map(tier => {
            const colors: Record<string, string> = {
              hot: '#F44336', motivated: '#FF9800', prospect: '#81C784', low: '#9E9E9E', all: '#EF9F27'
            }
            return (
              <button
                key={tier}
                onClick={() => setTierFilter(tier)}
                style={{
                  fontSize: 10, padding: '3px 10px', borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'monospace',
                  background: tierFilter === tier ? `${colors[tier]}20` : 'transparent',
                  border: tierFilter === tier ? `0.5px solid ${colors[tier]}` : '0.5px solid #E5E7EB',
                  color: tierFilter === tier ? colors[tier] : '#6B7280',
                }}
              >
                {tier === 'all' ? 'All' : tier.charAt(0).toUpperCase() + tier.slice(1)}
              </button>
            )
          })}
        </div>

        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Min score</span>
        <input
          type="range"
          min={0}
          max={10}
          value={minScore}
          onChange={(event) => setMinScore(Number(event.target.value))}
          style={{ width: 160, accentColor: '#EF9F27' }}
        />
        <span style={{ fontFamily: 'Inter, sans-serif', color: '#EF9F27', fontWeight: 600 }}>{minScore}</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#6B7280' }}>Min NRA:</span>
          <select
            value={minNRA}
            onChange={(e) => setMinNRA(Number(e.target.value))}
            style={{ fontSize: 11, border: '1px solid #E5E7EB', borderRadius: 6, padding: '2px 6px', background: '#fff', color: '#374151' }}
          >
            <option value={0}>Any</option>
            <option value={0.1}>0.1+</option>
            <option value={0.5}>0.5+</option>
            <option value={1}>1+</option>
            <option value={5}>5+</option>
            <option value={10}>10+</option>
            <option value={25}>25+</option>
            <option value={50}>50+</option>
          </select>
        </div>

        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Layers:</span>
        <button
          onClick={() => setShowPermits((prev) => !prev)}
          style={{
            background: 'none',
            border: 'none',
            color: showPermits ? '#2563eb' : '#6B7280',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
            padding: 0,
          }}
        >
          ● New permits
        </button>

      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#FFFFFF',
            border: toastType === 'error' ? '0.5px solid #F44336' : '0.5px solid #7AB835',
            color: toastType === 'error' ? '#F44336' : '#7AB835',
            fontSize: 12,
            padding: '10px 20px',
            borderRadius: 8,
            fontFamily: 'Inter, sans-serif',
            zIndex: 9999,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        >
          {toastType === 'error' ? '✕' : '✓'} {toast}
        </div>
      )}

      {showOnboarding && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              width: 'min(520px, calc(100vw - 24px))',
              boxShadow: '0 32px 80px rgba(0,0,0,0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: 3,
                background: '#EF9F27',
                width: `${((onboardingStep + 1) / ONBOARDING_STEPS.length) * 100}%`,
                transition: 'width 0.3s ease',
              }}
            />

            <div style={{ padding: '36px 40px 32px' }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#9CA3AF',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  marginBottom: 20,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                Step {ONBOARDING_STEPS[onboardingStep].step} of {String(ONBOARDING_STEPS.length).padStart(2, '0')}
              </div>

              <h2
                style={{
                  fontFamily: 'Georgia, serif',
                  fontSize: 24,
                  fontWeight: 700,
                  color: '#111827',
                  marginBottom: 14,
                  lineHeight: 1.2,
                  letterSpacing: '-0.01em',
                }}
              >
                {ONBOARDING_STEPS[onboardingStep].title}
              </h2>

              <p
                style={{
                  fontSize: 14,
                  color: '#4B5563',
                  lineHeight: 1.75,
                  marginBottom: 36,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {ONBOARDING_STEPS[onboardingStep].body}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button
                  onClick={completeOnboarding}
                  style={{
                    fontSize: 12,
                    color: '#9CA3AF',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    padding: 0,
                  }}
                >
                  Skip tour
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {onboardingStep > 0 && (
                    <button
                      onClick={() => setOnboardingStep((s) => s - 1)}
                      style={{
                        padding: '9px 20px',
                        borderRadius: 7,
                        fontSize: 13,
                        background: 'transparent',
                        border: '1px solid #E5E7EB',
                        color: '#374151',
                        cursor: 'pointer',
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: 500,
                      }}
                    >
                      Back
                    </button>
                  )}
                  {onboardingStep < ONBOARDING_STEPS.length - 1 ? (
                    <button
                      onClick={() => setOnboardingStep((s) => s + 1)}
                      style={{
                        padding: '9px 24px',
                        borderRadius: 7,
                        fontSize: 13,
                        background: '#111827',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontFamily: 'Inter, sans-serif',
                      }}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      onClick={completeOnboarding}
                      style={{
                        padding: '9px 24px',
                        borderRadius: 7,
                        fontSize: 13,
                        background: '#EF9F27',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontFamily: 'Inter, sans-serif',
                      }}
                    >
                      Start prospecting
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pipelineCandidate && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              border: '0.5px solid #E5E7EB',
              borderRadius: 12,
              padding: 24,
              width: 360,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
              Add owner to pipeline
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
              {pipelineCandidate.owner_name}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>
              Label
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {([
                { key: 'prospect', label: 'Prospect' },
                { key: 'hot', label: 'Hot' },
                { key: 'nurture', label: 'Nurture' },
                { key: 'not_interested', label: 'Not Interested' },
              ] as Array<{ key: PipelineTag; label: string }>).map((option) => (
                <button
                  key={option.key}
                  onClick={() => setPipelineTag(option.key)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border:
                      pipelineTag === option.key
                        ? '0.5px solid rgba(55,138,221,0.8)'
                        : '0.5px solid #E5E7EB',
                    background:
                      pipelineTag === option.key
                        ? 'rgba(55,138,221,0.2)'
                        : 'transparent',
                    color: pipelineTag === option.key ? '#8CC4FF' : '#6B7280',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  if (pipelineSaving) return
                  setPipelineCandidate(null)
                }}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: '0.5px solid #E5E7EB',
                  color: '#6B7280',
                  fontSize: 12,
                  cursor: pipelineSaving ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddToPipelineConfirm}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'rgba(55,138,221,0.2)',
                  border: '0.5px solid rgba(55,138,221,0.8)',
                  color: '#8CC4FF',
                  fontSize: 12,
                  cursor: pipelineSaving ? 'not-allowed' : 'pointer',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {pipelineSaving ? 'Saving...' : 'Add to pipeline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {skipTracing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              border: '0.5px solid #E5E7EB',
              borderRadius: 12,
              padding: '24px',
              width: 320,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', marginBottom: 8 }}>
              Skip trace this owner?
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>
              {skipTracing.owner_name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#6B7280',
                marginBottom: 20,
                padding: '10px 12px',
                background: '#FFFFFF',
                borderRadius: 6,
                lineHeight: 1.5,
              }}
            >
              This will search for phone number and email address.
              Uses 1 skip trace credit from your monthly allowance.
              <br />
              <br />
              <span style={{ color: '#EF9F27' }}>
                Monthly limit: {SKIP_TRACE_LIMIT} skip traces · resets on the 1st
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setSkipTracing(null)}
                disabled={skipTraceLoading}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: '0.5px solid #E5E7EB',
                  color: '#6B7280',
                  fontSize: 12,
                  cursor: skipTraceLoading ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSkipTraceConfirm}
                disabled={skipTraceLoading}
                style={{
                  flex: 1, padding: '9px', borderRadius: 6,
                  background: skipTraceLoading ? 'rgba(239,159,39,0.08)' : 'rgba(239,159,39,0.15)',
                  border: '0.5px solid rgba(239,159,39,0.4)',
                  color: '#EF9F27', fontSize: 12, cursor: skipTraceLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'monospace'
                }}
              >
                {skipTraceLoading ? 'Searching...' : 'Skip trace →'}
              </button>
            </div>
          </div>
        </div>
      )}
      {skipTraceResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            background: '#FFFFFF', borderRadius: 12, padding: '28px 32px',
            width: 360, boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
          }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
              Skip Trace Complete
            </div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
              {skipTraceResult.ownerName}
            </div>

            {skipTraceResult.cached && (
              <div style={{ fontSize: 11, color: '#16a34a', marginBottom: 8 }}>
                ✓ Retrieved from shared cache
              </div>
            )}

            <div style={{ background: '#F8F8F8', borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
              {skipTraceResult.phone ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 16 }}>📞</span>
                  <a href={`tel:${skipTraceResult.phone}`} style={{ fontSize: 14, color: '#111827', fontWeight: 500, textDecoration: 'none' }}>
                    {skipTraceResult.phone}
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 8 }}>No phone found</div>
              )}
              {skipTraceResult.email ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>✉️</span>
                  <a href={`mailto:${skipTraceResult.email}`} style={{ fontSize: 14, color: '#111827', fontWeight: 500, textDecoration: 'none' }}>
                    {skipTraceResult.email}
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#9CA3AF' }}>No email found</div>
              )}
            </div>

            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 20 }}>
              Contact info saved to pipeline. View and manage this lead in the CRM.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setSkipTraceResult(null)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  background: 'transparent', border: '1px solid #E5E7EB',
                  color: '#6B7280', fontSize: 13, cursor: 'pointer'
                }}
              >
                Stay here
              </button>
              <button
                onClick={() => window.location.href = '/crm'}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  background: '#EF9F27', border: 'none',
                  color: '#fff', fontSize: 13, cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Go to CRM →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
