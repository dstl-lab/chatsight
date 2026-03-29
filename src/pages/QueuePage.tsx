// src/pages/QueuePage.tsx
import { useState, useEffect, useCallback } from 'react'
import type { QueueItem, LabelDefinition, LabelingSession } from '../types'
import { api } from '../services/api'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { MessageCard } from '../components/queue/MessageCard'
import { LabelStrip } from '../components/queue/LabelStrip'

export function QueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [labels, setLabels] = useState<LabelDefinition[]>([])
  const [session, setSession] = useState<LabelingSession | null>(null)
  const [skippedCount, setSkippedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const currentMessage = queue[currentIdx] ?? null
  const aiUnlocked = (session?.labeled_count ?? 0) >= 50

  const loadQueue = useCallback(async () => {
    const q = await api.getQueue(20)
    setQueue(q)
  }, [])

  useEffect(() => {
    Promise.all([api.startSession(), api.getLabels(), api.getQueue(20)])
      .then(([sess, lbls, q]) => {
        setSession(sess)
        setLabels(lbls)
        setQueue(q)
        setLoading(false)
      })
  }, [])

  const advance = useCallback(() => {
    setCurrentIdx(i => {
      const next = i + 1
      if (next < queue.length) return next
      loadQueue()
      return 0
    })
  }, [queue.length, loadQueue])

  const handleApplyLabel = async (labelId: number) => {
    if (!currentMessage) return
    await api.applyLabel({
      chatlog_id: currentMessage.chatlog_id,
      message_index: currentMessage.message_index,
      label_id: labelId,
    })
    setSession(s => s ? { ...s, labeled_count: s.labeled_count + 1 } : s)
    api.getLabels().then(setLabels)
    advance()
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
    setSession(s => s ? { ...s, labeled_count: s.labeled_count + 1 } : s)
    advance()
  }

  const handleSkip = async () => {
    if (!currentMessage) return
    await api.skipMessage(currentMessage.chatlog_id, currentMessage.message_index)
    setSkippedCount(s => s + 1)
    advance()
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
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-1 min-h-0">
        <ProgressSidebar
          session={session}
          labels={labels}
          totalMessages={queue.length}
          skippedCount={skippedCount}
        />
        <MessageCard
          item={currentMessage}
          aiUnlocked={aiUnlocked}
          suggestion={null}
          onSkip={handleSkip}
        />
      </div>
      <LabelStrip
        labels={labels}
        onApply={handleApplyLabel}
        onCreateAndApply={handleCreateAndApply}
      />
    </div>
  )
}
