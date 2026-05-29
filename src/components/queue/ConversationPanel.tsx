import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Plus } from 'lucide-react'
import type { ConversationMessage, LabelDefinition } from '../../types'

interface Props {
  messages: ConversationMessage[]
  currentMessageIndex: number
  chatlogId: number
  onClose: () => void
  onSelectMessage?: (chatlogId: number, messageIndex: number) => void
  labels?: LabelDefinition[]
  onToggleLabelForMessage?: (chatlogId: number, messageIndex: number, labelId: number, currentlyApplied: boolean) => void
  onCreateLabelForMessage?: (chatlogId: number, messageIndex: number, name: string) => Promise<number>
}

function AssistantMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-surface/60 rounded px-3 py-2">
      <span className="text-[9px] uppercase tracking-wide text-faint block mb-1">AI Tutor</span>
      <div className={`prose prose-sm prose-p:text-muted prose-headings:text-tertiary prose-li:text-muted prose-strong:text-tertiary prose-code:text-ochre prose-pre:bg-elevated prose-pre:text-on-surface max-w-none text-muted leading-relaxed text-xs ${expanded ? '' : 'line-clamp-6'}`}>
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

export function ConversationPanel({ messages, currentMessageIndex, chatlogId, onClose, onSelectMessage, labels, onToggleLabelForMessage, onCreateLabelForMessage }: Props) {
  const currentRef = useRef<HTMLDivElement | null>(null)

  // Per-message-index set of applied label IDs, initialized from msg.labels
  const [localApplied, setLocalApplied] = useState<Record<number, Set<number>>>(() => {
    if (!labels) return {}
    const map: Record<number, Set<number>> = {}
    for (const msg of messages) {
      if (msg.role === 'student' && msg.message_index !== null) {
        map[msg.message_index] = new Set(
          msg.labels
            .map(l => labels.find(ld => ld.name === l.label_name)?.id)
            .filter((id): id is number => id !== undefined)
        )
      }
    }
    return map
  })

  // Track which message indices have their label panel open
  const [openLabelPanels, setOpenLabelPanels] = useState<Set<number>>(new Set())
  // Inline create-label input: which messageIndex has the input open + its value
  const [createOpen, setCreateOpen] = useState<number | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [creating, setCreating] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentMessageIndex, messages.length])

  useEffect(() => {
    if (createOpen !== null) createInputRef.current?.focus()
  }, [createOpen])

  const handleLabelToggle = (e: React.MouseEvent, messageIndex: number, labelId: number) => {
    e.stopPropagation()
    const currentlyApplied = localApplied[messageIndex]?.has(labelId) ?? false
    setLocalApplied(prev => {
      const set = new Set(prev[messageIndex] ?? [])
      if (currentlyApplied) set.delete(labelId)
      else set.add(labelId)
      return { ...prev, [messageIndex]: set }
    })
    onToggleLabelForMessage?.(chatlogId, messageIndex, labelId, currentlyApplied)
  }

  const toggleLabelPanel = (e: React.MouseEvent, messageIndex: number) => {
    e.stopPropagation()
    setOpenLabelPanels(prev => {
      const next = new Set(prev)
      if (next.has(messageIndex)) next.delete(messageIndex)
      else next.add(messageIndex)
      return next
    })
  }

  const openCreate = (e: React.MouseEvent, messageIndex: number) => {
    e.stopPropagation()
    setCreateOpen(messageIndex)
    setCreateValue('')
  }

  const submitCreate = async (e: React.FormEvent, messageIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    const name = createValue.trim()
    if (!name || !onCreateLabelForMessage) return
    setCreating(true)
    const newLabelId = await onCreateLabelForMessage(chatlogId, messageIndex, name)
    // Mark the new label as applied locally so the chip shows highlighted immediately
    setLocalApplied(prev => {
      const set = new Set(prev[messageIndex] ?? [])
      set.add(newLabelId)
      return { ...prev, [messageIndex]: set }
    })
    setCreating(false)
    setCreateOpen(null)
    setCreateValue('')
  }

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

          const appliedForMsg = localApplied[msg.message_index!] ?? new Set<number>()
          const panelOpen = openLabelPanels.has(msg.message_index!)
          const appliedLabels = labels?.filter(l => appliedForMsg.has(l.id)) ?? []

          return (
            <div
              key={i}
              ref={isCurrent ? currentRef : null}
              onClick={isClickable ? () => onSelectMessage!(chatlogId, msg.message_index!) : undefined}
              className={`rounded px-3 py-2 transition-colors ${
                isCurrent
                  ? 'bg-bg-warm border border-edge-warm ring-1 ring-ochre-dim/60'
                  : isClickable
                    ? 'bg-bg-warm/60 border border-edge-warm/70 cursor-pointer hover:bg-bg-warm hover:border-edge-warm'
                    : 'bg-bg-warm/60 border border-edge-warm/70'
              }`}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ochre block mb-1">
                Student · msg {msg.message_index}
              </span>
              <p className="text-xs text-on-surface leading-relaxed">{msg.text}</p>

              {/* Label area: applied chips + toggle button */}
              <div className="flex flex-wrap items-center gap-1 mt-2" onClick={e => e.stopPropagation()}>
                {/* Applied label chips (always visible when collapsed) */}
                {!panelOpen && appliedLabels.map(label => (
                  <span
                    key={label.id}
                    className="text-[9px] rounded-sm px-1.5 py-0.5 border bg-ochre/15 text-paper border-ochre-dim"
                  >
                    {label.name}
                  </span>
                ))}

                {/* "+" / "−" toggle button */}
                <button
                  onClick={e => toggleLabelPanel(e, msg.message_index!)}
                  className="flex items-center gap-0.5 text-[9px] text-faint hover:text-on-surface border border-edge-subtle hover:border-edge rounded px-1 py-0.5 transition-colors"
                  title={panelOpen ? 'Close labels' : 'Add / remove labels'}
                >
                  <Plus size={9} strokeWidth={2.5} className={panelOpen ? 'rotate-45 transition-transform' : 'transition-transform'} />
                </button>

                {/* Expanded label chips */}
                {panelOpen && (
                  <div className="w-full mt-1 space-y-1" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-1">
                      {labels && labels.length > 0 ? labels.map(label => {
                        const applied = appliedForMsg.has(label.id)
                        return (
                          <button
                            key={label.id}
                            onClick={e => handleLabelToggle(e, msg.message_index!, label.id)}
                            className={`text-[9px] rounded px-1.5 py-0.5 border transition-colors ${
                              applied
                                ? 'bg-ochre/15 text-paper border-ochre-dim'
                                : 'bg-transparent text-faint border-edge-subtle hover:text-on-surface hover:border-edge'
                            }`}
                          >
                            {label.name}
                          </button>
                        )
                      }) : (
                        <span className="text-[9px] text-disabled italic">No labels yet</span>
                      )}
                    </div>

                    {/* Inline create-label row */}
                    {onCreateLabelForMessage && (
                      createOpen === msg.message_index ? (
                        <form
                          onSubmit={e => submitCreate(e, msg.message_index!)}
                          className="flex items-center gap-1"
                        >
                          <input
                            ref={createInputRef}
                            value={createValue}
                            onChange={e => setCreateValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') { setCreateOpen(null); setCreateValue('') } }}
                            placeholder="label name"
                            disabled={creating}
                            className="flex-1 text-[9px] bg-transparent border border-edge rounded-sm px-1.5 py-0.5 text-on-surface placeholder:text-disabled focus:outline-none focus:border-ochre-dim"
                          />
                          <button
                            type="submit"
                            disabled={!createValue.trim() || creating}
                            className="text-[9px] text-ochre hover:text-paper disabled:opacity-40 transition-colors"
                          >
                            {creating ? '…' : '✓'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setCreateOpen(null); setCreateValue('') }}
                            className="text-[9px] text-disabled hover:text-muted transition-colors"
                          >
                            ✕
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={e => openCreate(e, msg.message_index!)}
                          className="flex items-center gap-0.5 text-[9px] text-faint hover:text-on-surface transition-colors"
                        >
                          <Plus size={9} strokeWidth={2.5} />
                          <span>New label</span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
