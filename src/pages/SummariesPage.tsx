import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { HandoffSummaryItem, SummaryPattern } from '../types'

const RETRY_HOLD_MS = 1500
// Gemini Batch job states we treat as "in flight" — the UI swaps the % bar
// for an indeterminate state-aware display while we're in one of these.
// JOB_STATE_SUCCEEDED is excluded so the brief window between batch-success
// and phase='handed_off' falls through to the existing % bar (which is
// already advancing per-chunk as results are parsed).
const BATCH_FLIGHT_STATES = new Set(['JOB_STATE_PENDING', 'JOB_STATE_RUNNING'])
// If we haven't seen a successful poll in this long, the in-process
// BackgroundTask is most likely dead (e.g., killed by `uvicorn --reload`).
const STALE_POLL_MS = 30_000

function batchStateLabel(state: string): string {
  if (state === 'JOB_STATE_PENDING') return 'Queued'
  if (state === 'JOB_STATE_RUNNING') return 'Running'
  // Unexpected pre-terminal states: surface raw so it's at least debuggable.
  return state.replace(/^JOB_STATE_/, '').toLowerCase()
}

// Backend writes `datetime.utcnow()` (naive UTC) and Pydantic serializes it
// without a timezone marker, e.g. "2026-05-13T19:51:42.646785". Per ECMA-262,
// `Date.parse` interprets such strings as **local time**, which makes the
// elapsed counter clamp to 0 in any non-UTC timezone. Force-interpret as UTC
// by appending 'Z' when no offset is present.
function parseUtcIso(iso: string): number {
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso)
  return Date.parse(hasTz ? iso : iso + 'Z')
}

function formatElapsed(fromIso: string, nowMs: number): string {
  const startMs = parseUtcIso(fromIso)
  if (Number.isNaN(startMs)) return ''
  const sec = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function SummariesPage() {
  const [summaries, setSummaries] = useState<HandoffSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [openIds, setOpenIds] = useState<Set<number>>(new Set())

  const refresh = () => api.listHandoffSummaries().then(setSummaries)

  useEffect(() => {
    let cancelled = false
    const load = () => api.listHandoffSummaries().then((s) => {
      if (!cancelled) setSummaries(s)
    })
    load().finally(() => setLoading(false))

    // Poll every 2s while any summary is in 'classifying' phase so the progress
    // bar advances as the background task makes headway.
    const tick = setInterval(() => {
      const anyClassifying = summaries.some((s) => s.phase === 'classifying')
      if (anyClassifying) load()
    }, 2000)
    return () => {
      cancelled = true
      clearInterval(tick)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries.some((s) => s.phase === 'classifying')])

  const toggle = (id: number) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
          Handoff summaries
        </h1>
        <p className="font-serif text-on-surface text-[14px] leading-[1.6] max-w-[600px] mb-7">
          Every label that has been handed off to Gemini has a summary explaining what
          patterns it included and excluded. Use these to audit the classifier's behavior
          before trusting predictions.
        </p>

        {summaries.length === 0 ? (
          <div className="py-16 text-center">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-2">
              Nothing to see yet
            </div>
            <div className="font-serif text-on-surface text-[15px]">
              Hand off a label to Gemini from the Run page to generate your first summary.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {summaries.map((s) => (
              <SummaryCard
                key={s.label_id}
                summary={s}
                open={openIds.has(s.label_id)}
                onToggle={() => toggle(s.label_id)}
                onRetry={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface SummaryCardProps {
  summary: HandoffSummaryItem
  open: boolean
  onToggle: () => void
  onRetry: () => void
}

function SummaryCard({ summary, open, onToggle, onRetry }: SummaryCardProps) {
  const [retrying, setRetrying] = useState(false)

  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await api.retryHandoffSingleLabel(summary.label_id)
      // Brief hold so the spinner doesn't flash before the parent re-fetch.
      await new Promise((r) => setTimeout(r, RETRY_HOLD_MS))
      onRetry()
    } finally {
      setRetrying(false)
    }
  }

  const isClassifying = summary.phase === 'classifying'
  const isFailed = summary.phase === 'failed'
  const isRateLimited = isFailed && summary.error_kind === 'rate_limited'
  const isBatchInFlight =
    isClassifying &&
    summary.batch_state != null &&
    BATCH_FLIGHT_STATES.has(summary.batch_state)
  // Multi-batch handoffs advance `classified_count` by ~one-Nth each time a
  // sub-batch lands. Once *any* sub-batch has landed (classified_count > 0
  // while still in flight), the real % bar is more informative than the
  // indeterminate strip. Before the first landing we keep the strip — there
  // is genuinely nothing meaningful to point at yet.
  const hasRealBatchProgress = isBatchInFlight && (summary.classified_count ?? 0) > 0
  const hasBatchCounts =
    summary.batch_total_count != null &&
    summary.batch_total_count > 1 &&
    summary.batch_completed_count != null

  // 1s wall clock — only ticks while a batch is in flight, so other cards
  // don't re-render needlessly. Drives the elapsed-time label + stale-poll
  // hint. Backend writes `batch_polled_at` every 15s; the visible delta
  // refreshes on this 1s tick.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isBatchInFlight) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isBatchInFlight])

  const elapsed = summary.batch_submitted_at
    ? formatElapsed(summary.batch_submitted_at, now)
    : ''
  const lastPollAgeMs = summary.batch_polled_at
    ? now - parseUtcIso(summary.batch_polled_at)
    : 0
  const isStalePoll =
    isBatchInFlight && summary.batch_polled_at != null && lastPollAgeMs > STALE_POLL_MS
  const lastPollSec = Math.max(0, Math.floor(lastPollAgeMs / 1000))

  const progressPct =
    summary.classification_total && summary.classification_total > 0
      ? Math.round(
          ((summary.classified_count ?? 0) / summary.classification_total) * 100,
        )
      : 0

  return (
    <div className={`border rounded-md bg-bg-warm overflow-hidden ${
      isRateLimited ? 'border-ochre' : isFailed ? 'border-brick-dim' : 'border-edge'
    }`}>
      <button
        onClick={isClassifying ? undefined : onToggle}
        disabled={isClassifying}
        className={`w-full flex items-center justify-between gap-4 px-6 py-5 text-left transition-colors ${
          isClassifying ? 'cursor-default' : 'hover:bg-surface'
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className={`font-mono text-[10px] tracking-[0.16em] uppercase mb-1 flex items-center gap-2 ${
            isRateLimited ? 'text-ochre' : isFailed ? 'text-brick' : 'text-ochre'
          }`}>
            {isBatchInFlight ? (
              <>
                <span className="relative inline-flex">
                  <span className="absolute inline-flex w-1.5 h-1.5 rounded-full bg-ochre opacity-75 animate-ping" />
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-ochre" />
                </span>
                Classifying · Gemini batch · {batchStateLabel(summary.batch_state!)}
                {hasBatchCounts && (
                  <span className="text-faint" data-testid="batch-counts">
                    {' · '}
                    {summary.batch_completed_count} of {summary.batch_total_count} batches done
                  </span>
                )}
              </>
            ) : isClassifying ? (
              <>
                <span className="relative inline-flex">
                  <span className="absolute inline-flex w-1.5 h-1.5 rounded-full bg-ochre opacity-75 animate-ping" />
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-ochre" />
                </span>
                Classifying · Gemini · {summary.classified_count ?? 0} of{' '}
                {summary.classification_total ?? '?'}
              </>
            ) : isRateLimited ? (
              <>
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-ochre" />
                Rate-limited · Gemini
              </>
            ) : isFailed ? (
              <>
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-brick" />
                Failed · Gemini
              </>
            ) : (
              <>{summary.phase} · Gemini · {summary.yes_count + summary.no_count} classified</>
            )}
          </div>
          <div className="font-serif text-[20px] text-paper tracking-[-0.012em]">
            {summary.label_name}
          </div>
          {summary.description && (
            <div className="font-serif text-[13px] text-muted mt-1 truncate">
              {summary.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-5 shrink-0">
          {!isClassifying && !isFailed && (
            <>
              <Stat label="YES" value={summary.yes_count} tone="moss" />
              <Stat label="NO" value={summary.no_count} tone="brick" />
              <Stat label="Review" value={summary.review_count} tone="ochre" />
              <span className="font-mono text-[10px] text-faint">{open ? '▾' : '▸'}</span>
            </>
          )}
          {isClassifying && !isBatchInFlight && (
            <span className="font-mono text-[12px] text-ochre">{progressPct}%</span>
          )}
          {hasRealBatchProgress && (
            <span
              className="font-mono text-[12px] text-ochre tabular-nums"
              data-testid="batch-progress-pct"
            >
              {progressPct}%
            </span>
          )}
          {isBatchInFlight && elapsed && (
            <span
              className="font-mono text-[11px] text-muted tabular-nums"
              data-testid="batch-elapsed"
            >
              {elapsed}
            </span>
          )}
          {isFailed && !isRateLimited && (
            <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-brick">
              ×
            </span>
          )}
          {isRateLimited && (
            <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ochre">
              ⏱
            </span>
          )}
        </div>
      </button>

      {isClassifying && isBatchInFlight && (
        <div className="px-6 pb-5" data-testid="batch-inflight-block">
          {hasRealBatchProgress ? (
            <div
              className="h-[3px] bg-edge rounded-sm overflow-hidden"
              role="progressbar"
              aria-label="Gemini batch progress"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-ochre transition-[width] duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
                data-testid="batch-real-bar"
              />
            </div>
          ) : (
            <div
              className="h-[3px] bg-edge rounded-sm overflow-hidden relative"
              role="progressbar"
              aria-label="Gemini batch in progress"
              aria-busy="true"
            >
              <div className="absolute top-0 left-0 h-full w-[30%] bg-ochre batch-indeterminate-strip" />
            </div>
          )}
          <div className="mt-2 font-serif text-[13px] text-muted leading-[1.5]">
            {hasBatchCounts ? (
              <>
                Gemini is working through {summary.batch_total_count} sub-batches
                in parallel — the bar advances each time one lands. You can keep
                labeling other things in the meantime.
              </>
            ) : (
              <>
                This label was routed to the Gemini Batch API (the cheaper path
                used for jobs &gt; 500 messages). Google reports job-level state
                only, so there's no per-message progress to show until the
                batch completes — feel free to keep labeling other messages in
                the meantime.
              </>
            )}
          </div>
          {isStalePoll && (
            <div
              className="mt-2 font-mono text-[10px] tracking-[0.16em] uppercase text-ochre"
              data-testid="batch-stale-hint"
            >
              Last update {lastPollSec}s ago — task may have stalled
            </div>
          )}
        </div>
      )}

      {isClassifying && !isBatchInFlight && (
        <div className="px-6 pb-5">
          <div className="h-[3px] bg-edge rounded-sm overflow-hidden">
            <div
              className="h-full bg-ochre transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-2 font-serif text-[13px] text-muted leading-[1.5]">
            Gemini is working through the remaining unlabeled messages. The summary will
            appear here when it's done — feel free to keep labeling other messages.
          </div>
        </div>
      )}

      {isFailed && (
        <div className="px-6 pb-5 border-t border-edge-subtle pt-4">
          {isRateLimited ? (
            <>
              <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-ochre mb-2">
                Gemini rate limit hit
              </div>
              <div className="font-serif text-[13px] text-on-surface leading-[1.55]">
                Gemini returned a rate-limit / quota response while classifying this
                label. Nothing new was committed. Wait for the per-minute window to
                reset (or upgrade your tier) and try again. Large jobs (&gt; 500
                messages) route through the Batch API, which has its own quota — try
                the smaller path first if you hit this repeatedly.
              </div>
            </>
          ) : (
            <div className="font-serif text-[13px] text-on-surface leading-[1.55] mb-1">
              The background classification failed and was not committed. Your human
              decisions and any prior partial AI rows are intact — retry will pick up
              where it left off.
            </div>
          )}
          {summary.error && (
            <div className={`mt-1.5 font-mono text-[11px] break-words ${
              isRateLimited ? 'text-muted' : 'text-brick'
            }`}>
              {summary.error}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={retry}
              disabled={retrying}
              className={`appearance-none border px-3 py-1.5 rounded-sm font-mono text-[11px] tracking-[0.16em] uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                isRateLimited
                  ? 'border-ochre text-ochre hover:bg-ochre/10'
                  : 'border-edge text-on-surface hover:bg-surface'
              }`}
            >
              {retrying
                ? 'Retrying…'
                : isRateLimited
                ? 'Try again — quota may have reset'
                : 'Retry handoff'}
            </button>
          </div>
        </div>
      )}

      {open && !isClassifying && (
        <div className="grid grid-cols-[1fr_1px_1fr] border-t border-edge">
          <PatternColumn kind="included" patterns={summary.included} count={summary.yes_count} />
          <div className="bg-edge" />
          <PatternColumn kind="excluded" patterns={summary.excluded} count={summary.no_count} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'moss' | 'brick' | 'ochre' }) {
  const color = tone === 'moss' ? 'text-moss' : tone === 'brick' ? 'text-brick' : 'text-ochre'
  return (
    <div className="flex flex-col items-end">
      <span className={`font-mono text-[14px] ${color}`}>{value}</span>
      <span className="font-mono text-[8px] tracking-[0.18em] uppercase text-faint">{label}</span>
    </div>
  )
}

interface PatternColumnProps {
  kind: 'included' | 'excluded'
  patterns: SummaryPattern[]
  count: number
}

function PatternColumn({ kind, patterns, count }: PatternColumnProps) {
  const isYes = kind === 'included'
  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-3 pb-2.5 border-b border-dotted border-edge">
        <span>Patterns it {kind}</span>
        <span className={isYes ? 'text-moss' : 'text-brick'}>
          {isYes ? '+' : '−'}
          {count} · {isYes ? 'YES' : 'NO'}
        </span>
      </div>
      {patterns.length === 0 ? (
        <div className="font-serif text-on-surface text-[13px] py-2">
          No patterns surfaced.
        </div>
      ) : (
        patterns.map((p, i) => (
          <div
            key={i}
            className={`flex flex-col gap-[5px] py-2.5 ${
              i < patterns.length - 1 ? 'border-b border-edge-subtle' : ''
            }`}
          >
            <div className="flex justify-between items-baseline gap-3">
              <div className="font-serif text-[17px] text-paper tracking-[-0.005em] flex-1">
                <span className="opacity-50">"</span>
                {p.excerpt}
                <span className="opacity-50">"</span>
              </div>
              <div className="font-mono text-[10px] text-muted shrink-0">{p.frequency}</div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-faint">
              <span>conf</span>
              <div className="flex-1 h-px bg-edge rounded-sm overflow-hidden">
                <div
                  className={isYes ? 'bg-moss' : 'bg-brick'}
                  style={{ width: `${Math.round(p.confidence_avg * 100)}%`, height: '2px' }}
                />
              </div>
              <span>{p.confidence_avg.toFixed(2)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
