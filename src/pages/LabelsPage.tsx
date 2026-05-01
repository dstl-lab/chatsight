import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../services/api'
import type { LabelDefinition, LabelExample, SuggestResponse } from '../types'

// ── Components ───────────────────────────────────────────────────────────────

/**
 * QuickRefineModal: The "4-directional" high-speed labeling tool.
 */
function QuickRefineModal({
  allLabels,
  initialLabel,
  onClose,
  onComplete,
}: {
  allLabels: LabelDefinition[]
  initialLabel: LabelDefinition | null // if refining a specific label's messages
  onClose: () => void
  onComplete: (assignments: Record<string, number>, deleteLabelId?: number) => void
}) {
  const [examples, setExamples] = useState<LabelExample[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [swipeDir, setSwipeDir] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null)
  const [showConcise, setShowConcise] = useState(false)
  const [conciseCache, setConciseCache] = useState<Record<string, string>>({})

  const currentEx = examples[currentIndex] ?? null

  useEffect(() => {
    if (!currentEx) return
    setSuggestion(null)
    setShowConcise(false)
    
    // Pre-fetch suggestion
    api.suggestLabel(currentEx.chatlog_id, currentEx.message_index)
       .then(setSuggestion)
       .catch(() => {})

    // Pre-fetch concise summary
    const key = `${currentEx.chatlog_id}:${currentEx.message_index}`
    if (!conciseCache[key]) {
      api.getConciseMessage(currentEx.chatlog_id, currentEx.message_index)
         .then(res => setConciseCache(prev => ({ ...prev, [key]: res.concise_text })))
         .catch(() => {})
    }
  }, [currentEx, conciseCache])

  const toggleConcise = useCallback(() => {
    if (!currentEx) return
    setShowConcise(prev => !prev)
  }, [currentEx])
  
  // Slots: mapping direction to a LabelDefinition
  const [slots, setSlots] = useState<Record<'top' | 'bottom' | 'left' | 'right', LabelDefinition | null>>({
    top: null, bottom: null, left: null, right: null
  })

  // State for dragging from sidebar
  const [draggingLabel, setDraggingLabel] = useState<LabelDefinition | null>(null)
  // State for dragging from a slot (for swapping/moving)
  const [draggingSlot, setDraggingSlot] = useState<'top' | 'bottom' | 'left' | 'right' | null>(null)

  useEffect(() => {
    const fetchExamples = async () => {
      try {
        if (initialLabel) {
          const data = await api.getLabelExamples(initialLabel.id, 50)
          setExamples(data)
        } else {
          // If no label, fetch from queue (unlabeled messages)
          const data = await api.getQueue(50)
          // Map QueueItem to LabelExample shape
          setExamples(data.map(q => ({
            chatlog_id: q.chatlog_id,
            message_index: q.message_index,
            message_text: q.message_text,
            label_id: 0,
            applied_by: 'none'
          })))
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchExamples()
  }, [initialLabel])

  const handleAssign = useCallback((label: LabelDefinition | null, dir?: string) => {
    if (!label || currentIndex >= examples.length) return
    setSwipeDir(dir || null)
    const ex = examples[currentIndex]
    setAssignments(prev => ({
      ...prev,
      [`${ex.chatlog_id}:${ex.message_index}`]: label.id
    }))
    setCurrentIndex(prev => prev + 1)
  }, [currentIndex, examples])

  const handleBack = useCallback(() => {
    if (currentIndex <= 0) return
    setSwipeDir('back')
    setCurrentIndex(prev => prev - 1)
  }, [currentIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') handleAssign(slots.top, 'up')
      if (e.key === 'ArrowDown') handleAssign(slots.bottom, 'down')
      if (e.key === 'ArrowLeft') handleAssign(slots.left, 'left')
      if (e.key === 'ArrowRight') handleAssign(slots.right, 'right')
      if (e.key === 'Backspace') handleBack()
      
      if (e.key === 'Enter' && suggestion) {
        // Accept if current suggestion is in one of the slots
        const dir = (['top', 'bottom', 'left', 'right'] as const).find(d => slots[d]?.name === suggestion.label_name)
        if (dir) handleAssign(slots[dir], dir)
      }

      if (e.key === 'Tab' && suggestion) {
        e.preventDefault()
        // Accept suggestion even if not in a slot
        const label = allLabels.find(l => l.name === suggestion.label_name)
        if (label) handleAssign(label, 'up')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleAssign, handleBack, slots, suggestion, allLabels])

  const handleDropOnSlot = (targetDir: 'top' | 'bottom' | 'left' | 'right') => {
    if (draggingLabel) {
      setSlots(prev => ({ ...prev, [targetDir]: draggingLabel }))
    } else if (draggingSlot && draggingSlot !== targetDir) {
      // Swap or move
      const sourceLabel = slots[draggingSlot]
      const targetLabel = slots[targetDir]
      setSlots(prev => ({
        ...prev,
        [draggingSlot]: targetLabel,
        [targetDir]: sourceLabel
      }))
    }
    setDraggingLabel(null)
    setDraggingSlot(null)
  }

  const progress = examples.length > 0 ? (currentIndex / examples.length) * 100 : 0

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-canvas flex items-center justify-center text-faint text-xs tracking-widest uppercase animate-pulse">
      Preparing refine session...
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas select-none">
      {/* Header */}
      <div className="h-16 bg-surface border-b border-edge-subtle flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-on-canvas">Quick Refine</h2>
          <p className="text-[10px] font-bold text-faint uppercase tracking-widest">
            {initialLabel ? `Refining: ${initialLabel.name}` : 'Multi-label Sorting'}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-disabled uppercase tracking-widest">Progress</span>
            <span className="text-sm font-mono font-medium text-muted">{currentIndex} / {examples.length}</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-elevated rounded-full text-faint hover:text-tertiary transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Workspace */}
        <div className="flex-1 relative flex flex-col items-center justify-center p-12 bg-[#050505] overflow-hidden">
          
          {/* Concise View Toggle */}
          {currentIndex < examples.length && currentEx && (
            <button
              onClick={toggleConcise}
              className={`
                absolute bottom-12 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 rounded-full border transition-all flex items-center gap-2
                ${showConcise 
                  ? 'bg-ai-action border-purple-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]' 
                  : 'bg-surface border-edge text-muted hover:border-edge-strong hover:text-on-surface'}
              `}
            >
              <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <span className="text-sm">✨</span> {showConcise ? 'Regular View' : 'Concise View'}
              </span>
            </button>
          )}

          {/* Slots */}
          {(['top', 'bottom', 'left', 'right'] as const).map(dir => (
            <div 
              key={dir}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDropOnSlot(dir)}
              className={`
                absolute flex flex-col items-center justify-center gap-2 transition-all duration-300 z-10
                ${dir === 'top' ? 'top-8 left-1/2 -translate-x-1/2' : ''}
                ${dir === 'bottom' ? 'bottom-8 left-1/2 -translate-x-1/2' : ''}
                ${dir === 'left' ? 'left-8 top-1/2 -translate-y-1/2' : ''}
                ${dir === 'right' ? 'right-8 top-1/2 -translate-y-1/2' : ''}
              `}
            >
              <div 
                draggable={!!slots[dir]}
                onDragStart={() => setDraggingSlot(dir)}
                className={`
                  w-32 h-20 rounded-lg border-2 flex flex-col items-center justify-center p-3 text-center transition-all cursor-pointer
                  ${slots[dir] 
                    ? (suggestion?.label_name === slots[dir]?.name 
                        ? 'bg-accent-surface border-accent-border shadow-[0_0_30px_rgba(59,130,246,0.4)] scale-110' 
                        : 'bg-surface border-accent shadow-[0_0_15px_rgba(37,99,235,0.2)]')
                    : 'bg-surface/20 border-dashed border-edge-subtle text-disabled'}
                  ${draggingSlot === dir ? 'opacity-50 scale-90' : 'hover:scale-105'}
                `}
                onClick={() => slots[dir] && handleAssign(slots[dir], dir)}
              >
                <span className="text-[8px] font-black uppercase tracking-widest text-disabled mb-1">
                  {dir === 'top' ? '↑ Up' : dir === 'bottom' ? '↓ Down' : dir === 'left' ? '← Left' : '→ Right'}
                </span>
                <span className={`text-[11px] font-bold truncate w-full ${slots[dir] ? (suggestion?.label_name === slots[dir]?.name ? 'text-accent-on-surface' : 'text-accent-text') : 'text-disabled'}`}>
                  {slots[dir]?.name || 'Drop Label'}
                </span>
              </div>
            </div>
          ))}

          {/* Central Message */}
          <div className="w-full max-w-xl relative flex items-center justify-center">
            <AnimatePresence mode="popLayout" custom={swipeDir}>
              {currentIndex < examples.length && currentEx ? (
                <motion.div 
                  key={currentIndex}
                  custom={swipeDir}
                  variants={{
                    initial: (dir) => ({ 
                      scale: dir === 'back' ? 1.1 : 0.9, 
                      opacity: 0,
                      x: dir === 'back' ? -100 : 0
                    }),
                    animate: { 
                      scale: 1, 
                      opacity: 1, 
                      x: 0, 
                      y: 0,
                      transition: { type: 'spring', damping: 25, stiffness: 200 } 
                    },
                    exit: (dir) => {
                      const dist = 800;
                      return {
                        x: dir === 'left' ? -dist : dir === 'right' ? dist : 0,
                        y: dir === 'up' ? -dist : dir === 'down' ? dist : 0,
                        opacity: 0,
                        rotate: dir === 'left' ? -20 : dir === 'right' ? 20 : 0,
                        transition: { duration: 0.4, ease: 'anticipate' }
                      }
                    }
                  }}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="w-full relative"
                >
                  <div className="relative w-full h-[350px]">
                    {/* Original Card */}
                    <motion.div 
                      animate={{ 
                        y: showConcise ? 20 : 0, 
                        scale: showConcise ? 0.95 : 1, 
                        opacity: showConcise ? 0.4 : 1,
                        filter: showConcise ? 'blur(2px)' : 'blur(0px)'
                      }}
                      className={`
                        absolute inset-0 bg-surface border border-edge-subtle rounded-xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300
                        ${showConcise ? 'z-0' : 'z-10'}
                      `}
                    >
                      <div className="p-10 flex-1 overflow-y-auto flex items-center justify-center text-center">
                        <p className="text-xl font-medium text-on-surface leading-relaxed italic">
                          "{currentEx.message_text}"
                        </p>
                      </div>
                      {suggestion && !showConcise && (
                        <div className="px-6 py-3 bg-accent-surface/40 border-t border-edge-subtle/50 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <span className="text-[9px] font-black uppercase tracking-widest text-accent-muted shrink-0">AI Logic</span>
                            <p className="text-[10px] text-faint italic truncate">{suggestion.rationale}</p>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); const label = allLabels.find(l => l.name === suggestion.label_name); if (label) handleAssign(label, 'up'); }}
                            className="flex items-center gap-2 px-2 py-1 bg-accent-surface border border-accent-border rounded hover:bg-accent-surface transition-all shrink-0"
                          >
                            <kbd className="px-1.5 py-0.5 bg-canvas border border-edge rounded text-accent-text font-mono text-[9px] font-bold">TAB</kbd>
                            <span className="text-[9px] font-bold text-accent-text uppercase tracking-tighter truncate max-w-[80px]">Apply "{suggestion.label_name}"</span>
                          </button>
                        </div>
                      )}
                    </motion.div>

                    {/* Concise Card */}
                    <motion.div 
                      initial={{ y: 20, scale: 0.95, opacity: 0 }}
                      animate={{ 
                        y: showConcise ? 0 : 20, 
                        scale: showConcise ? 1 : 0.95, 
                        opacity: showConcise ? 1 : 0,
                        pointerEvents: showConcise ? 'auto' : 'none'
                      }}
                      className={`
                        absolute inset-0 bg-surface border border-ai-border rounded-xl shadow-2xl overflow-hidden flex flex-col
                        ${showConcise ? 'z-10' : 'z-0'}
                      `}
                    >
                      <div className="p-10 flex-1 flex flex-col items-center justify-center text-center bg-gradient-to-b from-purple-950/20 to-neutral-900 relative">
                        <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-ai-text">AI Summary</span>
                        </div>
                        <p className="text-2xl font-bold text-on-canvas leading-tight">
                          "{conciseCache[`${currentEx.chatlog_id}:${currentEx.message_index}`] || 'Summarizing...'}"
                        </p>
                        <button onClick={() => toggleConcise()} className="mt-8 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-faint border border-edge-subtle rounded-full hover:bg-elevated transition-all">Back to Full Text</button>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              ) : currentIndex >= examples.length && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center"
                >
                  <div className="w-16 h-16 bg-accent-surface text-accent-muted border border-accent-border rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h3 className="text-xl font-bold text-on-canvas mb-2">Refine Session Complete!</h3>
                  <p className="text-sm text-faint mb-8 max-w-sm mx-auto">Assignments made: {Object.keys(assignments).length}</p>
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={() => onComplete(assignments)}
                      className="px-8 py-2.5 bg-accent text-white text-sm font-bold rounded hover:bg-accent-hover transition-colors shadow-lg shadow-blue-900/20"
                    >
                      Save & Finish
                    </button>
                    {initialLabel && (
                      <button 
                        onClick={() => onComplete(assignments, initialLabel.id)}
                        className="px-8 py-2.5 text-danger-text text-xs font-bold hover:bg-danger-surface transition-colors rounded"
                      >
                        Save & Delete "{initialLabel.name}"
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Sidebar: Labels to Drag */}
        <aside className="w-64 border-l border-edge-subtle p-5 flex flex-col gap-4 bg-surface/20 shrink-0 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-faint font-bold mb-1">Taxonomy</p>
          <div className="flex flex-col gap-2">
            {allLabels.map(l => (
              <div
                key={l.id}
                draggable
                onDragStart={() => setDraggingLabel(l)}
                onDragEnd={() => setDraggingLabel(null)}
                className="w-full text-left bg-surface border border-edge-subtle hover:border-accent rounded px-3 py-2.5 text-[11px] text-muted hover:text-accent-on-surface transition-all cursor-grab active:cursor-grabbing group"
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold truncate">{l.name}</span>
                  <span className="text-[9px] text-disabled">{l.count}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-auto p-3 bg-accent-surface/40 border border-blue-900/30 rounded text-[10px] text-accent-text leading-relaxed italic">
            Tip: Drag labels into the directional slots, then use arrow keys to sort messages at high speed.
          </div>
        </aside>
      </div>

      {/* Footer Progress Bar */}
      <div className="h-1 bg-surface w-full overflow-hidden shrink-0">
        <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

/**
 * DeleteConfirmModal
 */
function DeleteConfirmModal({ label, onClose, onConfirm }: { label: LabelDefinition, onClose: () => void, onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-surface border border-red-900/50 rounded-lg p-8 max-w-sm w-full text-center shadow-2xl">
        <div className="w-16 h-16 bg-danger-surface text-danger-text border border-danger-surface rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </div>
        <h3 className="text-lg font-bold text-on-canvas mb-2">Delete "{label.name}"?</h3>
        <p className="text-sm text-faint mb-8 leading-relaxed">
          This will remove the label definition. Existing applications will be preserved but the label itself will be gone.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-xs font-bold text-faint hover:text-tertiary">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2 bg-danger text-white text-xs font-bold rounded hover:bg-danger-hover transition-colors">Delete Label</button>
        </div>
      </div>
    </div>
  )
}

/**
 * SplitSessionModal: The "Tinder-style" 2-way swipe interface.
 */
function SplitSessionModal({
  label,
  onClose,
  onComplete,
}: {
  label: LabelDefinition
  onClose: () => void
  onComplete: (nameA: string, nameB: string, assignments: Record<string, string>) => void
}) {
  const [nameA, setNameA] = useState('')
  const [nameB, setNameB] = useState('')
  const [step, setStep] = useState<'names' | 'swiping'>('names')
  const [examples, setExamples] = useState<LabelExample[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [swipeDir, setSwipeDir] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [allLabels, setAllLabels] = useState<LabelDefinition[]>([])

  const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null)
  const [showConcise, setShowConcise] = useState(false)
  const [conciseCache, setConciseCache] = useState<Record<string, string>>({})

  const currentEx = examples[currentIndex] ?? null

  useEffect(() => {
    if (!currentEx) return
    setSuggestion(null)
    setShowConcise(false)
    
    // Pre-fetch suggestion
    api.suggestLabel(currentEx.chatlog_id, currentEx.message_index)
       .then(setSuggestion)
       .catch(() => {})

    // Pre-fetch concise summary
    const key = `${currentEx.chatlog_id}:${currentEx.message_index}`
    if (!conciseCache[key]) {
      api.getConciseMessage(currentEx.chatlog_id, currentEx.message_index)
         .then(res => setConciseCache(prev => ({ ...prev, [key]: res.concise_text })))
         .catch(() => {})
    }
  }, [currentEx, conciseCache])

  const toggleConcise = useCallback(() => {
    if (!currentEx) return
    setShowConcise(prev => !prev)
  }, [currentEx])

  useEffect(() => {
    api.getLabels().then(setAllLabels)
  }, [])

  const startSwiping = async () => {
    if (!nameA || !nameB) return
    setLoading(true)
    try {
      const data = await api.getLabelExamples(label.id, 50)
      setExamples(data)
      setStep('swiping')
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleAssign = useCallback((targetName: string | null, dir?: string) => {
    if (currentIndex >= examples.length) return
    setSwipeDir(dir || null)
    const ex = examples[currentIndex]
    if (targetName) {
      setAssignments(prev => ({
        ...prev,
        [`${ex.chatlog_id}:${ex.message_index}`]: targetName
      }))
    }
    setCurrentIndex(prev => prev + 1)
  }, [currentIndex, examples])

  const handleBack = useCallback(() => {
    if (currentIndex <= 0) return
    setSwipeDir('back')
    setCurrentIndex(prev => prev - 1)
  }, [currentIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (step !== 'swiping') return
      if (e.key === 'ArrowLeft') handleAssign(nameA, 'left')
      if (e.key === 'ArrowRight') handleAssign(nameB, 'right')
      if (e.key === 'ArrowDown') handleAssign(null, 'down')
      if (e.key === 'ArrowUp' || e.key === 'Backspace') handleBack()
      
      if (e.key === 'Enter' && suggestion) {
        if (suggestion.label_name === nameA) handleAssign(nameA, 'left')
        else if (suggestion.label_name === nameB) handleAssign(nameB, 'right')
      }

      if (e.key === 'Tab' && suggestion) {
        e.preventDefault()
        // Accept suggestion even if not nameA or nameB
        handleAssign(suggestion.label_name, 'up')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [step, handleAssign, handleBack, nameA, nameB, suggestion])

  if (step === 'names') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-surface rounded-xl shadow-2xl w-full max-w-md p-6 border border-edge">
          <h2 className="text-xl font-bold mb-4 text-on-canvas">Split "{label.name}"</h2>
          <p className="text-sm text-muted mb-6">Enter two sub-categories to split this label into. You can use existing labels as well.</p>
          
          <datalist id="existing-labels">
            {allLabels.map(l => (
              <option key={l.id} value={l.name} />
            ))}
          </datalist>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-faint uppercase tracking-widest mb-1.5">Category A (Left Arrow)</label>
              <input 
                autoFocus
                className="w-full px-3 py-2 bg-canvas border border-edge rounded text-sm text-on-canvas placeholder-disabled focus:outline-none focus:border-accent transition-all"
                placeholder="e.g. Theory"
                value={nameA}
                onChange={e => setNameA(e.target.value)}
                list="existing-labels"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-faint uppercase tracking-widest mb-1.5">Category B (Right Arrow)</label>
              <input 
                className="w-full px-3 py-2 bg-canvas border border-edge rounded text-sm text-on-canvas placeholder-disabled focus:outline-none focus:border-accent transition-all"
                placeholder="e.g. Implementation"
                value={nameB}
                onChange={e => setNameB(e.target.value)}
                list="existing-labels"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-8">
            <button onClick={onClose} className="flex-1 py-2 text-xs font-medium text-faint hover:text-tertiary transition-colors">Cancel</button>
            <button 
              disabled={!nameA || !nameB || loading}
              onClick={startSwiping} 
              className="flex-1 py-2 text-xs font-bold bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all"
            >
              {loading ? 'Loading...' : 'Start Swiping'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const progress = examples.length > 0 ? (currentIndex / examples.length) * 100 : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      {/* Header */}
      <div className="h-16 bg-surface border-b border-edge-subtle flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-on-canvas">Splitting: {label.name}</h2>
          <div className="h-4 w-px bg-elevated-hl" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 bg-accent-surface text-accent-on-surface border border-accent-border rounded uppercase tracking-wider">{nameA}</span>
            <span className="text-disabled text-[10px] font-bold">VS</span>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-ai-surface text-ai-text border border-ai-border rounded uppercase tracking-wider">{nameB}</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {currentIndex > 0 && (
            <button 
              onClick={handleBack}
              className="text-[10px] font-black uppercase tracking-widest text-accent-muted hover:text-accent-text flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              Go Back
            </button>
          )}
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-faint uppercase tracking-widest">Progress</span>
            <span className="text-sm font-mono font-medium text-tertiary">{currentIndex} / {examples.length}</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-elevated rounded-full text-faint hover:text-tertiary transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-0.5 bg-elevated w-full overflow-hidden shrink-0">
        <div className="h-full bg-accent transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Existing Labels */}
        <aside className="w-52 border-r border-edge-subtle p-4 flex flex-col gap-4 bg-surface/20 shrink-0 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-faint font-bold mb-1">Move to Existing</p>
          <div className="flex flex-col gap-1.5">
            {allLabels.filter(l => l.id !== label.id).map(l => (
              <button
                key={l.id}
                onClick={() => handleAssign(l.name, 'left')}
                className="w-full text-left bg-surface border border-edge-subtle hover:border-accent hover:bg-elevated rounded px-2.5 py-2 text-[11px] text-muted hover:text-on-surface transition-all truncate"
              >
                {l.name}
              </button>
            ))}
          </div>
        </aside>

        {/* Swipe Area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-hidden bg-canvas relative">
          
          {/* Concise View Toggle */}
          {currentIndex < examples.length && currentEx && (
            <button
              onClick={toggleConcise}
              className={`
                absolute bottom-12 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 rounded-full border transition-all flex items-center gap-2
                ${showConcise 
                  ? 'bg-ai-action border-purple-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]' 
                  : 'bg-surface border-edge text-muted hover:border-edge-strong hover:text-on-surface'}
              `}
            >
              <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <span className="text-sm">✨</span> {showConcise ? 'Regular View' : 'Concise View'}
              </span>
            </button>
          )}

          <AnimatePresence mode="popLayout" custom={swipeDir}>
            {currentIndex < examples.length && currentEx ? (
            <motion.div 
              key={currentIndex}
              custom={swipeDir}
              variants={{
                initial: (dir) => ({ 
                  scale: dir === 'back' ? 1.1 : 0.9, 
                  opacity: 0,
                  x: dir === 'back' ? -100 : 0
                }),
                animate: { 
                  scale: 1, 
                  opacity: 1, 
                  x: 0, 
                  y: 0,
                  transition: { type: 'spring', damping: 25, stiffness: 200 } 
                },
                exit: (dir) => {
                  const dist = 800;
                  return {
                    x: dir === 'left' ? -dist : dir === 'right' ? dist : 0,
                    y: dir === 'up' ? -dist : dir === 'down' ? dist : 0,
                    opacity: 0,
                    rotate: dir === 'left' ? -20 : dir === 'right' ? 20 : 0,
                    transition: { duration: 0.4, ease: 'anticipate' }
                  }
                }
              }}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full max-w-2xl relative"
            >
              {/* Card Stack */}
              <div className="relative w-full h-[450px]">
                {/* Original Card */}
                <motion.div 
                  animate={{ 
                    y: showConcise ? 20 : 0, 
                    scale: showConcise ? 0.95 : 1, 
                    opacity: showConcise ? 0.4 : 1,
                    filter: showConcise ? 'blur(2px)' : 'blur(0px)'
                  }}
                  className={`
                    absolute inset-0 bg-surface border border-edge-subtle rounded-lg shadow-2xl overflow-hidden flex flex-col transition-all duration-300
                    ${showConcise ? 'z-0' : 'z-10'}
                  `}
                >
                  <div className="p-10 flex-1 overflow-y-auto flex items-center justify-center text-center bg-[#0d1f33]/30 border-b border-blue-900/30">
                    <p className="text-xl font-medium text-on-surface leading-relaxed italic">
                      "{currentEx.message_text}"
                    </p>
                  </div>
                  
                  {/* Suggestion Rationale */}
                  {suggestion && !showConcise && (
                    <div className="px-10 py-4 bg-canvas/50 border-b border-edge-subtle flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <span className="text-[10px] font-black uppercase tracking-widest text-accent-muted shrink-0">AI Logic</span>
                        <p className="text-[11px] text-faint italic truncate">{suggestion.rationale}</p>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleAssign(suggestion.label_name, 'up'); }}
                        className="flex items-center gap-2 px-2 py-1 bg-accent-surface border border-accent-border rounded hover:bg-accent-surface transition-all shrink-0"
                      >
                        <kbd className="px-1.5 py-0.5 bg-canvas border border-edge rounded text-accent-text font-mono text-[10px] font-bold">TAB</kbd>
                        <span className="text-[10px] font-bold text-accent-text uppercase tracking-tighter truncate max-w-[120px]">Apply "{suggestion.label_name}"</span>
                      </button>
                    </div>
                  )}

                  {/* Shared Controls (Inside the Card) */}
                  <div className="p-6 bg-surface flex items-center justify-center gap-4">
                    <button 
                      onClick={() => handleAssign(nameA, 'left')}
                      className={`
                        flex-1 flex flex-col items-center gap-2 p-4 bg-canvas border rounded-lg hover:bg-accent-surface group transition-all
                        ${suggestion?.label_name === nameA 
                          ? 'border-accent-border shadow-[0_0_25px_rgba(59,130,246,0.3)]' 
                          : 'border-edge-subtle hover:border-accent'}
                      `}
                    >
                      <div className={`w-10 h-10 flex items-center justify-center bg-accent-surface text-accent-muted border border-accent-border rounded-full group-hover:scale-110 transition-transform ${suggestion?.label_name === nameA ? 'animate-pulse' : ''}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                      </div>
                      <span className="text-[10px] font-bold text-faint uppercase tracking-widest group-hover:text-accent-text">{nameA}</span>
                    </button>

                    <button 
                      onClick={() => handleAssign(null, 'down')}
                      className="flex flex-col items-center gap-2 p-4 text-faint hover:text-tertiary transition-colors"
                    >
                      <div className="w-10 h-10 flex items-center justify-center rounded-full border border-dashed border-edge">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" /></svg>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest">Skip</span>
                    </button>

                    <button 
                      onClick={() => handleAssign(nameB, 'right')}
                      className={`
                        flex-1 flex flex-col items-center gap-2 p-4 bg-canvas border rounded-lg hover:bg-ai-surface group transition-all
                        ${suggestion?.label_name === nameB 
                          ? 'border-ai-border shadow-[0_0_25px_rgba(168,85,247,0.3)]' 
                          : 'border-edge-subtle hover:border-ai-border'}
                      `}
                    >
                      <div className={`w-10 h-10 flex items-center justify-center bg-ai-surface text-ai-text border border-ai-border rounded-full group-hover:scale-110 transition-transform ${suggestion?.label_name === nameB ? 'animate-pulse' : ''}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                      </div>
                      <span className="text-[10px] font-bold text-faint uppercase tracking-widest group-hover:text-ai-text">{nameB}</span>
                    </button>
                  </div>
                </motion.div>

                {/* Concise Card */}
                <motion.div 
                  initial={{ y: 20, scale: 0.95, opacity: 0 }}
                  animate={{ 
                    y: showConcise ? 0 : 20, 
                    scale: showConcise ? 1 : 0.95, 
                    opacity: showConcise ? 1 : 0,
                    pointerEvents: showConcise ? 'auto' : 'none'
                  }}
                  className={`
                    absolute inset-0 bg-surface border border-ai-border rounded-lg shadow-2xl overflow-hidden flex flex-col
                    ${showConcise ? 'z-10' : 'z-0'}
                  `}
                >
                  <div className="p-10 flex-1 flex flex-col items-center justify-center text-center bg-gradient-to-b from-purple-950/20 to-neutral-900 border-b border-ai-border relative">
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-ai-text">AI Summary</span>
                    </div>
                    <p className="text-2xl font-bold text-on-canvas leading-tight">
                      "{conciseCache[`${currentEx.chatlog_id}:${currentEx.message_index}`] || 'Summarizing...'}"
                    </p>
                  </div>
                  
                  {/* Re-use buttons on concise card so user can sort from there too */}
                  <div className="p-6 bg-canvas/80 flex items-center justify-center gap-4">
                     <button onClick={() => handleAssign(nameA, 'left')} className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-accent-text border border-blue-900/30 rounded hover:bg-accent-surface/60 transition-all">{nameA}</button>
                     <button onClick={() => toggleConcise()} className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-faint border border-edge-subtle rounded hover:bg-elevated transition-all">Back</button>
                     <button onClick={() => handleAssign(nameB, 'right')} className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-ai-text border border-ai-border rounded hover:bg-ai-surface transition-all">{nameB}</button>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          ) : currentIndex >= examples.length && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 bg-accent-surface text-accent-muted border border-accent-border rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h3 className="text-xl font-bold text-on-canvas mb-2">Split Complete!</h3>
              <p className="text-sm text-faint mb-8 max-w-sm mx-auto">Assignments made: {Object.keys(assignments).length}</p>
              <button 
                onClick={() => onComplete(nameA, nameB, assignments)}
                className="px-8 py-2.5 bg-accent text-white text-sm font-bold rounded hover:bg-accent-hover transition-colors shadow-lg shadow-blue-900/20"
              >
                Finish & Relabel Rest
              </button>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer / Instructions */}
      <div className="h-12 bg-surface border-t border-edge-subtle flex items-center justify-center gap-10 text-[10px] font-bold text-faint uppercase tracking-widest shrink-0">
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-canvas border border-edge rounded text-muted font-mono">↑</kbd>
          <span>Back</span>
        </div>
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-canvas border border-edge rounded text-muted font-mono">←</kbd>
          <span className="text-accent-text">{nameA}</span>
        </div>
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-canvas border border-edge rounded text-muted font-mono">↓</kbd>
          <span>Skip</span>
        </div>
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-canvas border border-edge rounded text-muted font-mono">→</kbd>
          <span className="text-ai-text">{nameB}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * MergePreviewModal: Side-by-side comparison before merging.
 */
function MergePreviewModal({
  source,
  target,
  onClose,
  onConfirm
}: {
  source: LabelDefinition
  target: LabelDefinition
  onClose: () => void
  onConfirm: () => void
}) {
  const [sourceEx, setSourceEx] = useState<LabelExample[]>([])
  const [targetEx, setTargetEx] = useState<LabelExample[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.getLabelExamples(source.id, 5),
      api.getLabelExamples(target.id, 5)
    ]).then(([s, t]) => {
      setSourceEx(s)
      setTargetEx(t)
      setLoading(false)
    })
  }, [source.id, target.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-edge-subtle rounded-lg shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-edge-subtle flex items-center justify-between shrink-0 bg-surface/50">
          <div>
            <h2 className="text-xl font-bold text-on-canvas">Confirm Label Merge</h2>
            <p className="text-sm text-faint">Merging <span className="font-bold text-tertiary">{source.name}</span> into <span className="font-bold text-accent-text">{target.name}</span>.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-elevated rounded-full text-faint hover:text-tertiary transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Source Pane */}
          <div className="flex-1 border-r border-edge-subtle flex flex-col overflow-hidden bg-canvas/30">
            <div className="p-4 bg-surface/80 border-b border-edge-subtle">
              <span className="text-[10px] font-bold text-disabled uppercase tracking-widest">From</span>
              <h3 className="font-bold text-muted">{source.name}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? <div className="animate-pulse space-y-3"><div className="h-16 bg-elevated/50 rounded"/><div className="h-16 bg-elevated/50 rounded"/></div> :
                sourceEx.map((ex, i) => (
                  <div key={i} className="p-3 bg-[#0d1f33]/20 border border-blue-900/30 rounded text-xs text-muted italic">"{ex.message_text}"</div>
                ))
              }
            </div>
          </div>

          {/* Target Pane */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 bg-surface/80 border-b border-edge-subtle">
              <span className="text-[10px] font-bold text-accent-muted uppercase tracking-widest">Into</span>
              <h3 className="font-bold text-on-canvas">{target.name}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? <div className="animate-pulse space-y-3"><div className="h-16 bg-elevated/50 rounded"/><div className="h-16 bg-elevated/50 rounded"/></div> :
                targetEx.map((ex, i) => (
                  <div key={i} className="p-3 bg-[#0d1f33]/40 border border-blue-800/40 rounded text-xs text-on-surface italic font-medium">"{ex.message_text}"</div>
                ))
              }
            </div>
          </div>
        </div>

        <div className="p-6 bg-surface border-t border-edge-subtle flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 text-xs font-bold text-faint hover:text-tertiary transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 text-xs font-bold bg-accent text-white hover:bg-accent-hover rounded transition-colors shadow-lg shadow-blue-900/20">Confirm & Merge</button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function LabelsPage() {
  const [labels, setLabels] = useState<LabelDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [filterLabelId, setFilterLabelId] = useState<number | null>(null)
  
  // Modals
  const [refiningLabel, setRefiningLabel] = useState<LabelDefinition | null>(null)
  const [splittingLabel, setSplittingLabel] = useState<LabelDefinition | null>(null)
  const [mergeState, setMergeState] = useState<{ source: LabelDefinition, target: LabelDefinition } | null>(null)
  const [deletingLabel, setDeletingLabel] = useState<LabelDefinition | null>(null)
  
  const [draggedId, setDraggedId] = useState<number | null>(null)

  const fetchLabels = async () => {
    try {
      const data = await api.getLabels()
      setLabels(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLabels() }, [])

  const handleMerge = async () => {
    if (!mergeState) return
    try {
      await api.mergeLabels(mergeState.source.id, mergeState.target.id)
      setMergeState(null)
      fetchLabels()
    } catch (err) {
      console.error(err)
    }
  }

  const handleSplitComplete = async (nameA: string, nameB: string, assignments: Record<string, string>) => {
    if (!splittingLabel) return
    try {
      await api.splitLabelAutoLabel({
        label_id: splittingLabel.id,
        name_a: nameA,
        name_b: nameB,
        assignments
      })
      setSplittingLabel(null)
      fetchLabels()
    } catch (err) {
      console.error(err)
    }
  }

  const handleRefineComplete = async (assignments: Record<string, number>, deleteLabelId?: number) => {
    try {
      await api.applyBatch({ assignments, delete_original_label_id: deleteLabelId })
      setRefiningLabel(null)
      fetchLabels()
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async () => {
    if (!deletingLabel) return
    try {
      await api.deleteLabel(deletingLabel.id, true)
      setDeletingLabel(null)
      fetchLabels()
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-faint text-xs tracking-widest uppercase animate-pulse">
      Loading Taxonomy...
    </div>
  )

  const filteredLabels = filterLabelId ? labels.filter(l => l.id === filterLabelId) : labels

  return (
    <div className="flex-1 flex overflow-hidden bg-canvas">
      
      {/* Sidebar */}
      <aside className="w-56 border-r border-edge-subtle p-4 flex flex-col gap-6 shrink-0 bg-surface/20 overflow-y-auto">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-disabled font-bold mb-3">Filter Taxonomy</p>
          <div className="flex flex-col gap-1.5">
            <button 
              onClick={() => setFilterLabelId(null)}
              className={`w-full text-left rounded px-3 py-2 text-[11px] transition-colors ${
                !filterLabelId ? 'bg-accent-surface border border-accent-border text-accent-on-surface' : 'text-faint hover:bg-elevated'
              }`}
            >
              All Labels
            </button>
            {labels.map(l => (
              <button
                key={l.id}
                onClick={() => setFilterLabelId(l.id)}
                className={`w-full text-left rounded px-3 py-2 text-[11px] transition-colors truncate ${
                  filterLabelId === l.id ? 'bg-accent-surface border border-accent-border text-accent-on-surface' : 'text-faint hover:bg-elevated'
                }`}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>

        <button 
          onClick={() => setRefiningLabel({ id: -1, name: '', count: 0, description: '', created_at: '' })}
          className="w-full py-2 bg-elevated text-tertiary text-[10px] font-bold uppercase tracking-widest rounded border border-edge hover:border-accent-border transition-all mt-auto"
        >
          Quick Refine
        </button>
      </aside>

      {/* Main Grid */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="mb-10 flex items-end justify-between max-w-6xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold text-on-canvas tracking-tight">Label Taxonomy</h1>
            <p className="text-sm text-faint mt-1.5">Organize and refine your tutoring interaction labels.</p>
          </div>
          <div className="bg-surface px-4 py-2 rounded border border-edge-subtle flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-disabled uppercase tracking-widest">Applications</span>
              <span className="text-sm font-bold text-accent-text">{labels.reduce((acc, l) => acc + l.count, 0)}</span>
            </div>
            <div className="w-px h-6 bg-elevated" />
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-disabled uppercase tracking-widest">Taxonomy Size</span>
              <span className="text-sm font-bold text-tertiary">{labels.length}</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 max-w-6xl mx-auto pb-20">
          {filteredLabels.map(label => (
            <div 
              key={label.id}
              draggable
              onDragStart={() => setDraggedId(label.id)}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                const source = labels.find(l => l.id === draggedId)
                if (source && source.id !== label.id) setMergeState({ source, target: label })
                setDraggedId(null)
              }}
              className={`
                group relative bg-surface border border-edge-subtle rounded-lg p-6 transition-all duration-200 cursor-move
                ${draggedId === label.id ? 'opacity-30 border-accent shadow-inner scale-95' : 'hover:border-edge-strong hover:shadow-2xl hover:shadow-black/40'}
                ${draggedId && draggedId !== label.id ? 'hover:ring-2 hover:ring-blue-600' : ''}
              `}
            >
              {/* Delete Icon */}
              <button 
                onClick={(e) => { e.stopPropagation(); setDeletingLabel(label); }}
                className="absolute top-4 right-4 p-2 text-disabled hover:text-danger-text opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>

              <div className="flex justify-between items-start mb-5">
                <span className="text-2xl font-black text-disabled group-hover:text-disabled transition-colors">#{label.id}</span>
                <span className="px-2 py-0.5 bg-canvas text-accent-text border border-edge-subtle rounded text-[10px] font-bold tracking-wider">
                  {label.count}
                </span>
              </div>
              
              <h3 className="text-base font-bold text-on-surface mb-2 leading-tight group-hover:text-white transition-colors">{label.name}</h3>
              <p className="text-xs text-faint line-clamp-2 min-h-[3em] leading-relaxed italic">
                {label.description || 'No description provided.'}
              </p>

              <div className="mt-8 flex gap-3 opacity-0 group-hover:opacity-100 transition-all transform translate-y-1 group-hover:translate-y-0">
                <button 
                  onClick={() => setRefiningLabel(label)}
                  className="flex-1 py-1.5 bg-accent text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-accent-hover transition-colors shadow-lg shadow-blue-900/20"
                >
                  Refine
                </button>
                <button 
                  onClick={() => setSplittingLabel(label)}
                  className="px-3 py-1.5 bg-elevated text-tertiary text-[10px] font-black uppercase tracking-widest rounded border border-edge hover:bg-elevated-hl transition-colors"
                >
                  Split
                </button>
                <div className="relative group/tooltip">
                  <div className="p-1.5 bg-elevated text-muted rounded hover:bg-elevated-hl hover:text-accent-text transition-colors cursor-help border border-edge">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                  </div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-elevated border border-edge text-on-surface text-[9px] font-bold rounded opacity-0 group-hover/tooltip:opacity-100 pointer-events-none whitespace-nowrap transition-all uppercase tracking-tighter shadow-2xl">
                    Drag to merge
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Modals */}
      {splittingLabel && (
        <SplitSessionModal 
          label={splittingLabel}
          onClose={() => setSplittingLabel(null)}
          onComplete={handleSplitComplete}
        />
      )}

      {refiningLabel && (
        <QuickRefineModal
          allLabels={labels}
          initialLabel={refiningLabel.id === -1 ? null : refiningLabel}
          onClose={() => setRefiningLabel(null)}
          onComplete={handleRefineComplete}
        />
      )}

      {mergeState && (
        <MergePreviewModal 
          source={mergeState.source}
          target={mergeState.target}
          onClose={() => setMergeState(null)}
          onConfirm={handleMerge}
        />
      )}

      {deletingLabel && (
        <DeleteConfirmModal
          label={deletingLabel}
          onClose={() => setDeletingLabel(null)}
          onConfirm={handleDelete}
        />
      )}

    </div>
  )
}
