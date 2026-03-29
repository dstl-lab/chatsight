import { useState, useEffect, useCallback } from 'react'
import type { QueueItem, LabelDefinition, LabelingSession, QueueStats, UpdateLabelRequest } from '../types'
import { api } from '../services/api'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { MessageCard } from '../components/queue/MessageCard'

interface UndoState {
  message: QueueItem
  labelNames: string[]
}

export function QueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [labels, setLabels] = useState<LabelDefinition[]>([])
  const [session, setSession] = useState<LabelingSession | null>(null)
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [skippedCount, setSkippedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [appliedLabelIds, setAppliedLabelIds] = useState<Set<number>>(new Set())
  const [undoState, setUndoState] = useState<UndoState | null>(null)

  const currentMessage = queue[currentIdx] ?? null
  const aiUnlocked = (session?.labeled_count ?? 0) >= 50

  const loadQueue = useCallback(async () => {
    const q = await api.getQueue(20)
    setQueue(q)
    setCurrentIdx(0)
  }, [])

  useEffect(() => {
    Promise.all([
      api.startSession(),
      api.getLabels(),
      api.getQueue(20),
      api.getQueueStats(),
    ]).then(([sess, lbls, q, st]) => {
      setSession(sess)
      setLabels(lbls)
      setQueue(q)
      setStats(st)
      setLoading(false)
    })
  }, [])

  // Load applied labels when current message changes
  useEffect(() => {
    if (!currentMessage) return
    api.getAppliedLabels(currentMessage.chatlog_id, currentMessage.message_index)
      .then(ids => setAppliedLabelIds(new Set(ids)))
  }, [currentMessage?.chatlog_id, currentMessage?.message_index])

  const advance = useCallback(() => {
    setCurrentIdx(i => {
      const next = i + 1
      if (next < queue.length) return next
      loadQueue()
      return 0
    })
  }, [queue.length, loadQueue])

  const handleToggleLabel = async (labelId: number) => {
    if (!currentMessage) return
    if (appliedLabelIds.has(labelId)) {
      await api.unapplyLabel(currentMessage.chatlog_id, currentMessage.message_index, labelId)
      setAppliedLabelIds(prev => { const next = new Set(prev); next.delete(labelId); return next })
    } else {
      await api.applyLabel({
        chatlog_id: currentMessage.chatlog_id,
        message_index: currentMessage.message_index,
        label_id: labelId,
      })
      setAppliedLabelIds(prev => new Set(prev).add(labelId))
    }
    api.getLabels().then(setLabels)
  }

  const handleCreateAndApply = async (name: string, description?: string) => {
    if (!currentMessage) return
    const newLabel = await api.createLabel({ name, description })
    setLabels(prev => [...prev, newLabel])
    await api.applyLabel({
      chatlog_id: currentMessage.chatlog_id,
      message_index: currentMessage.message_index,
      label_id: newLabel.id,
    })
    setAppliedLabelIds(prev => new Set(prev).add(newLabel.id))
  }

  const handleNext = async () => {
    if (!currentMessage) return
    if (appliedLabelIds.size > 0) {
      const labelNames = labels.filter(l => appliedLabelIds.has(l.id)).map(l => l.name)
      setUndoState({ message: currentMessage, labelNames })
      await api.advanceMessage(currentMessage.chatlog_id, currentMessage.message_index)
      setSession(s => s ? { ...s, labeled_count: s.labeled_count + 1 } : s)
      setStats(s => s ? { ...s, labeled_count: s.labeled_count + 1 } : s)
      setTimeout(() => setUndoState(prev => prev?.message === currentMessage ? null : prev), 8000)
    } else {
      setUndoState(null)
    }
    setAppliedLabelIds(new Set())
    advance()
  }

  const handleUndo = async () => {
    if (!undoState) return
    await api.undoLabels(undoState.message.chatlog_id, undoState.message.message_index)
    setSession(s => s ? { ...s, labeled_count: Math.max(0, s.labeled_count - 1) } : s)
    setStats(s => s ? { ...s, labeled_count: Math.max(0, s.labeled_count - 1) } : s)
    // Re-insert the message at current position
    setQueue(q => {
      const next = [...q]
      next.splice(currentIdx, 0, undoState.message)
      return next
    })
    setUndoState(null)
    api.getLabels().then(setLabels)
  }

  const handleSkip = async () => {
    if (!currentMessage) return
    await api.skipMessage(currentMessage.chatlog_id, currentMessage.message_index)
    setSkippedCount(s => s + 1)
    setStats(s => s ? { ...s, skipped_count: s.skipped_count + 1 } : s)
    setAppliedLabelIds(new Set())
    advance()
  }

  const handleUpdateLabel = async (id: number, body: UpdateLabelRequest) => {
    const updated = await api.updateLabel(id, body)
    setLabels(prev => prev.map(l => l.id === id ? updated : l))
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        Loading...
      </div>
    )
  }

  if (!currentMessage) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        All messages labeled!
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      <ProgressSidebar
        session={session}
        labels={labels}
        stats={stats}
        skippedCount={skippedCount}
        appliedLabelIds={appliedLabelIds}
        onToggleLabel={handleToggleLabel}
        onCreateAndApply={handleCreateAndApply}
        onUpdateLabel={handleUpdateLabel}
      />
      <div className="flex-1 flex flex-col min-h-0">
        {undoState && (
          <div className="mx-4 mt-3 flex items-center justify-between bg-neutral-900 border border-neutral-700 rounded px-4 py-2">
            <span className="text-xs text-neutral-300">
              Labeled as <span className="text-neutral-100 font-medium">{undoState.labelNames.join(', ')}</span>
            </span>
            <button onClick={handleUndo} className="text-xs text-blue-400 hover:text-blue-300 ml-4 shrink-0">
              Undo
            </button>
          </div>
        )}
        <MessageCard
          key={`${currentMessage.chatlog_id}-${currentMessage.message_index}`}
          item={currentMessage}
          aiUnlocked={aiUnlocked}
          suggestion={null}
          onSkip={handleSkip}
          onNext={handleNext}
          hasLabelsApplied={appliedLabelIds.size > 0}
        />
      </div>
    </div>
  )
}
