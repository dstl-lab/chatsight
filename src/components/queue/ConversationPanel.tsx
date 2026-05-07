import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { ConversationMessage } from '../../types'

interface Props {
  messages: ConversationMessage[]
  currentMessageIndex: number
  chatlogId: number
  onClose: () => void
  onSelectMessage?: (chatlogId: number, messageIndex: number) => void
}

function AssistantMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-surface/60 rounded px-3 py-2">
      <span className="text-[9px] uppercase tracking-wide text-faint block mb-1">AI Tutor</span>
      <div className={`prose prose-sm dark:prose-invert prose-p:text-muted prose-headings:text-tertiary prose-li:text-muted prose-strong:text-tertiary prose-code:text-accent-muted max-w-none text-muted leading-relaxed text-xs ${expanded ? '' : 'line-clamp-6'}`}>
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {text}
        </ReactMarkdown>
      </div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="mt-1 text-[9px] text-disabled hover:text-muted transition-colors"
      >
        {expanded ? '▴ collapse' : '▾ expand'}
      </button>
    </div>
  )
}

export function ConversationPanel({ messages, currentMessageIndex, chatlogId, onClose, onSelectMessage }: Props) {
  const currentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentMessageIndex, messages.length])

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-canvas border-l border-edge-subtle flex flex-col z-40 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge-subtle shrink-0">
        <span className="text-xs font-medium text-tertiary uppercase tracking-wide">Full Conversation</span>
        <button
          onClick={onClose}
          className="text-faint hover:text-on-surface transition-colors text-lg leading-none"
          aria-label="Close conversation panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((msg, i) => {
          const isCurrent = msg.role === 'student' && msg.message_index === currentMessageIndex
          const isClickable = !isCurrent && msg.message_index !== null && !!onSelectMessage

          if (msg.role === 'assistant') {
            return <AssistantMessage key={i} text={msg.text} />
          }

          return (
            <div
              key={i}
              ref={isCurrent ? currentRef : null}
              onClick={isClickable ? () => onSelectMessage!(chatlogId, msg.message_index!) : undefined}
              className={`rounded px-3 py-2 transition-colors ${
                isCurrent
                  ? 'bg-[#0d1f33] border border-blue-600/70 ring-1 ring-blue-500/30'
                  : isClickable
                    ? 'bg-surface/40 border border-edge-subtle cursor-pointer hover:border-accent-border hover:bg-[#0d1f33]/40'
                    : 'bg-surface/40 border border-edge-subtle'
              }`}
            >
              <span className="text-[9px] uppercase tracking-wide text-accent-text block mb-1">
                Student · msg {msg.message_index}
              </span>
              <p className="text-xs text-on-surface leading-relaxed">{msg.text}</p>
              {msg.labels.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {msg.labels.map((l, j) => (
                    <span
                      key={j}
                      className="text-[9px] bg-elevated-hl/60 text-tertiary rounded px-1.5 py-0.5"
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
