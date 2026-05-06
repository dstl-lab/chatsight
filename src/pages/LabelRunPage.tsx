import { useCallback, useEffect, useState } from 'react'
import { StripBar } from '../components/run/StripBar'
import { QueueLine } from '../components/run/QueueLine'
import { ConversationMeta } from '../components/run/ConversationMeta'
import { ThreadView } from '../components/run/ThreadView'
import { AssistFlank } from '../components/run/AssistFlank'
import { DecisionDock } from '../components/run/DecisionDock'
import { NoteLabelPopover } from '../components/run/NoteLabelPopover'
import { SummaryModal } from '../components/run/SummaryModal'
import { ReviewDock } from '../components/run/ReviewDock'
import { api } from '../services/api'
import type {
  DecisionValue,
  SingleLabel,
  FocusedMessage,
  ReadinessState,
  SingleLabelSummary,
  AssignmentMapping,
  UnmappedCount,
  ReviewItem,
  AssistNeighbor,
} from '../types'

export function LabelRunPage() {
  const [activeLabel, setActiveLabel] = useState<SingleLabel | null>(null)
  const [queued, setQueued] = useState<SingleLabel[]>([])
  const [focused, setFocused] = useState<FocusedMessage | null>(null)
  const [readiness, setReadiness] = useState<ReadinessState | null>(null)
  const [loading, setLoading] = useState(true)
  const [noteOpen, setNoteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<SingleLabelSummary | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [handoffPending, setHandoffPending] = useState(false)
  const [assignments, setAssignments] = useState<AssignmentMapping[]>([])
  const [unmapped, setUnmapped] = useState<UnmappedCount | null>(null)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null)
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[] | null>(null)
  const [reviewIdx, setReviewIdx] = useState(0)
  const [recent, setRecent] = useState<{ value: DecisionValue; label: string } | null>(null)
  const [assistNeighbors, setAssistNeighbors] = useState<AssistNeighbor[]>([])

  // Auto-clear the inline confirmation in the dock after a few seconds.
  useEffect(() => {
    if (!recent) return
    const t = setTimeout(() => setRecent(null), 4000)
    return () => clearTimeout(t)
  }, [recent])

  // Fetch assist neighbors whenever the focused message changes. Clear
  // synchronously so the previous message's neighbors don't linger during
  // the in-flight fetch, and swallow errors to a clean empty state.
  useEffect(() => {
    setAssistNeighbors([])
    if (!activeLabel || !focused) return
    let cancelled = false
    api.getAssist(
      activeLabel.id,
      focused.chatlog_id,
      focused.thread[focused.focus_index].message_index,
    ).then((res) => {
      if (!cancelled) setAssistNeighbors(res.neighbors)
    }).catch(() => {
      if (!cancelled) setAssistNeighbors([])
    })
    return () => { cancelled = true }
  }, [activeLabel?.id, focused?.chatlog_id, focused?.focus_index])

  // Refetch the page state. Called on mount, after decisions, after undo, after queue add.
  const refresh = useCallback(async () => {
    const active = await api.getActiveSingleLabel()
    setActiveLabel(active)
    const [a, um] = await Promise.all([api.listAssignments(), api.getUnmappedCount()])
    setAssignments(a)
    setUnmapped(um)
    if (active) {
      const [next, ready, q] = await Promise.all([
        api.getNextFocused(active.id, selectedAssignmentId ?? undefined),
        api.getReadiness(active.id),
        api.listSingleLabels({ phase: 'queued' }),
      ])
      setFocused(next)
      setReadiness(ready)
      setQueued(q)
      // If we landed in reviewing phase (e.g., page reload mid-review), prime the queue.
      if (active.phase === 'reviewing') {
        const rq = await api.getReviewQueue(active.id)
        setReviewQueue(rq)
        setReviewIdx(0)
      } else {
        setReviewQueue(null)
        setReviewIdx(0)
      }
    } else {
      setFocused(null)
      setReadiness(null)
      const q = await api.listSingleLabels({ phase: 'queued' })
      setQueued(q)
    }
  }, [selectedAssignmentId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const handleDecide = useCallback(
    async (value: DecisionValue) => {
      if (!activeLabel || !focused || busy) return
      setBusy(true)
      const decided = focused
      try {
        await api.decide(activeLabel.id, {
          chatlog_id: decided.chatlog_id,
          message_index: decided.message_index,
          value,
        })
        // Re-fetch the next message respecting the current assignment filter.
        const next = await api.getNextFocused(activeLabel.id, selectedAssignmentId ?? undefined)
        setFocused(next)
        const ready = await api.getReadiness(activeLabel.id)
        setReadiness(ready)
        setRecent({ value, label: `#${decided.chatlog_id}.${decided.message_index}` })
      } finally {
        setBusy(false)
      }
    },
    [activeLabel, focused, busy, selectedAssignmentId]
  )

  const handleUndo = useCallback(async () => {
    if (!activeLabel || busy) return
    setBusy(true)
    try {
      await api.undoLastDecision(activeLabel.id)
      const next = await api.getNextFocused(activeLabel.id, selectedAssignmentId ?? undefined)
      setFocused(next)
      const ready = await api.getReadiness(activeLabel.id)
      setReadiness(ready)
      setRecent(null)
    } finally {
      setBusy(false)
    }
  }, [activeLabel, busy, selectedAssignmentId])

  const handleSkipConversation = useCallback(async () => {
    if (!activeLabel || !focused || busy) return
    const skippedCid = focused.chatlog_id
    setBusy(true)
    try {
      const next = await api.skipConversation(activeLabel.id, skippedCid)
      setFocused(next)
      const ready = await api.getReadiness(activeLabel.id)
      setReadiness(ready)
      setRecent({ value: 'skip', label: `every remaining message in #${skippedCid}` })
    } finally {
      setBusy(false)
    }
  }, [activeLabel, focused, busy])

  const handleHandoff = useCallback(async () => {
    if (!activeLabel || handoffPending) return
    // Endpoint returns immediately. Backend has already deactivated this label and
    // activated the next queued one. Refresh state so /run swaps to the new active
    // label without a reload. Classification continues in the background and shows
    // up on /summaries with a progress meter.
    setHandoffPending(true)
    try {
      await api.handoffSingleLabel(activeLabel.id)
      await refresh()
    } catch (e) {
      console.error('handoff failed', e)
    } finally {
      setHandoffPending(false)
    }
  }, [activeLabel, handoffPending, refresh])

  const handleSampleHandoff = useCallback(async (n: number) => {
    if (!activeLabel || handoffPending) return
    setHandoffPending(true)
    try {
      await api.handoffSingleLabel(activeLabel.id, n)
      await refresh()
    } catch (e) {
      console.error('sample handoff failed', e)
    } finally {
      setHandoffPending(false)
    }
  }, [activeLabel, handoffPending, refresh])

  const handleContinueToReview = useCallback(async () => {
    setSummaryOpen(false)
    if (!activeLabel) return
    const rq = await api.getReviewQueue(activeLabel.id)
    setReviewQueue(rq)
    setReviewIdx(0)
    setActiveLabel((prev) => (prev ? { ...prev, phase: 'reviewing' } : prev))
  }, [activeLabel])

  const advanceReview = useCallback(() => {
    setReviewIdx((i) => i + 1)
  }, [])

  const handleReview = useCallback(
    async (value: 'yes' | 'no') => {
      if (!activeLabel || !reviewQueue || busy) return
      const item = reviewQueue[reviewIdx]
      if (!item) return
      setBusy(true)
      try {
        await api.reviewItem(activeLabel.id, {
          chatlog_id: item.chatlog_id,
          message_index: item.message_index,
          value,
        })
        advanceReview()
      } finally {
        setBusy(false)
      }
    },
    [activeLabel, reviewQueue, reviewIdx, busy, advanceReview]
  )

  const handleRefine = useCallback(async () => {
    if (!activeLabel) return
    await api.refineSingleLabel(activeLabel.id)
    setSummary(null)
    setSummaryOpen(false)
    await refresh()
  }, [activeLabel, refresh])

  const handleNoteSubmit = useCallback(
    async (name: string, description: string) => {
      await api.queueSingleLabel({ name, description: description || undefined })
      const q = await api.listSingleLabels({ phase: 'queued' })
      setQueued(q)
      setNoteOpen(false)
    },
    []
  )

  // Keyboard: Y/N/S decide (or review yes/no/skip-review), L note, Z undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ['INPUT', 'TEXTAREA'].includes(
        (document.activeElement as HTMLElement | null)?.tagName ?? ''
      )
      if (inField || noteOpen) return
      const inReview = activeLabel?.phase === 'reviewing' && reviewQueue !== null
      const k = e.key.toLowerCase()
      if (inReview) {
        if (k === 'y') handleReview('yes')
        else if (k === 'n') handleReview('no')
        else if (k === 's') advanceReview()
        else if (k === 'l') {
          e.preventDefault()
          setNoteOpen(true)
        }
        return
      }
      switch (k) {
        case 'y':
          handleDecide('yes')
          break
        case 'n':
          handleDecide('no')
          break
        case 's':
          if (e.shiftKey) {
            e.preventDefault()
            handleSkipConversation()
          } else {
            handleDecide('skip')
          }
          break
        case 'l':
          e.preventDefault()
          setNoteOpen(true)
          break
        case 'z':
          handleUndo()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [noteOpen, handleDecide, handleUndo, handleSkipConversation, handleReview, advanceReview, activeLabel, reviewQueue])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-faint text-xs tracking-widest uppercase animate-pulse">
        Loading…
      </div>
    )
  }

  if (!activeLabel) {
    return <NoActiveLabel onCreated={refresh} />
  }

  // ─── Review phase ───
  if (activeLabel.phase === 'reviewing' && reviewQueue) {
    if (reviewIdx >= reviewQueue.length) {
      return (
        <ReviewComplete
          label={activeLabel}
          totalReviewed={reviewQueue.length}
          onClose={async () => {
            await api.closeSingleLabel(activeLabel.id)
            await refresh()
          }}
        />
      )
    }
    const item = reviewQueue[reviewIdx]
    const flippedValue: 'yes' | 'no' = item.ai_value === 'yes' ? 'no' : 'yes'
    return (
      <div className="grid grid-rows-[auto_auto_auto_1fr_auto] flex-1 min-h-0 overflow-hidden bg-canvas">
        <div className="bg-canvas">
          <StripBar
            label={activeLabel}
            readiness={readiness ?? defaultReadiness()}
            assignments={assignments}
            unmapped={unmapped}
            selectedAssignmentId={selectedAssignmentId}
            onSelectAssignment={() => {}}
            onHandoff={handleHandoff}
            onSampleHandoff={handleSampleHandoff}
          />
          <QueueLine queued={queued} onAdd={() => setNoteOpen(true)} />
        </div>
        <ConversationMeta
          chatlogId={item.chatlog_id}
          notebook={item.notebook}
          turnCount={1}
        />
        <ReviewIntro item={item} />
        <div className="grid grid-cols-[1fr_320px] min-h-0 overflow-hidden">
          <ThreadView
            thread={[{ message_index: 0, role: 'student', text: item.text }]}
            focusIndex={0}
          />
          <AssistFlank neighbors={assistNeighbors} />
        </div>
        <ReviewDock
          aiValue={item.ai_value}
          aiConfidence={item.ai_confidence}
          position={reviewIdx + 1}
          total={reviewQueue.length}
          onConfirm={() => handleReview(item.ai_value)}
          onFlip={() => handleReview(flippedValue)}
          onSkip={advanceReview}
          disabled={busy}
        />

        <NoteLabelPopover
          open={noteOpen}
          onClose={() => setNoteOpen(false)}
          onSubmit={handleNoteSubmit}
        />
      </div>
    )
  }

  if (!focused) {
    return <DoneWithLabel label={activeLabel} onClose={async () => {
      await api.closeSingleLabel(activeLabel.id)
      await refresh()
    }} />
  }

  return (
    <div className="grid grid-rows-[auto_auto_1fr_auto] flex-1 min-h-0 overflow-hidden bg-canvas">
      <div className="bg-canvas">
        <StripBar
          label={activeLabel}
          readiness={readiness ?? defaultReadiness()}
          assignments={assignments}
          unmapped={unmapped}
          selectedAssignmentId={selectedAssignmentId}
          onSelectAssignment={(id) => setSelectedAssignmentId(id)}
          onHandoff={handleHandoff}
          onSampleHandoff={handleSampleHandoff}
        />
        <QueueLine queued={queued} onAdd={() => setNoteOpen(true)} />
      </div>
      <ConversationMeta
        chatlogId={focused.chatlog_id}
        notebook={focused.notebook}
        turnCount={focused.conversation_turn_count}
      />
      <div className="grid grid-cols-[1fr_320px] min-h-0 overflow-hidden">
        <ThreadView thread={focused.thread} focusIndex={focused.focus_index} />
        <AssistFlank neighbors={assistNeighbors} />
      </div>
      <DecisionDock
        onDecide={handleDecide}
        onUndo={handleUndo}
        onHandoff={handleHandoff}
        onSkipConversation={handleSkipConversation}
        disabled={busy}
        recent={recent}
      />

      <NoteLabelPopover
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onSubmit={handleNoteSubmit}
      />

      <SummaryModal
        summary={summary}
        open={summaryOpen}
        loading={false}
        onContinue={handleContinueToReview}
        onRefine={handleRefine}
      />
    </div>
  )
}

function defaultReadiness(): ReadinessState {
  return {
    tier: 'gray',
    yes_count: 0,
    no_count: 0,
    skip_count: 0,
    conversations_walked: 0,
    total_conversations: 0,
    hint: null,
  }
}

function NoActiveLabel({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const created = await api.createSingleLabel({ name: name.trim() })
      await api.activateSingleLabel(created.id)
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-canvas">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-3xl text-on-canvas mb-3 tracking-tight">
          One label at a time. <span className="text-ochre">Begin with what you most want to find.</span>
        </h1>
        <p className="font-serif text-on-surface mb-7 leading-relaxed">
          Pick or define a label, then walk conversations message-by-message answering yes or no.
        </p>
        <div className="flex gap-2 justify-center">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="e.g. help"
            className="appearance-none bg-surface border border-edge text-on-canvas px-3 py-2 rounded-sm font-sans text-sm focus:outline-none focus:border-ochre-dim w-56"
          />
          <button
            disabled={busy || !name.trim()}
            onClick={submit}
            className="appearance-none border border-ochre bg-ochre text-bg-warm px-4 py-2 rounded-sm cursor-pointer font-sans font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start labeling
          </button>
        </div>
      </div>
    </div>
  )
}

function ReviewIntro({ item }: { item: ReviewItem }) {
  const isYes = item.ai_value === 'yes'
  return (
    <div className="px-12 py-3 border-b border-edge-subtle bg-bg-warm">
      <div className="max-w-[760px] mx-auto flex items-baseline gap-3">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ochre">
          AI predicted
        </span>
        <span
          className={`font-serif text-[15px] tracking-[-0.005em] ${
            isYes ? 'text-moss' : 'text-brick'
          }`}
        >
          {isYes ? 'Yes' : 'No'}
        </span>
        <span className="font-mono text-[10px] tracking-[0.06em] text-faint">
          confidence {item.ai_confidence.toFixed(2)} — review and confirm or flip
        </span>
      </div>
    </div>
  )
}

function ReviewComplete({
  label,
  totalReviewed,
  onClose,
}: {
  label: SingleLabel
  totalReviewed: number
  onClose: () => void
}) {
  return (
    <div className="flex-1 flex items-center justify-center bg-canvas">
      <div className="max-w-md text-center">
        <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ochre mb-2">
          Review complete
        </div>
        <h1 className="font-serif text-3xl text-on-canvas mb-3 tracking-tight">
          You reviewed all {totalReviewed} low-confidence prediction{totalReviewed === 1 ? '' : 's'} for{' '}
          <span className="text-ochre">{label.name}</span>.
        </h1>
        <p className="font-serif text-on-surface mb-7 leading-relaxed">
          The high-confidence AI predictions remain as-is. Close the label to move to the next one in
          your queue.
        </p>
        <button
          onClick={onClose}
          className="appearance-none border border-ochre bg-ochre text-bg-warm px-4 py-2 rounded-sm cursor-pointer font-sans font-semibold text-sm hover:brightness-110 transition-all"
        >
          Close label
        </button>
      </div>
    </div>
  )
}

function DoneWithLabel({ label, onClose }: { label: SingleLabel; onClose: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-canvas">
      <div className="max-w-md text-center">
        <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ochre mb-2">
          Nothing left to label
        </div>
        <h1 className="font-serif text-3xl text-on-canvas mb-3 tracking-tight">
          You finished <span className="text-ochre">{label.name}</span>.
        </h1>
        <p className="font-serif text-on-surface mb-7 leading-relaxed">
          Every student message has a decision. You can hand off to Gemini for confidence, or close
          this label and move to the next.
        </p>
        <button
          onClick={onClose}
          className="appearance-none border border-ochre bg-ochre text-bg-warm px-4 py-2 rounded-sm cursor-pointer font-sans font-semibold text-sm hover:brightness-110 transition-all"
        >
          Close label
        </button>
      </div>
    </div>
  )
}
