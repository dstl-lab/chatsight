import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { QueueItem, SuggestResponse } from '../../types'

interface Props {
  item: QueueItem
  aiUnlocked: boolean
  suggestion: SuggestResponse | null
  onSkip: () => void
}

export function MessageCard({ item, aiUnlocked, suggestion, onSkip }: Props) {
  const [showRationale, setShowRationale] = useState(false)

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
      {item.context_before && (
        <div className="bg-neutral-900/70 border-l-2 border-neutral-600 rounded px-4 py-3">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">Preceding AI response</span>
          <div className="prose prose-sm prose-invert prose-p:text-neutral-300 prose-headings:text-neutral-200 prose-li:text-neutral-300 prose-strong:text-neutral-200 prose-code:text-blue-300 max-w-none text-neutral-300 leading-relaxed">
            <ReactMarkdown>{item.context_before}</ReactMarkdown>
          </div>
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
              AI unlocks at 50
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
        <div className="bg-neutral-900/70 border-l-2 border-neutral-600 rounded px-4 py-3">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">Following AI response</span>
          <div className="prose prose-sm prose-invert prose-p:text-neutral-300 prose-headings:text-neutral-200 prose-li:text-neutral-300 prose-strong:text-neutral-200 prose-code:text-blue-300 max-w-none text-neutral-300 leading-relaxed">
            <ReactMarkdown>{item.context_after}</ReactMarkdown>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={onSkip}
          className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
        >
          Skip →
        </button>
      </div>
    </div>
  )
}
