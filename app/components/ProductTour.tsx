'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'

export type TourStep = {
  // CSS selector for the element to spotlight. Omit for a centered,
  // anchor-less step (e.g. the welcome / finish cards).
  selector?: string
  title: string
  body: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
}

// Fired by the "?" help button so the tour can be replayed on demand.
export const TOUR_EVENT = 'mm:start-tour'

const SPOTLIGHT_PADDING = 8
const CARD_WIDTH = 320
const ACCENT = '#EF9F27'

export default function ProductTour({
  steps,
  storageKey = 'mm_product_tour_v1',
  autoStart = true,
}: {
  steps: TourStep[]
  storageKey?: string
  autoStart?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => setMounted(true), [])

  const start = useCallback(() => {
    setIndex(0)
    setActive(true)
  }, [])

  const finish = useCallback(() => {
    setActive(false)
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      /* private mode — tour just replays next visit */
    }
  }, [storageKey])

  const next = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        finish()
        return i
      }
      return i + 1
    })
  }, [steps.length, finish])

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Auto-start once per browser on the first desktop visit.
  useEffect(() => {
    if (!mounted || !autoStart) return
    if (window.innerWidth < 900) return
    let seen = false
    try {
      seen = window.localStorage.getItem(storageKey) === '1'
    } catch {
      seen = false
    }
    if (seen) return
    const t = window.setTimeout(start, 900)
    return () => window.clearTimeout(t)
  }, [mounted, autoStart, storageKey, start])

  // Replay when the help button dispatches the event.
  useEffect(() => {
    const handler = () => start()
    window.addEventListener(TOUR_EVENT, handler)
    return () => window.removeEventListener(TOUR_EVENT, handler)
  }, [start])

  const step = active ? steps[index] : null

  const measure = useCallback(() => {
    if (!step || !step.selector) {
      setRect(null)
      return
    }
    const el = document.querySelector(step.selector) as HTMLElement | null
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  useLayoutEffect(() => {
    measure()
  }, [measure, index, active])

  useEffect(() => {
    if (!active) return
    const onReflow = () => measure()
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    // Re-measure a couple of times so late layout (map tiles, web fonts)
    // doesn't leave the spotlight on a stale rect.
    const t1 = window.setTimeout(measure, 150)
    const t2 = window.setTimeout(measure, 500)
    return () => {
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [active, measure])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, finish, next, prev])

  if (!mounted || !active || !step) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const placement = step.placement ?? (rect ? 'bottom' : 'center')
  const isLast = index === steps.length - 1
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  // Position the card relative to the spotlit element, flipping/clamping so
  // it always stays on screen. Centered when there's no anchor.
  const cardPos: CSSProperties = (() => {
    if (!rect || placement === 'center') {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    }
    const gap = 12
    const estHeight = 190
    if (placement === 'right' && rect.right + gap + CARD_WIDTH <= vw) {
      return {
        top: clamp(rect.top, 12, vh - estHeight - 12),
        left: rect.right + gap,
      }
    }
    if (placement === 'left' && rect.left - gap - CARD_WIDTH >= 0) {
      return {
        top: clamp(rect.top, 12, vh - estHeight - 12),
        left: rect.left - gap - CARD_WIDTH,
      }
    }
    // Prefer below; flip above when there isn't room.
    const below = rect.bottom + gap + estHeight <= vh
    const left = clamp(rect.left, 12, vw - CARD_WIDTH - 12)
    return below
      ? { top: rect.bottom + gap, left }
      : { top: rect.top - gap, left, transform: 'translateY(-100%)' }
  })()

  const overlay = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, pointerEvents: 'none' }}>
      {rect ? (
        <div
          style={{
            position: 'fixed',
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            borderRadius: 10,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
            border: `2px solid ${ACCENT}`,
            transition: 'top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)' }} />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        style={{
          position: 'fixed',
          width: CARD_WIDTH,
          maxWidth: 'calc(100vw - 24px)',
          background: '#ffffff',
          color: '#0f172a',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.25)',
          padding: 18,
          fontFamily: 'Geist, Inter, system-ui, sans-serif',
          pointerEvents: 'auto',
          ...cardPos,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: ACCENT, letterSpacing: 0.4 }}>
            STEP {index + 1} OF {steps.length}
          </span>
          <button
            type="button"
            onClick={finish}
            aria-label="Close tour"
            style={{
              border: 'none',
              background: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{step.title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#475569' }}>{step.body}</div>

        <div style={{ display: 'flex', gap: 4, margin: '14px 0' }}>
          {steps.map((_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: i <= index ? ACCENT : '#e5e7eb',
                transition: 'background 0.2s ease',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            onClick={finish}
            style={{
              border: 'none',
              background: 'none',
              color: '#94a3b8',
              fontSize: 12,
              cursor: 'pointer',
              padding: '6px 4px',
            }}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {index > 0 && (
              <button
                type="button"
                onClick={prev}
                style={{
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  color: '#334155',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  padding: '7px 14px',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              style={{
                border: 'none',
                background: ACCENT,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                padding: '7px 16px',
                cursor: 'pointer',
              }}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
