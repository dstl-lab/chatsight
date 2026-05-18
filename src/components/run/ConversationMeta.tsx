import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SamplingPick } from '../../types'

interface ConversationMetaProps {
  chatlogId: number
  notebook: string | null
  turnCount: number
  samplingPick?: SamplingPick | null
  conversationStudentMessages?: number | null
  pendingStudentMessageNumber?: number | null
  neighborScoresAvailable?: boolean
  neighborUncertaintyPct?: number | null
  neighborNoveltyPct?: number | null
  conversationNoveltyPct?: number | null
  themeNoveltyPct?: number | null
  studentSpecificityPct?: number | null
  studentRarityPct?: number | null
}

const MONO = 'font-mono text-[10px] tracking-[0.14em] uppercase'

function Sep() {
  return <span className="mx-1.5 opacity-50 shrink-0">·</span>
}

function HoverTip({
  label,
  tip,
  tone = 'faint',
}: {
  label: string
  tip: string
  tone?: 'faint' | 'ochre' | 'paper'
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const id = useId()
  const toneClass =
    tone === 'ochre' ? 'text-ochre' : tone === 'paper' ? 'text-on-surface' : 'text-faint'

  const show = () => {
    const el = triggerRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setCoords({ top: r.bottom + 6, left: r.left })
    }
    setOpen(true)
  }

  const hide = () => setOpen(false)

  return (
    <span
      className="relative inline shrink-0"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        className={`cursor-help border-b border-faint/70 outline-none ${toneClass}`}
      >
        {label}
      </span>
      {open &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-[200] block w-[min(18rem,calc(100vw-3rem))] max-w-[18rem] rounded border border-edge bg-elevated px-2.5 py-2 text-[11px] font-sans normal-case tracking-normal leading-snug text-on-surface shadow-lg pointer-events-none"
          >
            {tip}
          </span>,
          document.body,
        )}
    </span>
  )
}

function pickLabel(pick: SamplingPick): string {
  switch (pick) {
    case 'explore':
      return 'Explore'
    case 'round_robin':
      return 'Robin'
    case 'continue':
      return 'Continue'
    default:
      return 'Continue'
  }
}

function pickTip(pick: SamplingPick): string {
  switch (pick) {
    case 'explore':
      return (
        'Explore queue opened this as a new conversation. We favor chats with specific, ' +
        'uncommon student questions — not generic “help” or copy-pasted prompts.'
      )
    case 'round_robin':
      return (
        'Round-robin queue: next new conversation in a fair fixed order ' +
        '(grouped by assignment, then shuffled).'
      )
    case 'continue':
      return (
        'You already labeled part of this chat — the queue keeps you here until ' +
        'it is finished before picking new conversations.'
      )
    default:
      return 'How this conversation was chosen from the labeling queue.'
  }
}

function pickTone(pick: SamplingPick): 'faint' | 'ochre' | 'paper' {
  if (pick === 'explore') return 'ochre'
  if (pick === 'continue') return 'paper'
  return 'faint'
}

export function ConversationMeta({
  chatlogId,
  notebook,
  turnCount,
  samplingPick,
  conversationStudentMessages,
  pendingStudentMessageNumber,
  neighborScoresAvailable,
  neighborUncertaintyPct,
  neighborNoveltyPct,
  conversationNoveltyPct,
  themeNoveltyPct,
  studentSpecificityPct,
  studentRarityPct,
}: ConversationMetaProps) {
  const showQueue =
    samplingPick != null &&
    conversationStudentMessages != null &&
    pendingStudentMessageNumber != null

  return (
    <div className={`px-12 py-5 border-t border-b border-edge-subtle bg-canvas ${MONO} text-faint`}>
      <div className="max-w-[760px] mx-auto overflow-x-auto overflow-y-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex flex-nowrap items-center whitespace-nowrap min-w-min">
          <span className="shrink-0 text-on-surface">Conversation #{chatlogId}</span>
          {notebook && (
            <>
              <Sep />
              <span className="shrink-0">{notebook}</span>
            </>
          )}
          <Sep />
          <span className="shrink-0">{turnCount} turns</span>

          {showQueue && (
            <>
              <Sep />
              <HoverTip
                label={pickLabel(samplingPick)}
                tip={pickTip(samplingPick)}
                tone={pickTone(samplingPick)}
              />
              <Sep />
              <HoverTip
                label={`Msg ${pendingStudentMessageNumber}/${conversationStudentMessages}`}
                tip={
                  `Labeling student message ${pendingStudentMessageNumber} of ` +
                  `${conversationStudentMessages} in this conversation (from the local cache).`
                }
              />
              {neighborScoresAvailable &&
                neighborUncertaintyPct != null &&
                neighborNoveltyPct != null && (
                  <>
                    <Sep />
                    <HoverTip
                      label={`Amb ${neighborUncertaintyPct}%`}
                      tip={
                        'Ambiguity from your nearest labeled neighbors: similar past messages ' +
                        'disagree on yes vs no. Higher means a harder borderline call.'
                      }
                    />
                    <Sep />
                    <HoverTip
                      label={`Msg nov ${neighborNoveltyPct}%`}
                      tip={
                        'Message novelty: this student line looks different from individual ' +
                        'messages you already labeled (embedding similarity).'
                      }
                    />
                  </>
                )}
              {conversationNoveltyPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Conv nov ${conversationNoveltyPct}%`}
                    tip={
                      'Conversation novelty: overall student messages in this chat look unlike ' +
                      'chats where you already applied this label.'
                    }
                  />
                </>
              )}
              {themeNoveltyPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Theme ${themeNoveltyPct}%`}
                    tip={
                      'Theme novelty: the main topic of this chat is unlike themes in ' +
                      'conversations you have already walked for this label.'
                    }
                  />
                </>
              )}
              {studentSpecificityPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Spec ${studentSpecificityPct}%`}
                    tip={
                      'Specificity: this looks like a real student question in their own words — ' +
                      'not vague “help”, question numbers only, or pasted assignment/error text.'
                    }
                  />
                </>
              )}
              {studentRarityPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Rare ${studentRarityPct}%`}
                    tip={
                      'Rarity: this wording is uncommon compared to other student messages ' +
                      'in the course corpus (many students did not ask it this way).'
                    }
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
