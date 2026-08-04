/**
 * Signature-specific copy + HUD annotation templates for the Pad Ops
 * change desk. Bounding boxes are relative (0–100%) overlays on the chip
 * until the weekly job ships real change-mask polygons in `raw.metrics`.
 */

export type AnnotationBox = {
  id: string
  label: string
  /** Percent of frame: left, top, width, height */
  left: number
  top: number
  width: number
  height: number
  tone: 'signal' | 'warn' | 'muted'
}

export type SignatureBrief = {
  headline: string
  story: string
  bullets: string[]
  beforeLabel: string
  afterLabel: string
  annotations: AnnotationBox[]
  skyfiHint: string
}

const COMPLETION: SignatureBrief = {
  headline: 'Completion crew — before the filing',
  story:
    'Sentinel-2 caught new bright clusters and edge growth on the pad — the completion-crew signature — often days before RRC logs a completion date. Call owners now, before the public filing hits every competitor’s scrape.',
  bullets: [
    'Imagery change landed before public completion data',
    'Multiple new bright clusters / equipment footprint',
    'Reach mineral owners while the window is still quiet',
  ],
  beforeLabel: 'Prior Sentinel scene',
  afterLabel: 'Crew signature',
  annotations: [
    { id: '1', label: 'Pad core', left: 32, top: 28, width: 36, height: 34, tone: 'signal' },
    { id: '2', label: 'Equipment cluster', left: 58, top: 48, width: 22, height: 20, tone: 'warn' },
    { id: '3', label: 'Access brightening', left: 18, top: 56, width: 18, height: 16, tone: 'muted' },
  ],
  skyfiHint: 'Need higher confidence before dialing? Confirm the clusters with SkyFi hi-res.',
}

const RIG_IN: SignatureBrief = {
  headline: 'Rig / pad construction',
  story:
    'A compact structural change appeared — typically a new pad or rig footprint. Watch this location for a later completion-crew signature.',
  bullets: [
    '1–2 new structural clusters',
    'Spectral jump consistent with bare earth / steel',
    'Queue for completion watchlist',
  ],
  beforeLabel: 'Prior Sentinel scene',
  afterLabel: 'New activity',
  annotations: [
    { id: '1', label: 'New structure', left: 36, top: 34, width: 28, height: 28, tone: 'signal' },
  ],
  skyfiHint: 'SkyFi can resolve whether this is a rig mast vs tankage.',
}

const RIG_OUT: SignatureBrief = {
  headline: 'Rig move-out',
  story:
    'Edge density dropped while the pad remains disturbed — often the gap between drilling and completion.',
  bullets: [
    'Structure signature reduced vs prior scene',
    'Pad still spectrally active',
    'Prime window before completion crew arrives',
  ],
  beforeLabel: 'Rig present',
  afterLabel: 'Rig cleared',
  annotations: [
    { id: '1', label: 'Cleared pad', left: 34, top: 32, width: 32, height: 30, tone: 'warn' },
  ],
  skyfiHint: 'Optional SkyFi check if you need mast confirmation.',
}

const RRC_COMPLETION: SignatureBrief = {
  headline: 'RRC completion — already public',
  story:
    'The Commission already logged a completion date — competitors can see this too. Still worth a call, but the edge case is catching the crew on Sentinel before this filing exists.',
  bullets: [
    'Public completion date is already on file',
    'Expect competition on owner outreach',
    'Use imagery next time to get ahead of the scrape',
  ],
  beforeLabel: 'Baseline',
  afterLabel: 'Current pad',
  annotations: [
    { id: '1', label: 'Wellsite AOI', left: 30, top: 30, width: 40, height: 40, tone: 'signal' },
  ],
  skyfiHint: 'SkyFi can still confirm frac / flowback if you need visual proof on the call.',
}

const RRC_APPROVED: SignatureBrief = {
  headline: 'Permit approved',
  story:
    'A drilling permit cleared. Early signal — watch for rig move-in on the next Sentinel pass.',
  bullets: [
    'Approved permit in the lookback window',
    'No completion yet — monitor for pad cut',
    'Early owner contact before competitors',
  ],
  beforeLabel: 'Pre-permit',
  afterLabel: 'Latest scene',
  annotations: [
    { id: '1', label: 'Expected pad', left: 34, top: 34, width: 32, height: 32, tone: 'muted' },
  ],
  skyfiHint: 'Usually wait for Sentinel change; SkyFi only if you need same-week clarity.',
}

const AMBIGUOUS: SignatureBrief = {
  headline: 'Possible crew — confirm fast',
  story:
    'Sentinel saw a major pad change that did not cleanly score as completion crew. If this is equipment staging, you still have the pre-filing advantage — confirm with SkyFi or mark it yourself.',
  bullets: [
    'MAJOR_CHANGE before a clean signature',
    'Could be the early crew window',
    'Confirm completion, then call owners immediately',
  ],
  beforeLabel: 'Before',
  afterLabel: 'After',
  annotations: [
    { id: '1', label: 'Change region', left: 28, top: 28, width: 44, height: 42, tone: 'warn' },
  ],
  skyfiHint: 'SkyFi is built for this moment — confirm crew before you burn dials.',
}

const DEFAULT_BRIEF: SignatureBrief = {
  headline: 'Pad signal',
  story: 'Activity detected on this pad. Review imagery and filing context before outreach.',
  bullets: ['Inspect before/after scenes', 'Check owners on the tract', 'Confirm with SkyFi if unsure'],
  beforeLabel: 'Before',
  afterLabel: 'After',
  annotations: [
    { id: '1', label: 'AOI', left: 32, top: 32, width: 36, height: 36, tone: 'muted' },
  ],
  skyfiHint: 'Use SkyFi to confirm material change.',
}

const BY_SIGNATURE: Record<string, SignatureBrief> = {
  COMPLETION_CREW: COMPLETION,
  RRC_COMPLETION: RRC_COMPLETION,
  RIG_MOVE_IN: RIG_IN,
  RIG_MOVE_OUT: RIG_OUT,
  RRC_APPROVED: RRC_APPROVED,
  AMBIGUOUS: AMBIGUOUS,
}

export function briefForSignature(signature: string): SignatureBrief {
  return BY_SIGNATURE[signature] || DEFAULT_BRIEF
}

/** Prefer lifecycle signals that matter for completion outreach. */
export function signalPriority(signature: string): number {
  switch (signature) {
    case 'COMPLETION_CREW':
      return 100
    case 'RRC_COMPLETION':
      return 90
    case 'AMBIGUOUS':
      return 80
    case 'RIG_MOVE_OUT':
      return 70
    case 'RIG_MOVE_IN':
      return 60
    case 'RRC_APPROVED':
      return 40
    default:
      return 10
  }
}
