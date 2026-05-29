import { useCallback, useEffect, useRef, useState } from 'react'
import { StripBar } from '../components/run/StripBar'
import { ConversationMeta } from '../components/run/ConversationMeta'
import { AssistFlank } from '../components/run/AssistFlank'
import { RunTutorialOverlay, type RunTutorialStep } from '../components/run/RunTutorialOverlay'
import {
  shouldOfferFirstRunTutorial,
  markRunTutorialDone,
  takeTutorialReloadGate,
} from '../components/run/runTutorial'
import {
  getStarterBrowse,
  setStarterBrowse,
  clearStarterBrowse,
} from '../components/run/starterBrowse'
import {
  isPlaceholderLabelName,
  buildDraftSingleLabel,
} from '../components/run/labelPlaceholder'
import { DecisionDock } from '../components/run/DecisionDock'
import { RunProgressOverlay } from '../components/run/RunProgressOverlay'
import { NoteLabelPopover } from '../components/run/NoteLabelPopover'
import { SummaryModal } from '../components/run/SummaryModal'
import { AbortConfirmModal } from '../components/run/AbortConfirmModal'
import { DecisionWorkspace } from '../components/decision/DecisionWorkspace'
import { AiReviewDock } from '../components/decision/AiReviewDock'
import { useKeybinds } from '../hooks/useKeybinds'
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
  const [busyMessage, setBusyMessage] = useState('Working…')
  const [summary, setSummary] = useState<SingleLabelSummary | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [handoffPending, setHandoffPending] = useState(false)
  const [assignments, setAssignments] = useState<AssignmentMapping[]>([])
  const [unmapped, setUnmapped] = useState<UnmappedCount | null>(null)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null)
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[] | null>(null)
  const [reviewIdx, setReviewIdx] = useState(0)
  const [recent, setRecent] = useState<{ value: DecisionValue; label: string } | null>(null)
  // Yes/No confirmation is a colored flash on the matching dock button rather
  // than text; Skip still flows through `recent` since it has no colored flash.
  const [flash, setFlash] = useState<'yes' | 'no' | null>(null)
  const [assistNeighbors, setAssistNeighbors] = useState<AssistNeighbor[]>([])
  const [abortOpen, setAbortOpen] = useState(false)
  const [readinessOpen, setReadinessOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tutorialStep, setTutorialStep] = useState<RunTutorialStep | null>(null)
  const [labelNameDraft, setLabelNameDraft] = useState('')
  const [browseExhausted, setBrowseExhausted] = useState<number[]>([])

  // Mirrors activeLabel.id so async handlers can detect a label switch that
  // occurred while a decide/undo/skip was in flight, and avoid clobbering
  // state of the new active label with the old one's response.
  const activeLabelIdRef = useRef<number | null>(null)
  useEffect(() => {
    activeLabelIdRef.current = activeLabel?.id ?? null
  }, [activeLabel?.id])

  const syncActiveLabelCounts = useCallback(
    (labelId: number, state: ReadinessState) => {
      setActiveLabel((prev) => {
        if (!prev || prev.id !== labelId) return prev
        return {
          ...prev,
          yes_count: state.yes_count,
          no_count: state.no_count,
        }
      })
    },
    []
  )

  // Auto-clear the inline confirmation in the dock after a few seconds.
  useEffect(() => {
    if (!recent) return
    const t = setTimeout(() => setRecent(null), 4000)
    return () => clearTimeout(t)
  }, [recent])

  // Clear the yes/no flash either after a short window (so it stays visible if
  // the decide round-trip is fast) or as soon as the focused message changes
  // (so the next message renders without inherited tint).
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 220)
    return () => clearTimeout(t)
  }, [flash])
  useEffect(() => {
    setFlash(null)
  }, [focused?.chatlog_id, focused?.focus_index])

  useEffect(() => {
    setReadinessOpen(false)
  }, [activeLabel?.id])

  const openHandoffPanel = useCallback(() => {
    setReadinessOpen(true)
  }, [])

  // Reset the assignment filter when the active label changes (handoff,
  // abort, queue activation). Otherwise the new label inherits the previous
  // label's filter and may show "done" prematurely if the new label has no
  // messages in that assignment.
  useEffect(() => {
    setSelectedAssignmentId(null)
  }, [activeLabel?.id])

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
      focused.message_index,
      selectedAssignmentId ?? undefined,
    ).then((res) => {
      if (!cancelled) setAssistNeighbors(res.neighbors)
    }).catch(() => {
      if (!cancelled) setAssistNeighbors([])
    })
    return () => { cancelled = true }
  }, [activeLabel?.id, focused?.chatlog_id, focused?.focus_index, selectedAssignmentId])

  // Refetch the page state. Called on mount, after decisions, after undo, after queue add.
  const refresh = useCallback(async () => {
    const applyActiveState = async (active: SingleLabel) => {
      const [next, ready, q] = await Promise.all([
        api.getNextFocused(active.id, selectedAssignmentId ?? undefined),
        api.getReadiness(active.id),
        api.listSingleLabels({ phase: 'queued' }),
      ])
      let rq: ReviewItem[] | null = null
      if (active.phase === 'reviewing') {
        rq = await api.getReviewQueue(active.id)
      }
      setActiveLabel(active)
      setFocused(next)
      setReadiness(ready)
      setQueued(q)
      setReviewQueue(rq)
      setReviewIdx(0)
      if (isPlaceholderLabelName(active.name)) {
        setLabelNameDraft('')
      }
    }

    try {
      setLoadError(null)
      const active = await api.getActiveSingleLabel()
      const [a, um] = await Promise.all([api.listAssignments(), api.getUnmappedCount()])
      setAssignments(a)
      setUnmapped(um)
      if (active) {
        await applyActiveState(active)
        return
      }

      setActiveLabel(null)
      setFocused(null)
      setReadiness(null)
      setReviewQueue(null)
      setReviewIdx(0)

      const q = await api.listSingleLabels({ phase: 'queued' })
      setQueued(q)
      if (q.length > 0) {
        await api.activateSingleLabel(q[0].id)
        const activeNow = await api.getActiveSingleLabel()
        if (activeNow) {
          await applyActiveState(activeNow)
          return
        }
      }

      // No active or queued label on /run — start a new one via pre-label onboarding
      // (same path as an empty DB: after handoff, or when only classifying/complete labels exist).
      const existing = await api.listSingleLabels()
      const browse = getStarterBrowse()
      const starter = await api.getOnboardingStarter(
        browse
          ? { chatlogId: browse.chatlog_id, messageIndex: browse.message_index }
          : {},
      )
      if (!starter.focused) {
        throw new Error('Could not load starter conversation for labeling')
      }
      const exhausted = browse?.exhausted_chatlog_ids ?? []
      setBrowseExhausted(exhausted)
      setFocused(starter.focused)
      setStarterBrowse({
        chatlog_id: starter.focused.chatlog_id,
        message_index: starter.focused.message_index,
        exhausted_chatlog_ids: exhausted,
      })
      setReadiness(defaultReadiness())
      setLabelNameDraft('')
      if (shouldOfferFirstRunTutorial(existing)) {
        takeTutorialReloadGate()
        setTutorialStep(0)
      }
    } catch (e) {
      console.error('LabelRunPage refresh failed', e)
      setLoadError(e instanceof Error ? e.message : 'Failed to load run page')
    }
  }, [selectedAssignmentId])

  const finishTutorial = useCallback(() => {
    markRunTutorialDone()
    setTutorialStep(null)
  }, [])

  const advanceTutorial = useCallback(() => {
    setTutorialStep((step) => {
      if (step === null) return null
      if (step >= 3) {
        markRunTutorialDone()
        return null
      }
      return (step + 1) as RunTutorialStep
    })
  }, [])

  const tutorialActive = tutorialStep !== null

  const handleLabelNameCommit = useCallback(async () => {
    if (!activeLabel || tutorialActive) return
    const name = labelNameDraft.trim()
    if (!name || isPlaceholderLabelName(name) || name === activeLabel.name) return
    await api.patchSingleLabel(activeLabel.id, { name })
    await refresh()
  }, [activeLabel, labelNameDraft, tutorialActive, refresh])

  const handleCreateFirstLabel = useCallback(async () => {
    const name = labelNameDraft.trim()
    if (!name || !focused || busy || tutorialActive) return
    if (isPlaceholderLabelName(name)) return
    setBusyMessage('Creating label…')
    setBusy(true)
    try {
      const created = await api.createSingleLabel({
        name,
        seed_chatlog_id: focused.chatlog_id,
        seed_message_index: focused.message_index,
      })
      await api.activateSingleLabel(created.id)
      setLabelNameDraft('')
      clearStarterBrowse()
      setBrowseExhausted([])
      setBusyMessage('Loading label…')
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [labelNameDraft, focused, busy, tutorialActive, refresh])

  const handleBrowseSkip = useCallback(async () => {
    if (busy || tutorialActive || !focused || activeLabel) return
    setBusyMessage('Loading next message…')
    setBusy(true)
    try {
      const res = await api.skipOnboardingBrowse(
        focused.chatlog_id,
        focused.message_index,
        browseExhausted,
      )
      const exhausted = res.browse_reset ? [] : res.exhausted_chatlog_ids
      setBrowseExhausted(exhausted)
      setFocused(res.focused)
      setStarterBrowse({
        chatlog_id: res.focused.chatlog_id,
        message_index: res.focused.message_index,
        exhausted_chatlog_ids: exhausted,
      })
      setRecent({
        value: 'skip',
        label: `#${res.focused.chatlog_id}.${res.focused.message_index}`,
      })
    } catch (e) {
      console.error('browse skip failed', e)
      setLoadError(e instanceof Error ? e.message : 'Failed to advance to the next message')
    } finally {
      setBusy(false)
    }
  }, [busy, tutorialActive, focused, activeLabel, browseExhausted])

  const handleBrowseSkipConversation = useCallback(async () => {
    if (busy || tutorialActive || activeLabel) return
    setBusyMessage('Loading conversation…')
    setBusy(true)
    try {
      const exhausted = focused
        ? [...new Set([...browseExhausted, focused.chatlog_id])]
        : browseExhausted
      if (focused) {
        const res = await api.skipOnboardingBrowse(
          focused.chatlog_id,
          focused.message_index,
          exhausted,
          { skipConversation: true },
        )
        const nextExhausted = res.browse_reset ? [] : res.exhausted_chatlog_ids
        setBrowseExhausted(nextExhausted)
        setFocused(res.focused)
        setStarterBrowse({
          chatlog_id: res.focused.chatlog_id,
          message_index: res.focused.message_index,
          exhausted_chatlog_ids: nextExhausted,
        })
        return
      }
      const starter = await api.getOnboardingStarter({ refresh: true })
      if (!starter.focused) return
      setFocused(starter.focused)
      setStarterBrowse({
        chatlog_id: starter.focused.chatlog_id,
        message_index: starter.focused.message_index,
        exhausted_chatlog_ids: browseExhausted,
      })
    } catch (e) {
      console.error('browse skip conversation failed', e)
      setLoadError(e instanceof Error ? e.message : 'Failed to load another starter conversation')
    } finally {
      setBusy(false)
    }
  }, [busy, tutorialActive, activeLabel, focused, browseExhausted])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void refreshRef.current().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeLabel) return
    void refreshRef.current()
  }, [selectedAssignmentId, activeLabel?.id])

  const handleDecide = useCallback(
    async (value: DecisionValue) => {
      if (!activeLabel || !focused || busy || tutorialActive) return
      setBusyMessage(value === 'skip' ? 'Loading next message…' : 'Saving…')
      setBusy(true)
      const decided = focused
      const labelId = activeLabel.id
      // Yes/No: instant green/red flash on the box. Skip: keep the inline dock
      // caption, since there's no colored flash to convey what happened.
      if (value === 'yes' || value === 'no') {
        setRecent(null)
        setFlash(value)
      } else {
        setFlash(null)
        setRecent({ value, label: `#${decided.chatlog_id}.${decided.message_index}` })
      }
      try {
        const res = await api.decide(labelId, {
          chatlog_id: decided.chatlog_id,
          message_index: decided.message_index,
          value,
        }, selectedAssignmentId ?? undefined)
        if (activeLabelIdRef.current !== labelId) return
        setFocused(res.next)
        setReadiness(res.readiness)
        syncActiveLabelCounts(labelId, res.readiness)
      } finally {
        setBusy(false)
      }
    },
    [activeLabel, focused, busy, tutorialActive, selectedAssignmentId, syncActiveLabelCounts]
  )

  const handleUndo = useCallback(async () => {
    if (!activeLabel || busy) return
    setBusy(true)
    const labelId = activeLabel.id
    try {
      const res = await api.undoLastDecision(labelId, selectedAssignmentId ?? undefined)
      if (activeLabelIdRef.current !== labelId) return
      setFocused(res.next)
      setReadiness(res.readiness)
      syncActiveLabelCounts(labelId, res.readiness)
      setRecent(null)
    } finally {
      setBusy(false)
    }
  }, [activeLabel, busy, selectedAssignmentId, syncActiveLabelCounts])

  const handleSkip = useCallback(() => {
    if (!activeLabel) void handleBrowseSkip()
    else void handleDecide('skip')
  }, [activeLabel, handleBrowseSkip, handleDecide])

  const handleSkipConversation = useCallback(async () => {
    if (!focused || busy || tutorialActive) return
    if (!activeLabel) {
      await handleBrowseSkipConversation()
      return
    }
    const skippedCid = focused.chatlog_id
    setBusy(true)
    const labelId = activeLabel.id
    try {
      const res = await api.skipConversation(labelId, skippedCid)
      if (activeLabelIdRef.current !== labelId) return
      setFocused(res.next)
      setReadiness(res.readiness)
      syncActiveLabelCounts(labelId, res.readiness)
      setRecent({ value: 'skip', label: `every remaining message in #${skippedCid}` })
    } finally {
      setBusy(false)
    }
  }, [activeLabel, focused, busy, tutorialActive, syncActiveLabelCounts, handleBrowseSkipConversation])

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
    setLoadError(null)
    try {
      await api.handoffSingleLabel(activeLabel.id, n)
      await refresh()
    } catch (e) {
      console.error('sample handoff failed', e)
      setLoadError(
        e instanceof Error ? e.message : 'Sample handoff failed. Check the server logs.',
      )
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

  const handleAbortActive = useCallback(async () => {
    if (!activeLabel) return
    setAbortOpen(false)
    await api.abortSingleLabel(activeLabel.id)
    await refresh()
  }, [activeLabel, refresh])

  const handleRemoveQueued = useCallback(
    async (id: number) => {
      await api.deleteSingleLabel(id)
      const q = await api.listSingleLabels({ phase: 'queued' })
      setQueued(q)
    },
    []
  )

  const handleClearQueue = useCallback(async () => {
    await Promise.all(queued.map((q) => api.deleteSingleLabel(q.id)))
    const q = await api.listSingleLabels({ phase: 'queued' })
    setQueued(q)
  }, [queued])

  const handleNoteSubmit = useCallback(
    async (name: string, description: string) => {
      await api.queueSingleLabel({ name, description: description || undefined })
      const q = await api.listSingleLabels({ phase: 'queued' })
      setQueued(q)
      setNoteOpen(false)
    },
    []
  )

  const { keybinds } = useKeybinds()

  const handleSwitchToQueued = useCallback(
    async (id: number) => {
      if (busy) return
      setBusyMessage('Switching label…')
      setBusy(true)
      try {
        await api.switchToLabel(id)
        setBusyMessage('Loading label…')
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [busy, refresh]
  )

  const progressActive = loading || busy || handoffPending
  const progressMessage = handoffPending
    ? 'Handing off to Gemini…'
    : loading
      ? 'Loading…'
      : busyMessage

  // Shortcuts NOT owned by DecisionWorkspace: L (note popover) for both modes,
  // and Shift+[Skip] (skip conversation) for initial labeling only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (noteOpen || abortOpen || readinessOpen) return
      const k = e.key.toLowerCase()
      if (k === 'l' && focused && !tutorialActive) {
        e.preventDefault()
        setNoteOpen(true)
        return
      }

      const inReview = activeLabel?.phase === 'reviewing' && reviewQueue !== null
      const skipKey = keybinds.skip
      const isShiftSkip = e.shiftKey && (k === skipKey || `shift+${k}` === skipKey)

      if (!inReview && isShiftSkip) {
        e.preventDefault()
        handleSkipConversation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    noteOpen,
    abortOpen,
    readinessOpen,
    activeLabel,
    focused,
    reviewQueue,
    handleSkipConversation,
    keybinds.skip,
    tutorialActive,
  ])

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-brick text-sm max-w-md">{loadError}</p>
        <p className="text-faint text-xs max-w-md">
          If the backend just restarted, wait a few seconds and retry. Ensure port-forward to Postgres is running.
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void refresh().finally(() => setLoading(false))
          }}
          className="font-mono text-[11px] tracking-widest uppercase text-ochre hover:text-paper"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!focused) {
    if (activeLabel) {
      return (
        <>
          {progressActive && <RunProgressOverlay message={progressMessage} />}
        <DoneWithLabel
          label={activeLabel}
          onClose={async () => {
            await api.closeSingleLabel(activeLabel.id)
            await refresh()
          }}
        />
        </>
      )
    }
    return (
      <>
        {progressActive && <RunProgressOverlay message={progressMessage} />}
        <div className="flex flex-1 items-center justify-center text-faint text-xs tracking-widest uppercase animate-pulse">
          Loading…
        </div>
      </>
    )
  }

  const draftMode = !activeLabel
  const stripLabel = activeLabel ?? buildDraftSingleLabel(labelNameDraft)
  const thread = focused.thread ?? []
  const focusIndex = Math.min(
    Math.max(0, focused.focus_index),
    Math.max(0, thread.length - 1),
  )

  // ─── Review phase ───
  if (activeLabel?.phase === 'reviewing' && reviewQueue) {
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
    return (
      <>
        {progressActive && <RunProgressOverlay message={progressMessage} />}
        <DecisionWorkspace
          thread={[{ message_index: 0, role: 'student', text: item.text }]}
          focusIndex={0}
          header={
            <>
              <StripBar
                label={activeLabel}
                readiness={readiness ?? defaultReadiness()}
                assignments={assignments}
                unmapped={unmapped}
                selectedAssignmentId={selectedAssignmentId}
                onSelectAssignment={() => {}}
                onHandoff={handleHandoff}
                onLabelMetaUpdated={refresh}
                onSampleHandoff={handleSampleHandoff}
                readinessOpen={readinessOpen}
                onReadinessOpenChange={setReadinessOpen}
                queued={queued}
                onNoteAdd={() => setNoteOpen(true)}
                onClearAll={handleClearQueue}
                onSwitchQueued={(id) => void handleSwitchToQueued(id)}
                onRemoveQueued={(id) => void handleRemoveQueued(id)}
              />
              <ConversationMeta
                chatlogId={item.chatlog_id}
                notebook={item.notebook}
                turnCount={1}
              />
              <ReviewIntro item={item} />
            </>
          }
          flank={<AssistFlank neighbors={assistNeighbors} />}
          dock={
            <AiReviewDock
              mode={{
                kind: 'review',
                aiValue: item.ai_value,
                aiConfidence: item.ai_confidence,
                position: reviewIdx + 1,
                total: reviewQueue.length,
              }}
              onYes={() => handleReview('yes')}
              onNo={() => handleReview('no')}
              onSkip={advanceReview}
              onAbort={() => setAbortOpen(true)}
              disabled={progressActive || tutorialActive}
            />
          }
          onYes={() => handleReview('yes')}
          onNo={() => handleReview('no')}
          onSkip={advanceReview}
          disabled={progressActive || noteOpen || abortOpen}
        />
        <NoteLabelPopover
          open={noteOpen}
          onClose={() => setNoteOpen(false)}
          onSubmit={handleNoteSubmit}
        />
        {abortOpen && (
          <AbortConfirmModal
            labelName={activeLabel.name}
            yesCount={activeLabel.yes_count}
            noCount={activeLabel.no_count}
            onConfirm={handleAbortActive}
            onCancel={() => setAbortOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
      {progressActive && <RunProgressOverlay message={progressMessage} />}
      <DecisionWorkspace
        thread={thread}
        focusIndex={focusIndex}
        header={
          <>
            <StripBar
              label={stripLabel}
              readiness={readiness ?? defaultReadiness()}
              assignments={assignments}
              unmapped={unmapped}
              selectedAssignmentId={selectedAssignmentId}
              onSelectAssignment={(id) => setSelectedAssignmentId(id)}
              draftMode={draftMode}
              labelNameDraft={labelNameDraft}
              onLabelNameDraftChange={setLabelNameDraft}
              onDraftNameCommit={() => void handleCreateFirstLabel()}
              onLabelNameCommit={() => void handleLabelNameCommit()}
              labelNameLocked={tutorialActive}
              onHandoff={draftMode ? undefined : handleHandoff}
              onLabelMetaUpdated={draftMode ? undefined : refresh}
              onSampleHandoff={draftMode ? undefined : handleSampleHandoff}
              readinessOpen={readinessOpen}
              onReadinessOpenChange={setReadinessOpen}
              queued={queued}
              onNoteAdd={() => {
                if (!tutorialActive) setNoteOpen(true)
              }}
              onClearAll={handleClearQueue}
              onSwitchQueued={(id) => void handleSwitchToQueued(id)}
              onRemoveQueued={(id) => void handleRemoveQueued(id)}
            />
            <ConversationMeta
              chatlogId={focused.chatlog_id}
              notebook={focused.notebook}
              turnCount={focused.conversation_turn_count}
              samplingPick={focused.sampling_pick}
              conversationStudentMessages={focused.conversation_student_messages}
              pendingStudentMessageNumber={focused.pending_student_message_number}
            />
          </>
        }
        flank={<AssistFlank neighbors={assistNeighbors} />}
        dock={
          <DecisionDock
            onDecide={(v) => {
              if (v === 'skip') handleSkip()
              else if (!draftMode) void handleDecide(v)
            }}
            onUndo={handleUndo}
            onHandoff={openHandoffPanel}
            onSkipConversation={handleSkipConversation}
            onAbort={
              !draftMode && activeLabel ? () => setAbortOpen(true) : undefined
            }
            skipOnly={draftMode}
            disabled={progressActive || tutorialActive}
            recent={recent}
            flash={flash}
          />
        }
        onYes={() => {
          if (!draftMode) void handleDecide('yes')
        }}
        onNo={() => {
          if (!draftMode) void handleDecide('no')
        }}
        onSkip={handleSkip}
        onUndo={handleUndo}
        onAcceptAi={draftMode || recent ? undefined : openHandoffPanel}
        disabled={progressActive || noteOpen || abortOpen || readinessOpen || tutorialActive}
      />
      {tutorialStep !== null && (
        <RunTutorialOverlay
          step={tutorialStep}
          onAdvance={advanceTutorial}
          onSkip={finishTutorial}
        />
      )}
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
      {abortOpen && activeLabel && (
        <AbortConfirmModal
          labelName={activeLabel.name}
          yesCount={activeLabel.yes_count}
          noCount={activeLabel.no_count}
          onConfirm={handleAbortActive}
          onCancel={() => setAbortOpen(false)}
        />
      )}
    </>
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
