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
  headline: 'Rig → completion crew',
  story:
    'Sentinel-2 change detection picked up new bright clusters and edge growth on the pad — the signature we associate with completion equipment staging after a rig leaves.',
  bullets: [
    'Multiple new bright clusters on pad surface',
    'Edge density up vs prior scene (equipment footprint)',
    'Follow mineral owners while payout window opens',
  ],
  beforeLabel: 'Prior Sentinel scene',
  afterLabel: 'Latest change scene',
  annotations: [
    { id: '1', label: 'Pad core', left: 32, top: 28, width: 36, height: 34, tone: 'signal' },
    { id: '2', label: 'Equipment cluster', left: 58, top: 48, width: 22, height: 20, tone: 'warn' },
    { id: '3', label: 'Access brightening', left: 18, top: 56, width: 18, height: 16, tone: 'muted' },
  ],
  skyfiHint: 'Confirm with SkyFi hi-res if the Sentinel clusters look ambiguous.',
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
  headline: 'RRC completion filing',
  story:
    'Public RRC data shows a completion date. Pair with Sentinel change scenes when the weekly imagery job lands paths — or pull on-demand preview now.',
  bullets: [
    'Completion date on file with the Commission',
    'Imagery confirmation strengthens the call timing',
    'Owners on this tract are high-priority outreach',
  ],
  beforeLabel: 'Baseline',
  afterLabel: 'Current pad',
  annotations: [
    { id: '1', label: 'Wellsite AOI', left: 30, top: 30, width: 40, height: 40, tone: 'signal' },
  ],
  skyfiHint: 'Order SkyFi to visually confirm frac / flowback activity.',
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
  headline: 'Needs human review',
  story:
    'Change score fired, but the cluster pattern did not cleanly match rig or completion. Confirm visually or escalate to SkyFi.',
  bullets: [
    'MAJOR_CHANGE without a clean signature',
    'Review before/after side by side',
    'Confirm completion, rig, or dismiss',
  ],
  beforeLabel: 'Before',
  afterLabel: 'After',
  annotations: [
    { id: '1', label: 'Change region', left: 28, top: 28, width: 44, height: 42, tone: 'warn' },
  ],
  skyfiHint: 'SkyFi is the right next step when Sentinel is inconclusive.',
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
