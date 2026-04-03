import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { QueueItem, LabelDefinition, LabelingSession, QueueStats, SuggestResponse, UpdateLabelRequest, HistoryItem, OrphanedMessage, ArchiveReviewState } from '../types'
import { api } from '../services/api'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { MessageCard } from '../components/queue/MessageCard'
import { ArchiveConfirmModal } from '../components/queue/ArchiveConfirmModal'
import { ArchiveReviewBanner } from '../components/queue/ArchiveReviewBanner'
import { ArchiveReviewSidebar } from '../components/queue/ArchiveReviewSidebar'

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
  const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null)
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [autolabelStatus, setAutolabelStatus] = useState<{
    running: boolean; processed: number; total: number; error: string | null
  } | null>(null)
  const autolabelPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [reviewTarget, setReviewTarget] = useState<QueueItem | null>(null)
  const [archiveReview, setArchiveReview] = useState<ArchiveReviewState | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState<{
    labelId: number
    labelName: string
    totalApplications: number
    orphanedCount: number
    orphanedMessages: OrphanedMessage[]
  } | null>(null)

  const currentMessage = queue[currentIdx] ?? null
  const displayedMessage = reviewTarget ?? currentMessage
  const isReviewing = reviewTarget !== null
  const aiUnlocked = (stats?.labeled_count ?? 0) >= 20

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
      api.getQueuePosition(),
      api.getRecentHistory(5),
    ]).then(([sess, lbls, q, st, pos, hist]) => {
      setSession(sess)
      setLabels(lbls)
      setQueue(q)
      setStats(st)
      setRemaining(pos.total_remaining)
      setHistory(hist)
      setLoading(false)
    }).catch(err => {
      console.error('Failed to load queue data:', err)
      setLoading(false)
    })
  }, [])

  // Enter review mode from ?review= query param (e.g., from /history page)
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const reviewParam = searchParams.get('review')
    if (!reviewParam || loading) return
    const [cidStr, midxStr] = reviewParam.split('-')
    const cid = parseInt(cidStr)
    const midx = parseInt(midxStr)
    if (isNaN(cid) || isNaN(midx)) return
    setSearchParams({}, { replace: true })
    api.getMessage(cid, midx).then(msg => {
      setReviewTarget(msg)
    }).catch(() => {})
  }, [loading, searchParams, setSearchParams])

  // Load applied labels and AI suggestion when displayed message changes
  useEffect(() => {
    if (!displayedMessage) return
    api.getAppliedLabels(displayedMessage.chatlog_id, displayedMessage.message_index)
      .then(ids => setAppliedLabelIds(new Set(ids)))
    setSuggestion(null)
    if (aiUnlocked) {
      api.suggestLabel(displayedMessage.chatlog_id, displayedMessage.message_index)
        .then(s => { if (s.label_name) setSuggestion(s) })
        .catch(() => {})
    }
  }, [displayedMessage?.chatlog_id, displayedMessage?.message_index, aiUnlocked])

  const advance = useCallback(() => {
    setCurrentIdx(i => {
      const next = i + 1
      if (next < queue.length) return next
      loadQueue()
      return 0
    })
  }, [queue.length, loadQueue])

  const handleToggleLabel = useCallback(async (labelId: number) => {
    if (!displayedMessage) return
    if (appliedLabelIds.has(labelId)) {
      await api.unapplyLabel(displayedMessage.chatlog_id, displayedMessage.message_index, labelId)
      setAppliedLabelIds(prev => { const next = new Set(prev); next.delete(labelId); return next })
    } else {
      await api.applyLabel({
        chatlog_id: displayedMessage.chatlog_id,
        message_index: displayedMessage.message_index,
        label_id: labelId,
      })
      setAppliedLabelIds(prev => new Set(prev).add(labelId))
    }
    api.getLabels().then(setLabels)
  }, [displayedMessage, appliedLabelIds, archiveReview])

  const handleCreateAndApply = async (name: string, description?: string) => {
    if (!displayedMessage) return
    const newLabel = await api.createLabel({ name, description })
    setLabels(prev => [...prev, newLabel])
    await api.applyLabel({
      chatlog_id: displayedMessage.chatlog_id,
      message_index: displayedMessage.message_index,
      label_id: newLabel.id,
    })
    setAppliedLabelIds(prev => new Set(prev).add(newLabel.id))
  }

  const handleNext = useCallback(async () => {
    if (isReviewing && reviewTarget) {
      // Exit review mode — unskip if labels were applied to a previously-skipped message
      if (appliedLabelIds.size > 0) {
        await api.unskipMessage(reviewTarget.chatlog_id, reviewTarget.message_index).catch(() => {})
      }
      setReviewTarget(null)
      api.getRecentHistory(5).then(setHistory)
      api.getLabels().then(setLabels)
      return
    }
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
    api.getQueuePosition().then(p => setRemaining(p.total_remaining))
    api.getRecentHistory(5).then(setHistory)
  }, [isReviewing, reviewTarget, currentMessage, appliedLabelIds, labels, advance])

  const handleUndo = useCallback(async () => {
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
  }, [undoState, currentIdx])

  const handleSkip = useCallback(async () => {
    if (isReviewing || !currentMessage) return
    await api.skipMessage(currentMessage.chatlog_id, currentMessage.message_index)
    setSkippedCount(s => s + 1)
    setStats(s => s ? { ...s, skipped_count: s.skipped_count + 1 } : s)
    setAppliedLabelIds(new Set())
    advance()
  }, [isReviewing, currentMessage, advance])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        const availableLabels = archiveReview
          ? labels.filter(l => l.id !== archiveReview.labelId)
          : labels
        const label = availableLabels[num - 1]
        if (label) handleToggleLabel(label.id)
        return
      }
      if (e.key === 'Enter' || e.key === 'n') {
        if (isReviewing || appliedLabelIds.size > 0) handleNext()
        return
      }
      if (e.key === 's') {
        if (!isReviewing) handleSkip()
        return
      }
      if (e.key === 'z' || (e.ctrlKey && e.key === 'z')) {
        handleUndo()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [labels, appliedLabelIds, isReviewing, archiveReview, handleToggleLabel, handleNext, handleSkip, handleUndo])

  const handleUpdateLabel = async (id: number, body: UpdateLabelRequest) => {
    const updated = await api.updateLabel(id, body)
    setLabels(prev => prev.map(l => l.id === id ? updated : l))
  }

  const handleStartAutolabel = async () => {
    await api.startAutolabel()
    setAutolabelStatus({ running: true, processed: 0, total: 0, error: null })
    // Poll status every 2 seconds
    autolabelPollRef.current = setInterval(async () => {
      const status = await api.getAutolabelStatus()
      setAutolabelStatus(status)
      if (!status.running) {
        if (autolabelPollRef.current) clearInterval(autolabelPollRef.current)
        autolabelPollRef.current = null
        // Refresh stats and labels
        api.getQueueStats().then(setStats)
        api.getLabels().then(setLabels)
      }
    }, 2000)
  }

  const handleReorderLabels = useCallback(async (labelIds: number[]) => {
    const reordered = labelIds.map(id => labels.find(l => l.id === id)!).filter(Boolean)
    setLabels(reordered)
    await api.reorderLabels(labelIds)
  }, [labels])

  const handleArchiveLabel = useCallback(async (labelId: number) => {
    const label = labels.find(l => l.id === labelId)
    if (!label) return
    const orphanedData = await api.getOrphanedMessages(labelId)
    setArchiveConfirm({
      labelId,
      labelName: label.name,
      totalApplications: label.count,
      orphanedCount: orphanedData.count,
      orphanedMessages: orphanedData.messages,
    })
  }, [labels])

  const handleArchiveAnyway = useCallback(async () => {
    if (!archiveConfirm) return
    await api.archiveLabel(archiveConfirm.labelId)
    setArchiveConfirm(null)
    const [lbls, q, st] = await Promise.all([api.getLabels(), api.getQueue(20), api.getQueueStats()])
    setLabels(lbls)
    setQueue(q)
    setCurrentIdx(0)
    setStats(st)
    api.getQueuePosition().then(p => setRemaining(p.total_remaining))
    api.getRecentHistory(5).then(setHistory)
  }, [archiveConfirm])

  const handleEnterReviewMode = useCallback(() => {
    if (!archiveConfirm) return
    setArchiveReview({
      labelId: archiveConfirm.labelId,
      labelName: archiveConfirm.labelName,
      orphanedMessages: archiveConfirm.orphanedMessages,
      completedMessageKeys: new Set(),
    })
    setArchiveConfirm(null)
    if (archiveConfirm.orphanedMessages.length > 0) {
      const first = archiveConfirm.orphanedMessages[0]
      api.getMessage(first.chatlog_id, first.message_index).then(msg => {
        setReviewTarget(msg)
      })
    }
  }, [archiveConfirm])

  const handleSelectReviewMessage = useCallback((chatlogId: number, messageIndex: number) => {
    // Mark current message as completed if it has labels applied
    if (archiveReview && displayedMessage && appliedLabelIds.size > 0) {
      const key = `${displayedMessage.chatlog_id}-${displayedMessage.message_index}`
      setArchiveReview(prev => {
        if (!prev) return prev
        const next = new Set(prev.completedMessageKeys)
        next.add(key)
        return { ...prev, completedMessageKeys: next }
      })
    }
    api.getMessage(chatlogId, messageIndex).then(msg => {
      setReviewTarget(msg)
    })
  }, [archiveReview, displayedMessage, appliedLabelIds])

  const handleSkipAndArchive = useCallback(async () => {
    if (!archiveReview) return
    // Mark current message as completed if it has labels
    if (displayedMessage && appliedLabelIds.size > 0) {
      const key = `${displayedMessage.chatlog_id}-${displayedMessage.message_index}`
      setArchiveReview(prev => {
        if (!prev) return prev
        const next = new Set(prev.completedMessageKeys)
        next.add(key)
        return { ...prev, completedMessageKeys: next }
      })
    }
    await api.archiveLabel(archiveReview.labelId)
    setArchiveReview(null)
    setReviewTarget(null)
    const [lbls, q, st] = await Promise.all([api.getLabels(), api.getQueue(20), api.getQueueStats()])
    setLabels(lbls)
    setQueue(q)
    setCurrentIdx(0)
    setStats(st)
    api.getQueuePosition().then(p => setRemaining(p.total_remaining))
    api.getRecentHistory(5).then(setHistory)
  }, [archiveReview, displayedMessage, appliedLabelIds])

  const handleCompleteArchive = useCallback(async () => {
    if (!archiveReview) return
    // Mark current message as completed if it has labels
    if (displayedMessage && appliedLabelIds.size > 0) {
      const key = `${displayedMessage.chatlog_id}-${displayedMessage.message_index}`
      setArchiveReview(prev => {
        if (!prev) return prev
        const next = new Set(prev.completedMessageKeys)
        next.add(key)
        return { ...prev, completedMessageKeys: next }
      })
    }
    await api.archiveLabel(archiveReview.labelId)
    setArchiveReview(null)
    setReviewTarget(null)
    const [lbls, q, st] = await Promise.all([api.getLabels(), api.getQueue(20), api.getQueueStats()])
    setLabels(lbls)
    setQueue(q)
    setCurrentIdx(0)
    setStats(st)
    api.getQueuePosition().then(p => setRemaining(p.total_remaining))
    api.getRecentHistory(5).then(setHistory)
  }, [archiveReview, displayedMessage, appliedLabelIds])

  const handleCancelArchiveReview = useCallback(() => {
    setArchiveReview(null)
    setReviewTarget(null)
  }, [])

  const handleSelectHistoryItem = useCallback((item: HistoryItem) => {
    setReviewTarget({
      chatlog_id: item.chatlog_id,
      message_index: item.message_index,
      message_text: item.message_text,
      context_before: item.context_before,
      context_after: item.context_after,
    })
  }, [])

  const reviewingKey = reviewTarget
    ? `${reviewTarget.chatlog_id}-${reviewTarget.message_index}`
    : null

  if (loading) {
    return (
      <div className="flex-1 flex min-h-0" data-testid="loading-skeleton">
        {/* Sidebar skeleton */}
        <div className="w-52 shrink-0 border-r border-neutral-800 p-4 flex flex-col gap-5">
          <div>
            <div className="h-2 bg-neutral-800 rounded animate-pulse w-16 mb-3" />
            <div className="h-1.5 bg-neutral-800 rounded-full mb-2 animate-pulse" />
            <div className="h-3 bg-neutral-800 rounded animate-pulse w-20" />
          </div>
          <div className="flex flex-col gap-1.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-7 bg-neutral-800 rounded animate-pulse" />
            ))}
          </div>
        </div>
        {/* Message card skeleton */}
        <div className="flex-1 p-6 flex flex-col gap-4 min-h-0">
          <div className="h-3 bg-neutral-800 rounded animate-pulse w-1/4" />
          <div className="h-36 bg-neutral-800 rounded-lg animate-pulse" />
          <div className="h-3 bg-neutral-800 rounded animate-pulse w-3/4" />
          <div className="h-3 bg-neutral-800 rounded animate-pulse w-1/2" />
          <div className="mt-auto flex gap-2">
            <div className="h-8 w-16 bg-neutral-800 rounded animate-pulse" />
            <div className="h-8 w-16 bg-neutral-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!displayedMessage) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        All messages labeled!
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {archiveReview && (
        <ArchiveReviewBanner
          labelName={archiveReview.labelName}
          remainingCount={archiveReview.orphanedMessages.length - archiveReview.completedMessageKeys.size}
          onSkipAndArchive={handleSkipAndArchive}
          onCompleteArchive={handleCompleteArchive}
          onCancel={handleCancelArchiveReview}
        />
      )}
      <div className="flex-1 flex min-h-0">
        {archiveReview ? (
          <ArchiveReviewSidebar
            orphanedMessages={archiveReview.orphanedMessages}
            completedMessageKeys={archiveReview.completedMessageKeys}
            selectedChatlogId={displayedMessage?.chatlog_id ?? null}
            selectedMessageIndex={displayedMessage?.message_index ?? null}
            onSelectMessage={handleSelectReviewMessage}
            labels={labels}
            archivedLabelId={archiveReview.labelId}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={handleToggleLabel}
            onCreateAndApply={handleCreateAndApply}
            onUpdateLabel={handleUpdateLabel}
          />
        ) : (
          <ProgressSidebar
            session={session}
            labels={labels}
            stats={stats}
            skippedCount={skippedCount}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={handleToggleLabel}
            onCreateAndApply={handleCreateAndApply}
            onUpdateLabel={handleUpdateLabel}
            onStartAutolabel={handleStartAutolabel}
            autolabelStatus={autolabelStatus}
            remaining={remaining}
            history={history}
            onSelectHistoryItem={handleSelectHistoryItem}
            reviewingKey={reviewingKey}
            onReorderLabels={handleReorderLabels}
            onArchiveLabel={handleArchiveLabel}
          />
        )}
        <div className="flex-1 flex flex-col min-h-0">
          {undoState && !archiveReview && (
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
            key={`${displayedMessage.chatlog_id}-${displayedMessage.message_index}`}
            item={displayedMessage}
            aiUnlocked={aiUnlocked}
            suggestion={archiveReview ? null : suggestion}
            onSkip={handleSkip}
            onNext={handleNext}
            hasLabelsApplied={appliedLabelIds.size > 0}
            isReviewing={isReviewing}
          />
        </div>
      </div>
      {archiveConfirm && (
        <ArchiveConfirmModal
          labelName={archiveConfirm.labelName}
          totalApplications={archiveConfirm.totalApplications}
          orphanedCount={archiveConfirm.orphanedCount}
          onReviewAndRelabel={handleEnterReviewMode}
          onArchiveAnyway={handleArchiveAnyway}
          onCancel={() => setArchiveConfirm(null)}
        />
      )}
    </div>
  )
}
