import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { QueueItem } from '../../types'

interface Props {
  messages: QueueItem[]
  focusedIndex: number
}

export function ConversationContext({ messages }: Props) {
  if (messages.length <= 1) return null
  return (
    <div className="opacity-60 space-y-3 mb-4 border-l-2 border-neutral-700 pl-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">Earlier in this conversation</div>
      {messages.slice(0, -1).map((m) => (
        <div key={`${m.chatlog_id}-${m.message_index}`} className="space-y-2">
          {m.context_before && (
            <div className="text-sm text-neutral-400">
              <span className="text-neutral-500 text-xs">tutor:</span>{' '}
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {m.context_before}
              </ReactMarkdown>
            </div>
          )}
          <div className="text-sm text-neutral-300">
            <span className="text-neutral-500 text-xs">student #{m.message_index}:</span>{' '}
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {m.message_text}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  )
}
