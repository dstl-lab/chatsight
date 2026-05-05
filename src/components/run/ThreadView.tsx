import { forwardRef, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { ConversationTurn } from '../../types'

interface ThreadViewProps {
  thread: ConversationTurn[]
  focusIndex: number
}

/**
 * Renders the entire conversation in chronological order. The focused turn (the
 * one currently under decision) is visually elevated in place — ochre rule on the
 * left, paper color, larger serif — so the instructor can see context on both sides.
 * On focus change, the highlighted turn auto-scrolls to viewport center.
 */
export function ThreadView({ thread, focusIndex }: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)

  // Center the focused turn whenever it changes (new conversation, advance, undo).
  useEffect(() => {
    const container = scrollRef.current
    const el = focusRef.current
    if (!container || !el) return
    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const elTopInScroll = eRect.top - cRect.top + container.scrollTop
    const target = Math.max(
      0,
      elTopInScroll - container.clientHeight / 2 + el.offsetHeight / 2,
    )
    container.scrollTo({ top: target, behavior: 'smooth' })
  }, [focusIndex, thread])

  return (
    <div
      ref={scrollRef}
      className="min-h-0 overflow-y-auto overflow-x-hidden px-12 py-6"
    >
      <div className="max-w-[760px] mx-auto">
        {thread.map((turn, i) => {
          const isFocus = i === focusIndex
          if (isFocus) {
            return (
              <FocusedTurn
                key={`${turn.role}-${turn.message_index}`}
                ref={focusRef}
                turn={turn}
              />
            )
          }
          return <ContextTurn key={`${turn.role}-${turn.message_index}`} turn={turn} />
        })}
      </div>
    </div>
  )
}

function ContextTurn({ turn }: { turn: ConversationTurn }) {
  const isTutor = turn.role === 'tutor'
  return (
    <div className="flex gap-[22px] mb-[22px]">
      <div className="shrink-0 w-[60px] font-mono text-[10px] tracking-[0.08em] uppercase text-faint pt-1.5">
        {isTutor ? 'Tutor' : 'Student'}
      </div>
      <div
        className={`flex-1 font-serif text-[16px] leading-[1.6] font-normal ${
          isTutor ? 'text-faint' : 'text-muted'
        }`}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            code: ({ children, ...props }) => (
              <code className="font-mono text-[13px] text-on-surface" {...props}>
                {children}
              </code>
            ),
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          }}
        >
          {turn.text}
        </ReactMarkdown>
      </div>
    </div>
  )
}

const FocusedTurn = forwardRef<HTMLDivElement, { turn: ConversationTurn }>(
  function FocusedTurn({ turn }, ref) {
    return (
      <div
        ref={ref}
        className="relative -mx-6 px-6 py-5 my-3 bg-bg-warm rounded-sm scroll-mt-24"
      >
        <div
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px] bg-ochre"
        />
        <div className="flex gap-[22px]">
          <div className="shrink-0 w-[60px] font-mono text-[10px] tracking-[0.08em] uppercase text-ochre pt-1">
            Student
          </div>
          <div className="flex-1 font-serif text-[22px] leading-[1.45] font-normal text-paper tracking-[-0.012em]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code: ({ children, ...props }) => (
                  <code className="font-mono text-[17px] text-ochre" {...props}>
                    {children}
                  </code>
                ),
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              }}
            >
              {turn.text}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    )
  },
)
