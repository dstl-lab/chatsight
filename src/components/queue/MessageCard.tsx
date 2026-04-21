import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { QueueItem, SuggestResponse } from '../../types'

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function truncateAtWord(text: string, maxLen: number, end: 'head' | 'tail'): string {
  if (text.length <= maxLen) return text

  if (end === 'head') {
    const slice = text.slice(0, maxLen)
    const lastSpace = slice.lastIndexOf(' ')
    return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '...'
  } else {
    const slice = text.slice(-maxLen)
    const firstSpace = slice.indexOf(' ')
    return '...' + (firstSpace >= 0 ? slice.slice(firstSpace + 1) : slice)
  }
}

interface Props {
  item: QueueItem
  aiUnlocked: boolean
  suggestion: SuggestResponse | null
  onSkip: () => void
  onNext: () => void
  onBackToQueue?: () => void
  hasLabelsApplied: boolean
  isReviewing?: boolean
  isSkippedReview?: boolean
}

export function MessageCard({ item, aiUnlocked, suggestion, onSkip, onNext, onBackToQueue, hasLabelsApplied, isReviewing, isSkippedReview }: Props) {
  const [showRationale, setShowRationale] = useState(false)
  const [beforeExpanded, setBeforeExpanded] = useState(false)
  const [afterExpanded, setAfterExpanded] = useState(false)

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
      {isReviewing && (
        <div className="bg-amber-900/30 border border-amber-700/40 rounded px-3 py-2">
          <span className="text-[10px] text-amber-400 uppercase tracking-wide">Reviewing previous message</span>
        </div>
      )}
      {item.context_before && (
        <div
          className="bg-neutral-900/70 border-l-2 border-neutral-600 rounded px-4 py-3 cursor-pointer group"
          onClick={() => setBeforeExpanded(v => !v)}
        >
          <span className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
            Preceding AI response
            <span className="ml-2 text-neutral-600 group-hover:text-neutral-400 transition-colors">
              {beforeExpanded ? '▾ collapse' : '▸ expand'}
            </span>
          </span>
          {beforeExpanded ? (
            <div className="prose prose-sm prose-invert prose-p:text-neutral-300 prose-headings:text-neutral-200 prose-li:text-neutral-300 prose-strong:text-neutral-200 prose-code:text-blue-300 max-w-none text-neutral-300 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{item.context_before}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-neutral-400 leading-relaxed italic">
              {truncateAtWord(stripMarkdown(item.context_before), 200, 'tail')}
            </p>
          )}
        </div>
      )}

      <div className="relative bg-[#0d1f33] border border-blue-700/60 rounded-lg p-4">
        <span className="text-[10px] uppercase tracking-wide text-blue-400 block mb-2">
          Student · message {item.message_index}
        </span>
        <p className="text-sm text-neutral-100 leading-relaxed">{item.message_text}</p>

        <div className="absolute bottom-3 right-3">
          {aiUnlocked && suggestion ? (
            <button
              onClick={() => setShowRationale(v => !v)}
              className="text-[9px] text-neutral-500 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 hover:text-neutral-300 transition-colors"
            >
              ✦ {suggestion.label_name} · why?
            </button>
          ) : !aiUnlocked ? (
            <span className="text-[8px] text-neutral-600 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5">
              AI unlocks at 20
            </span>
          ) : null}
        </div>
      </div>

      {showRationale && suggestion && (
        <div className="border-l-2 border-neutral-700 pl-3 py-1">
          <p className="text-[10px] text-neutral-400 leading-relaxed">
            <span className="text-neutral-600">Evidence: </span>
            &ldquo;{suggestion.evidence}&rdquo;
          </p>
          <p className="text-[10px] text-neutral-400 leading-relaxed mt-1">
            <span className="text-neutral-600">Rationale: </span>
            {suggestion.rationale}
          </p>
        </div>
      )}

      {item.context_after && (
        <div
          className="bg-neutral-900/70 border-l-2 border-neutral-600 rounded px-4 py-3 cursor-pointer group"
          onClick={() => setAfterExpanded(v => !v)}
        >
          <span className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
            Following AI response
            <span className="ml-2 text-neutral-600 group-hover:text-neutral-400 transition-colors">
              {afterExpanded ? '▾ collapse' : '▸ expand'}
            </span>
          </span>
          {afterExpanded ? (
            <div className="prose prose-sm prose-invert prose-p:text-neutral-300 prose-headings:text-neutral-200 prose-li:text-neutral-300 prose-strong:text-neutral-200 prose-code:text-blue-300 max-w-none text-neutral-300 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{item.context_after}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-neutral-400 leading-relaxed italic">
              {truncateAtWord(stripMarkdown(item.context_after), 200, 'head')}
            </p>
          )}
        </div>
      )}

      <div className={`flex pt-1 gap-2 ${isSkippedReview ? 'justify-between' : 'justify-end'}`}>
        {isSkippedReview && (
          <button
            onClick={onBackToQueue}
            className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
          >
            ← Back to Queue
          </button>
        )}
        <div className="flex gap-2">
          {isSkippedReview ? (
            <>
              <button
                onClick={onSkip}
                className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
              >
                Skip
              </button>
              <button
                onClick={onNext}
                disabled={!hasLabelsApplied}
                className="text-xs text-white bg-blue-600 rounded px-3 py-1.5 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </>
          ) : isReviewing ? (
            <button
              onClick={onNext}
              className="text-xs text-white bg-blue-600 rounded px-3 py-1.5 hover:bg-blue-500 transition-colors"
            >
              Back to queue
            </button>
          ) : (
            <>
              <button
                onClick={onSkip}
                className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
              >
                Skip
              </button>
              <button
                onClick={onNext}
                disabled={!hasLabelsApplied}
                className="text-xs text-white bg-blue-600 rounded px-3 py-1.5 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
