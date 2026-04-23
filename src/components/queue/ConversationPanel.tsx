import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { ConversationMessage } from '../../types'

interface Props {
  messages: ConversationMessage[]
  currentMessageIndex: number
  onClose: () => void
}

function AssistantMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-neutral-900/60 rounded px-3 py-2">
      <span className="text-[9px] uppercase tracking-wide text-neutral-500 block mb-1">AI Tutor</span>
      <div className={`prose prose-sm prose-invert prose-p:text-neutral-400 prose-headings:text-neutral-300 prose-li:text-neutral-400 prose-strong:text-neutral-300 prose-code:text-blue-300 max-w-none text-neutral-400 leading-relaxed text-xs ${expanded ? '' : 'line-clamp-6'}`}>
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {text}
        </ReactMarkdown>
      </div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="mt-1 text-[9px] text-neutral-600 hover:text-neutral-400 transition-colors"
      >
        {expanded ? '▴ collapse' : '▾ expand'}
      </button>
    </div>
  )
}

export function ConversationPanel({ messages, currentMessageIndex, onClose }: Props) {
  const currentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentMessageIndex, messages.length])

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-neutral-950 border-l border-neutral-800 flex flex-col z-40 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <span className="text-xs font-medium text-neutral-300 uppercase tracking-wide">Full Conversation</span>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none"
          aria-label="Close conversation panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((msg, i) => {
          const isCurrent = msg.role === 'student' && msg.message_index === currentMessageIndex

          if (msg.role === 'assistant') {
            return <AssistantMessage key={i} text={msg.text} />
          }

          return (
            <div
              key={i}
              ref={isCurrent ? currentRef : null}
              className={`rounded px-3 py-2 ${
                isCurrent
                  ? 'bg-[#0d1f33] border border-blue-600/70 ring-1 ring-blue-500/30'
                  : 'bg-neutral-900/40 border border-neutral-800'
              }`}
            >
              <span className="text-[9px] uppercase tracking-wide text-blue-400 block mb-1">
                Student · msg {msg.message_index}
              </span>
              <p className="text-xs text-neutral-200 leading-relaxed">{msg.text}</p>
              {msg.labels.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {msg.labels.map((l, j) => (
                    <span
                      key={j}
                      className="text-[9px] bg-neutral-700/60 text-neutral-300 rounded px-1.5 py-0.5"
                    >
                      {l.label_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
