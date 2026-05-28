import { useEffect, useRef, useState } from 'react'
import { api } from '../../services/api'
import type { MultiLabelAutolabelSummaryItem } from '../../types'

const REVIEW_THRESHOLD = 0.75
const POLL_MS = 2000

export function SummariesPageMulti() {
  const [items, setItems] = useState<MultiLabelAutolabelSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [autolabelRunning, setAutolabelRunning] = useState(false)
  const [autolabelProgress, setAutolabelProgress] = useState<{ processed: number; total: number } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadSummary = () =>
    api.getMultiLabelAutolabelSummary().then(setItems)

  useEffect(() => {
    loadSummary().finally(() => setLoading(false))
  }, [])

  // Poll autolabel status; refresh summary data when a run finishes.
  useEffect(() => {
    const check = () => {
      api.getAutolabelStatus().then((s) => {
        setAutolabelRunning(s.running)
        if (s.running) {
          setAutolabelProgress({ processed: s.processed, total: s.total })
        } else {
          if (autolabelRunning) {
            // Just finished — refresh counts
            loadSummary()
            setAutolabelProgress(null)
          }
        }
      }).catch(() => {})
    }
    check()
    pollRef.current = setInterval(check, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autolabelRunning])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-faint text-xs tracking-widest uppercase animate-pulse">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-canvas">
      <div className="max-w-[960px] mx-auto px-12 py-12">
        <h1 className="font-serif font-medium text-[32px] text-paper tracking-[-0.018em] m-0 mb-1.5">
          Auto-label results
        </h1>
        <p className="font-serif text-on-surface text-[14px] leading-[1.6] max-w-[600px] mb-7">
          Per-label breakdown of human vs. Gemini-labeled messages. Confidence
          bars show the fraction of AI labels above the {Math.round(REVIEW_THRESHOLD * 100)}%
          threshold.
        </p>

        {autolabelRunning && autolabelProgress && (
          <div className="mb-6 border border-ochre/40 rounded-md px-5 py-4 bg-surface">
            <div className="flex items-center gap-2 mb-2">
              <span className="relative inline-flex">
                <span className="absolute inline-flex w-1.5 h-1.5 rounded-full bg-ochre opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-ochre" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ochre">
                Auto-labeling in progress
              </span>
            </div>
            <div className="h-[3px] bg-edge rounded-sm overflow-hidden mb-1">
              {autolabelProgress.total > 0 && (
                <div
                  className="h-full bg-ochre transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.round((autolabelProgress.processed / autolabelProgress.total) * 100)}%` }}
                />
              )}
            </div>
            <div className="font-serif text-[13px] text-muted">
              {autolabelProgress.processed} of {autolabelProgress.total} messages classified
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-2">
              No labels yet
            </div>
            <div className="font-serif text-on-surface text-[15px]">
              Create labels and start labeling from the Queue page.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <LabelCard key={item.label_id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LabelCard({ item }: { item: MultiLabelAutolabelSummaryItem }) {
  const confidencePct =
    item.ai_count > 0
      ? Math.round((item.high_conf_count / item.ai_count) * 100)
      : null

  return (
    <div className="border border-edge rounded-md bg-bg-warm px-6 py-5">
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <div className="font-serif text-[20px] text-paper tracking-[-0.012em]">
            {item.label_name}
          </div>
          {item.description && (
            <div className="font-serif text-[13px] text-muted mt-1">
              {item.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <Stat label="Human" value={item.human_count} tone="moss" />
          <Stat label="AI" value={item.ai_count} tone="ochre" />
        </div>
      </div>

      {item.ai_count === 0 ? (
        <div className="mt-3 font-mono text-[10px] tracking-[0.14em] uppercase text-faint">
          No AI labels yet — run Auto-label from the Queue page
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-faint mb-1.5">
            <span>AI confidence ≥ {Math.round(REVIEW_THRESHOLD * 100)}%</span>
            <span>{confidencePct}%</span>
          </div>
          <div className="h-[3px] bg-edge rounded-sm overflow-hidden">
            <div
              className="h-full bg-ochre/70 rounded-sm"
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <div className="mt-1.5 flex gap-4 font-mono text-[10px] text-faint">
            <span className="text-on-surface">{item.high_conf_count} high-conf</span>
            {item.low_conf_count > 0 && (
              <span>{item.low_conf_count} below threshold</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'moss' | 'ochre' }) {
  const color = tone === 'moss' ? 'text-moss' : 'text-ochre'
  return (
    <div className="flex flex-col items-end">
      <span className={`font-mono text-[14px] ${color}`}>{value}</span>
      <span className="font-mono text-[8px] tracking-[0.18em] uppercase text-faint">{label}</span>
    </div>
  )
}
