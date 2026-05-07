import type { SingleLabelSummary, SummaryPattern } from '../../types'

interface SummaryModalProps {
  summary: SingleLabelSummary | null
  open: boolean
  loading?: boolean
  onContinue: () => void
  onRefine: () => void
}

export function SummaryModal({ summary, open, loading, onContinue, onRefine }: SummaryModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm flex items-center justify-center p-[6vh_4vw]">
      <div className="bg-bg-warm border border-edge rounded-md w-[min(960px,100%)] max-h-[88vh] overflow-auto shadow-2xl">
        <div className="px-8 pt-6 pb-[18px] border-b border-edge">
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-ochre mb-2">
            {loading
              ? 'Gemini · Classifying…'
              : `Gemini · ${summary?.yes_count ?? 0} YES · ${summary?.no_count ?? 0} NO · ${summary?.review_count ?? 0} for review`}
          </div>
          <h2 className="font-serif font-medium text-[28px] m-0 leading-[1.2] text-paper tracking-[-0.015em]">
            {loading ? (
              <>Hand-off in progress…</>
            ) : (
              <>
                Here's what <span className="text-ochre">{summary?.label_name ?? 'this label'}</span>{' '}
                looks like to me.
              </>
            )}
          </h2>
          <div className="mt-2 text-[13px] text-muted">
            {loading
              ? 'Reading through every still-unlabeled student message and predicting yes or no.'
              : "Review what the model thinks counts before you trust the predictions. If anything reads wrong, refine your examples and re-run."}
          </div>
        </div>

        {!loading && summary && (
          <>
            <div className="grid grid-cols-[1fr_1px_1fr]">
              <PatternColumn
                kind="included"
                count={summary.yes_count}
                patterns={summary.included}
              />
              <div className="bg-edge" />
              <PatternColumn
                kind="excluded"
                count={summary.no_count}
                patterns={summary.excluded}
              />
            </div>

            <div className="flex items-center gap-3 px-7 py-[18px] border-t border-edge">
              <span className="font-mono text-[11px] tracking-[0.06em] uppercase text-faint">
                {summary.review_count} prediction{summary.review_count === 1 ? '' : 's'} below {summary.review_threshold} will land in your review queue
              </span>
              <span className="flex-1" />
              <button
                onClick={onRefine}
                className="appearance-none border border-edge bg-transparent text-on-surface px-5 py-[11px] rounded-sm cursor-pointer font-sans font-medium text-[13px] hover:text-brick hover:border-brick-dim transition-colors"
              >
                ← Refine examples, re-run
              </button>
              <button
                onClick={onContinue}
                className="appearance-none border border-ochre bg-ochre text-bg-warm px-5 py-[11px] rounded-sm cursor-pointer font-sans font-semibold text-[13px] hover:brightness-110 transition-all"
              >
                Continue to review →
              </button>
            </div>
          </>
        )}

        {loading && (
          <div className="px-8 py-12 flex items-center justify-center">
            <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-ochre animate-pulse">
              Working…
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface PatternColumnProps {
  kind: 'included' | 'excluded'
  count: number
  patterns: SummaryPattern[]
}

function PatternColumn({ kind, count, patterns }: PatternColumnProps) {
  const isYes = kind === 'included'
  return (
    <div className="px-7 py-[22px] pb-7">
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-3.5 pb-3 border-b border-dotted border-edge">
        <span>Patterns it {kind}</span>
        <span className={isYes ? 'text-moss' : 'text-brick'}>
          {isYes ? '+' : '−'}
          {count} · {isYes ? 'YES' : 'NO'}
        </span>
      </div>
      {patterns.length === 0 ? (
        <div className="font-serif text-on-surface text-[14px] py-2">
          No patterns surfaced.
        </div>
      ) : (
        patterns.map((p, i) => (
          <div
            key={i}
            className={`flex flex-col gap-[6px] py-3 ${
              i < patterns.length - 1 ? 'border-b border-edge-subtle' : ''
            }`}
          >
            <div className="flex justify-between items-baseline gap-3">
              <div className="font-serif text-[19px] text-paper tracking-[-0.005em] flex-1">
                <span className="opacity-50">"</span>
                {p.excerpt}
                <span className="opacity-50">"</span>
              </div>
              <div className="font-mono text-[11px] text-muted shrink-0">{p.frequency}</div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-faint">
              <span>conf</span>
              <div className="flex-1 h-px bg-edge rounded-sm overflow-hidden">
                <div
                  className={isYes ? 'bg-moss h-full' : 'bg-brick h-full'}
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
