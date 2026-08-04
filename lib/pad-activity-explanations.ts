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
  headline: 'Completion activity — pre-filing',
  story:
    'Sentinel-2 indicates new bright clusters and pad-edge growth consistent with completion operations, often preceding the public RRC completion date. Prioritize owner outreach before the filing is broadly visible.',
  bullets: [
    'Imagery change precedes public completion records',
    'Multiple bright clusters suggest equipment footprint',
    'Owner contact window remains comparatively quiet',
  ],
  beforeLabel: 'Prior scene',
  afterLabel: 'Current scene',
  annotations: [
    { id: '1', label: 'Pad core', left: 32, top: 28, width: 36, height: 34, tone: 'signal' },
    { id: '2', label: 'Equipment cluster', left: 58, top: 48, width: 22, height: 20, tone: 'warn' },
    { id: '3', label: 'Access brightening', left: 18, top: 56, width: 18, height: 16, tone: 'muted' },
  ],
  skyfiHint: 'For higher confidence before outreach, confirm clusters with a SkyFi archive scene.',
}

const RIG_IN: SignatureBrief = {
  headline: 'Rig / pad construction',
  story:
    'A compact structural change is present — typically a new pad or rig footprint. Monitor for a subsequent completion signature.',
  bullets: [
    'One to two new structural clusters',
    'Spectral change consistent with bare earth or steel',
    'Add to completion watchlist',
  ],
  beforeLabel: 'Prior scene',
  afterLabel: 'Current scene',
  annotations: [
    { id: '1', label: 'New structure', left: 36, top: 34, width: 28, height: 28, tone: 'signal' },
  ],
  skyfiHint: 'SkyFi can help distinguish a rig mast from tankage.',
}

const RIG_OUT: SignatureBrief = {
  headline: 'Rig move-out',
  story:
    'Structural density has declined while the pad remains disturbed — commonly the interval between drilling and completion.',
  bullets: [
    'Structure signature reduced versus prior scene',
    'Pad remains spectrally active',
    'Monitor for subsequent completion activity',
  ],
  beforeLabel: 'Prior scene',
  afterLabel: 'Current scene',
  annotations: [
    { id: '1', label: 'Cleared pad', left: 34, top: 32, width: 32, height: 30, tone: 'warn' },
  ],
  skyfiHint: 'Optional SkyFi review if mast confirmation is required.',
}

const RRC_COMPLETION: SignatureBrief = {
  headline: 'RRC completion — public record',
  story:
    'The Commission has already logged a completion date. Outreach may still be warranted, though competitors can observe the same filing. Imagery advantage is greatest when change is detected before this record exists.',
  bullets: [
    'Public completion date is already on file',
    'Expect concurrent owner outreach',
    'Use imagery to identify pre-filing windows on future pads',
  ],
  beforeLabel: 'Baseline',
  afterLabel: 'Current scene',
  annotations: [
    { id: '1', label: 'Wellsite AOI', left: 30, top: 30, width: 40, height: 40, tone: 'signal' },
  ],
  skyfiHint: 'SkyFi can still confirm frac or flowback if visual evidence is needed.',
}

const RRC_APPROVED: SignatureBrief = {
  headline: 'Permit approved',
  story:
    'A drilling permit has been approved. Monitor subsequent Sentinel passes for rig move-in and pad construction.',
  bullets: [
    'Approved permit within the lookback window',
    'No completion recorded yet',
    'Early owner contact may precede broader awareness',
  ],
  beforeLabel: 'Prior scene',
  afterLabel: 'Latest scene',
  annotations: [
    { id: '1', label: 'Expected pad', left: 34, top: 34, width: 32, height: 32, tone: 'muted' },
  ],
  skyfiHint: 'Prefer Sentinel change detection; use SkyFi when same-week clarity is required.',
}

const AMBIGUOUS: SignatureBrief = {
  headline: 'Possible completion activity',
  story:
    'Sentinel registered a material pad change that did not classify cleanly as a completion signature. Confirm with higher-resolution imagery or human review before outreach.',
  bullets: [
    'Major change without a clean signature match',
    'May represent early equipment staging',
    'Confirm classification, then contact owners',
  ],
  beforeLabel: 'Before',
  afterLabel: 'After',
  annotations: [
    { id: '1', label: 'Change region', left: 28, top: 28, width: 44, height: 42, tone: 'warn' },
  ],
  skyfiHint: 'Use SkyFi archive confirmation before initiating owner contact.',
}

const DEFAULT_BRIEF: SignatureBrief = {
  headline: 'Pad signal',
  story: 'Activity detected on this pad. Review imagery and filing context before outreach.',
  bullets: [
    'Inspect before and after scenes',
    'Review mineral owners on the tract',
    'Confirm with SkyFi if classification is uncertain',
  ],
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
