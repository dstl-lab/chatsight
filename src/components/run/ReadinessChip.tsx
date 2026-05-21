import { useEffect, useRef, useState } from 'react'
import type { ReadinessState } from '../../types'
import { api } from '../../services/api'

interface ReadinessChipProps {
  readiness: ReadinessState
  labelId: number
  guidance: string | null
  onHandoff: () => void
  /** When set, the readiness panel is controlled by the parent (e.g. Enter shortcut). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const tierLabel: Record<ReadinessState['tier'], string> = {
  gray: 'Not ready',
  amber: 'Almost ready',
  green: 'Ready',
}

const tierDot: Record<ReadinessState['tier'], string> = {
  gray: 'bg-faint',
  amber: 'bg-ochre',
  green: 'bg-moss',
}

const tierTitle: Record<ReadinessState['tier'], string> = {
  gray: 'Not ready',
  amber: 'Almost ready',
  green: 'Ready to hand off',
}

const tierBlurb: Record<ReadinessState['tier'], string> = {
  gray:
    'Mark at least one Yes and one No before Gemini can take over. The classifier needs both kinds of example to learn the boundary.',
  amber:
    'You can hand off now, but a few more decisions will give Gemini stronger signal. Walking 5 conversations is the recommended minimum.',
  green:
    'You have enough variety. Hand off whenever you’re ready — Gemini will classify the rest and surface low-confidence cases for review.',
}

export function ReadinessChip({
  readiness,
  labelId,
  guidance,
  onHandoff,
  open: openProp,
  onOpenChange,
}: ReadinessChipProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const ref = useRef<HTMLDivElement>(null)
  const [geminiPreview, setGeminiPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const lastFetchedYesCount = useRef<number | null>(null)

  // Inline description edit
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [savingDesc, setSavingDesc] = useState(false)

  // Refine guidance panel
  const [refineOpen, setRefineOpen] = useState(false)
  const [guidanceDraft, setGuidanceDraft] = useState('')
  const [applyingGuidance, setApplyingGuidance] = useState(false)
  // Track the latest saved guidance locally so reopening the panel after an
  // apply shows the freshly saved text (parent prop only updates on next refresh).
  const [savedGuidance, setSavedGuidance] = useState<string | null>(guidance)

  useEffect(() => {
    if (!open || readiness.tier === 'gray') return
    if (previewLoading) return
    if (lastFetchedYesCount.current === readiness.yes_count) return
    lastFetchedYesCount.current = readiness.yes_count
    setPreviewLoading(true)
    api.getSingleLabelGeminiPreview(labelId)
      .then(({ summary }) => setGeminiPreview(summary))
      .catch(() => {})
      .finally(() => setPreviewLoading(false))
  }, [open, readiness.yes_count])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleStartEdit = () => {
    setDescDraft(geminiPreview ?? '')
    setEditingDesc(true)
  }

  const handleSaveDesc = async () => {
    setSavingDesc(true)
    try {
      await api.patchSingleLabel(labelId, { description: descDraft })
      setGeminiPreview(descDraft)
      setEditingDesc(false)
    } finally {
      setSavingDesc(false)
    }
  }

  const handleOpenRefine = () => {
    setGuidanceDraft(savedGuidance ?? '')
    setRefineOpen(true)
  }

  const handleApplyGuidance = async () => {
    setApplyingGuidance(true)
    try {
      await api.patchSingleLabel(labelId, { guidance: guidanceDraft })
      setSavedGuidance(guidanceDraft)
      const { summary } = await api.getSingleLabelGeminiPreview(labelId)
      setGeminiPreview(summary)
      setRefineOpen(false)
    } finally {
      setApplyingGuidance(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 px-[11px] py-[5px] rounded-full font-mono text-[11px] tracking-[0.04em] text-muted hover:text-on-canvas transition-colors"
        title="Click to see full readiness"
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${tierDot[readiness.tier]}`} />
        {tierLabel[readiness.tier]}
        <span className="text-faint">·</span>
        <span>{readiness.yes_count}y / {readiness.no_count}n</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-[360px] bg-bg-warm border border-edge rounded-md shadow-2xl overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-edge-subtle">
            <div className={`font-mono text-[10px] tracking-[0.18em] uppercase mb-1.5 ${
              readiness.tier === 'green'
                ? 'text-moss'
                : readiness.tier === 'amber'
                  ? 'text-ochre'
                  : 'text-faint'
            }`}>
              {tierTitle[readiness.tier]}
            </div>
            <div className="font-serif text-[14px] leading-[1.5] text-on-surface">
              {tierBlurb[readiness.tier]}
            </div>
          </div>

          <div className="px-5 pt-4 pb-2">
            <Gauge tier={readiness.tier} />
            <div className="mt-3.5 grid grid-cols-3 gap-3 font-mono text-[11px]">
              <Stat tone="moss" label="Yes" value={readiness.yes_count} />
              <Stat tone="brick" label="No" value={readiness.no_count} />
              <Stat tone="stone" label="Skip" value={readiness.skip_count} />
            </div>
            <div className="mt-3 font-mono text-[10px] tracking-[0.06em] uppercase text-faint">
              {readiness.conversations_walked} of {readiness.total_conversations} conversations walked
            </div>
            {readiness.hint && (
              <div className="mt-3 font-serif text-[13px] text-muted leading-[1.5]">
                {readiness.hint}
              </div>
            )}
          </div>

          {(readiness.tier === 'amber' || readiness.tier === 'green') && (
            <div className="px-5 pb-3">
              <div className="p-3 bg-surface rounded border border-edge-subtle">
                <div className="font-mono text-[9px] uppercase tracking-widest text-faint mb-1.5">
                  Gemini's understanding
                </div>

                {previewLoading ? (
                  <div className="font-serif text-[12px] text-faint italic">Generating…</div>
                ) : editingDesc ? (
                  <>
                    <textarea
                      autoFocus
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      rows={3}
                      className="w-full text-[13px] font-serif bg-canvas border border-edge rounded px-2 py-1.5 text-on-surface resize-none focus:outline-none focus:border-ochre"
                    />
                    <div className="flex justify-end gap-2 mt-1.5">
                      <button
                        onClick={() => setEditingDesc(false)}
                        className="font-mono text-[10px] text-faint hover:text-on-surface transition-colors"
                      >
                        cancel
                      </button>
                      <button
                        onClick={handleSaveDesc}
                        disabled={savingDesc}
                        className="font-mono text-[10px] text-ochre hover:brightness-110 transition-colors disabled:opacity-50"
                      >
                        {savingDesc ? 'saving…' : 'save'}
                      </button>
                    </div>
                  </>
                ) : geminiPreview ? (
                  <div className="flex items-start gap-2">
                    <div className="font-serif text-[13px] text-on-surface leading-[1.5] flex-1">
                      {geminiPreview}
                    </div>
                    <button
                      onClick={handleStartEdit}
                      title="Edit description"
                      className="text-faint hover:text-on-surface transition-colors shrink-0 mt-0.5"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z"/>
                      </svg>
                    </button>
                  </div>
                ) : null}

                {!previewLoading && !editingDesc && (
                  <div className="mt-2 border-t border-edge-subtle pt-2">
                    {refineOpen ? (
                      <>
                        <div className="font-mono text-[9px] uppercase tracking-widest text-faint mb-1.5">
                          Guidance for Gemini
                        </div>
                        <textarea
                          autoFocus
                          value={guidanceDraft}
                          onChange={(e) => setGuidanceDraft(e.target.value)}
                          placeholder="e.g. Focus on probability questions, not general math"
                          rows={3}
                          className="w-full text-[12px] font-serif bg-canvas border border-edge rounded px-2 py-1.5 text-on-surface placeholder:text-faint resize-none focus:outline-none focus:border-ochre"
                        />
                        <div className="flex justify-end gap-2 mt-1.5">
                          <button
                            onClick={() => setRefineOpen(false)}
                            className="font-mono text-[10px] text-faint hover:text-on-surface transition-colors"
                          >
                            cancel
                          </button>
                          <button
                            onClick={handleApplyGuidance}
                            disabled={applyingGuidance}
                            className="font-mono text-[10px] text-ochre hover:brightness-110 transition-colors disabled:opacity-50"
                          >
                            {applyingGuidance ? 'applying…' : 'apply'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        onClick={handleOpenRefine}
                        className="font-mono text-[10px] text-faint hover:text-ochre transition-colors"
                      >
                        {savedGuidance ? '✶ refine guidance' : '+ refine'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="px-5 pb-4 pt-2">
            <button
              onClick={() => {
                onHandoff()
                setOpen(false)
              }}
              disabled={readiness.tier === 'gray'}
              className={`w-full appearance-none border rounded-sm cursor-pointer font-sans font-semibold text-[13px] py-2 transition-all
                ${readiness.tier === 'gray'
                  ? 'border-edge bg-transparent text-faint cursor-not-allowed'
                  : 'border-ochre bg-ochre text-bg-warm hover:brightness-110'}
              `}
            >
              {readiness.tier === 'gray' ? 'Hand off to Gemini' : 'Hand off to Gemini →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Gauge({ tier }: { tier: ReadinessState['tier'] }) {
  const segments: { lit: boolean; tone: 'gray' | 'amber' | 'moss' }[] = [
    { lit: tier === 'amber' || tier === 'green', tone: 'amber' },
    { lit: tier === 'amber' || tier === 'green', tone: 'amber' },
    { lit: tier === 'green', tone: 'moss' },
  ]
  return (
    <div className="flex gap-1">
      {segments.map((s, i) => (
        <div
          key={i}
          className={`flex-1 h-1.5 rounded-sm ${
            !s.lit
              ? 'bg-edge'
              : s.tone === 'moss'
                ? 'bg-moss'
                : 'bg-ochre'
          }`}
        />
      ))}
    </div>
  )
}

function Stat({
  tone,
  label,
  value,
}: {
  tone: 'moss' | 'brick' | 'stone'
  label: string
  value: number
}) {
  const color = tone === 'moss' ? 'text-moss' : tone === 'brick' ? 'text-brick' : 'text-stone'
  return (
    <div className="flex flex-col items-start">
      <span className={`text-[18px] ${color}`}>{value}</span>
      <span className="text-[9px] tracking-[0.18em] uppercase text-faint">{label}</span>
    </div>
  )
}
