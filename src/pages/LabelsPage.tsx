import { useState, useEffect, useCallback, useRef } from 'react'
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
  const conciseFetchedRef = useRef<Set<string>>(new Set())

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
    if (!conciseFetchedRef.current.has(key)) {
      conciseFetchedRef.current.add(key)
      api.getConciseMessage(currentEx.chatlog_id, currentEx.message_index)
         .then(res => setConciseCache(prev => ({ ...prev, [key]: res.concise_text })))
         .catch(() => setConciseCache(prev => ({ ...prev, [key]: "Summary unavailable" })))
    }
  }, [currentEx])

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
    <div className="fixed inset-0 z-50 bg-neutral-950 flex items-center justify-center text-neutral-500 text-xs tracking-widest uppercase animate-pulse">
      Preparing refine session...
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 select-none">
      {/* Header */}
      <div className="h-16 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-neutral-100">Quick Refine</h2>
          <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
            {initialLabel ? `Refining: ${initialLabel.name}` : 'Multi-label Sorting'}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">Progress</span>
            <span className="text-sm font-mono font-medium text-neutral-400">{currentIndex} / {examples.length}</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-500 hover:text-neutral-300 transition-colors">
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
                absolute bottom-12 left-12 z-20 px-5 py-2.5 rounded-full border transition-all flex items-center gap-2
                ${showConcise 
                  ? 'bg-purple-600 border-purple-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]' 
                  : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}
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
                        ? 'bg-blue-900/40 border-blue-400 shadow-[0_0_30px_rgba(59,130,246,0.4)] scale-110' 
                        : 'bg-neutral-900 border-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.2)]')
                    : 'bg-neutral-900/20 border-dashed border-neutral-800 text-neutral-700'}
                  ${draggingSlot === dir ? 'opacity-50 scale-90' : 'hover:scale-105'}
                `}
                onClick={() => slots[dir] && handleAssign(slots[dir], dir)}
              >
                <span className="text-[8px] font-black uppercase tracking-widest text-neutral-600 mb-1">
                  {dir === 'top' ? '↑ Up' : dir === 'bottom' ? '↓ Down' : dir === 'left' ? '← Left' : '→ Right'}
                </span>
                <span className={`text-[11px] font-bold truncate w-full ${slots[dir] ? (suggestion?.label_name === slots[dir]?.name ? 'text-blue-200' : 'text-blue-400') : 'text-neutral-700'}`}>
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
                        absolute inset-0 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300
                        ${showConcise ? 'z-0' : 'z-10'}
                      `}
                    >
                      <div className="p-10 flex-1 overflow-y-auto flex items-center justify-center text-center">
                        <p className="text-xl font-medium text-neutral-200 leading-relaxed italic">
                          "{currentEx.message_text}"
                        </p>
                      </div>
                      {suggestion && !showConcise && (
                        <div className="px-6 py-3 bg-blue-900/10 border-t border-neutral-800/50 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <span className="text-[9px] font-black uppercase tracking-widest text-blue-500 shrink-0">AI Logic</span>
                            <p className="text-[10px] text-neutral-500 italic truncate">{suggestion.rationale}</p>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); const label = allLabels.find(l => l.name === suggestion.label_name); if (label) handleAssign(label, 'up'); }}
                            className="flex items-center gap-2 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded hover:bg-blue-500/20 transition-all shrink-0"
                          >
                            <kbd className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-700 rounded text-blue-400 font-mono text-[9px] font-bold">TAB</kbd>
                            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-tighter truncate max-w-[80px]">Apply "{suggestion.label_name}"</span>
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
                        absolute inset-0 bg-neutral-900 border border-purple-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col
                        ${showConcise ? 'z-10' : 'z-0'}
                      `}
                    >
                      <div className="p-10 flex-1 flex flex-col items-center justify-center text-center bg-gradient-to-b from-purple-950/20 to-neutral-900 relative">
                        <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-purple-400/70">AI Summary</span>
                        </div>
                        <p className="text-2xl font-bold text-neutral-100 leading-tight">
                          "{conciseCache[`${currentEx.chatlog_id}:${currentEx.message_index}`] || 'Summarizing...'}"
                        </p>
                        <button onClick={() => toggleConcise()} className="mt-8 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500 border border-neutral-800 rounded-full hover:bg-neutral-800 transition-all">Back to Full Text</button>
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
                  <div className="w-16 h-16 bg-blue-900/30 text-blue-500 border border-blue-800 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral-100 mb-2">Refine Session Complete!</h3>
                  <p className="text-sm text-neutral-500 mb-8 max-w-sm mx-auto">Assignments made: {Object.keys(assignments).length}</p>
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={() => onComplete(assignments)}
                      className="px-8 py-2.5 bg-blue-600 text-white text-sm font-bold rounded hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
                    >
                      Save & Finish
                    </button>
                    {initialLabel && (
                      <button 
                        onClick={() => onComplete(assignments, initialLabel.id)}
                        className="px-8 py-2.5 text-red-500 text-xs font-bold hover:bg-red-900/20 transition-colors rounded"
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
        <aside className="w-64 border-l border-neutral-800 p-5 flex flex-col gap-4 bg-neutral-900/20 shrink-0 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold mb-1">Taxonomy</p>
          <div className="flex flex-col gap-2">
            {allLabels.map(l => (
              <div
                key={l.id}
                draggable
                onDragStart={() => setDraggingLabel(l)}
                onDragEnd={() => setDraggingLabel(null)}
                className="w-full text-left bg-neutral-900 border border-neutral-800 hover:border-blue-600 rounded px-3 py-2.5 text-[11px] text-neutral-400 hover:text-blue-300 transition-all cursor-grab active:cursor-grabbing group"
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold truncate">{l.name}</span>
                  <span className="text-[9px] text-neutral-600">{l.count}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-auto p-3 bg-blue-900/10 border border-blue-900/30 rounded text-[10px] text-blue-400 leading-relaxed italic">
            Tip: Drag labels into the directional slots, then use arrow keys to sort messages at high speed.
          </div>
        </aside>
      </div>

      {/* Footer Progress Bar */}
      <div className="h-1 bg-neutral-900 w-full overflow-hidden shrink-0">
        <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${progress}%` }} />
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
      <div className="bg-neutral-900 border border-red-900/50 rounded-lg p-8 max-w-sm w-full text-center shadow-2xl">
        <div className="w-16 h-16 bg-red-900/20 text-red-500 border border-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </div>
        <h3 className="text-lg font-bold text-neutral-100 mb-2">Delete "{label.name}"?</h3>
        <p className="text-sm text-neutral-500 mb-8 leading-relaxed">
          This will remove the label definition. Existing applications will be preserved but the label itself will be gone.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-xs font-bold text-neutral-500 hover:text-neutral-300">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2 bg-red-600 text-white text-xs font-bold rounded hover:bg-red-500 transition-colors">Delete Label</button>
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
  const conciseFetchedRef = useRef<Set<string>>(new Set())

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
    if (!conciseFetchedRef.current.has(key)) {
      conciseFetchedRef.current.add(key)
      api.getConciseMessage(currentEx.chatlog_id, currentEx.message_index)
         .then(res => setConciseCache(prev => ({ ...prev, [key]: res.concise_text })))
         .catch(() => setConciseCache(prev => ({ ...prev, [key]: "Summary unavailable" })))
    }
  }, [currentEx])

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
        <div className="bg-neutral-900 rounded-xl shadow-2xl w-full max-w-md p-6 border border-neutral-700">
          <h2 className="text-xl font-bold mb-4 text-neutral-100">Split "{label.name}"</h2>
          <p className="text-sm text-neutral-400 mb-6">Enter two sub-categories to split this label into. You can use existing labels as well.</p>
          
          <datalist id="existing-labels">
            {allLabels.map(l => (
              <option key={l.id} value={l.name} />
            ))}
          </datalist>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1.5">Category A (Left Arrow)</label>
              <input 
                autoFocus
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-600 transition-all"
                placeholder="e.g. Theory"
                value={nameA}
                onChange={e => setNameA(e.target.value)}
                list="existing-labels"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1.5">Category B (Right Arrow)</label>
              <input 
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-600 transition-all"
                placeholder="e.g. Implementation"
                value={nameB}
                onChange={e => setNameB(e.target.value)}
                list="existing-labels"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-8">
            <button onClick={onClose} className="flex-1 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-300 transition-colors">Cancel</button>
            <button 
              disabled={!nameA || !nameB || loading}
              onClick={startSwiping} 
              className="flex-1 py-2 text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all"
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
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      {/* Header */}
      <div className="h-16 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-neutral-100">Splitting: {label.name}</h2>
          <div className="h-4 w-px bg-neutral-700" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-900/50 text-blue-300 border border-blue-800 rounded uppercase tracking-wider">{nameA}</span>
            <span className="text-neutral-600 text-[10px] font-bold">VS</span>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-900/50 text-purple-300 border border-purple-800 rounded uppercase tracking-wider">{nameB}</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {currentIndex > 0 && (
            <button 
              onClick={handleBack}
              className="text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              Go Back
            </button>
          )}
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Progress</span>
            <span className="text-sm font-mono font-medium text-neutral-300">{currentIndex} / {examples.length}</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-500 hover:text-neutral-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-0.5 bg-neutral-800 w-full overflow-hidden shrink-0">
        <div className="h-full bg-blue-600 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Existing Labels */}
        <aside className="w-52 border-r border-neutral-800 p-4 flex flex-col gap-4 bg-neutral-900/20 shrink-0 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold mb-1">Move to Existing</p>
          <div className="flex flex-col gap-1.5">
            {allLabels.filter(l => l.id !== label.id).map(l => (
              <button
                key={l.id}
                onClick={() => handleAssign(l.name, 'left')}
                className="w-full text-left bg-neutral-900 border border-neutral-800 hover:border-blue-600 hover:bg-neutral-800 rounded px-2.5 py-2 text-[11px] text-neutral-400 hover:text-neutral-200 transition-all truncate"
              >
                {l.name}
              </button>
            ))}
          </div>
        </aside>

        {/* Swipe Area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-hidden bg-neutral-950 relative">
          
          {/* Concise View Toggle */}
          {currentIndex < examples.length && currentEx && (
            <button
              onClick={toggleConcise}
              className={`
                absolute bottom-12 left-12 z-20 px-5 py-2.5 rounded-full border transition-all flex items-center gap-2
                ${showConcise 
                  ? 'bg-purple-600 border-purple-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]' 
                  : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}
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
                    absolute inset-0 bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl overflow-hidden flex flex-col transition-all duration-300
                    ${showConcise ? 'z-0' : 'z-10'}
                  `}
                >
                  <div className="p-10 flex-1 overflow-y-auto flex items-center justify-center text-center bg-[#0d1f33]/30 border-b border-blue-900/30">
                    <p className="text-xl font-medium text-neutral-200 leading-relaxed italic">
                      "{currentEx.message_text}"
                    </p>
                  </div>
                  
                  {/* Suggestion Rationale */}
                  {suggestion && !showConcise && (
                    <div className="px-10 py-4 bg-neutral-950/50 border-b border-neutral-800 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-500 shrink-0">AI Logic</span>
                        <p className="text-[11px] text-neutral-500 italic truncate">{suggestion.rationale}</p>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleAssign(suggestion.label_name, 'up'); }}
                        className="flex items-center gap-2 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded hover:bg-blue-500/20 transition-all shrink-0"
                      >
                        <kbd className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-700 rounded text-blue-400 font-mono text-[10px] font-bold">TAB</kbd>
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter truncate max-w-[120px]">Apply "{suggestion.label_name}"</span>
                      </button>
                    </div>
                  )}

                  {/* Shared Controls (Inside the Card) */}
                  <div className="p-6 bg-neutral-900 flex items-center justify-center gap-4">
                    <button 
                      onClick={() => handleAssign(nameA, 'left')}
                      className={`
                        flex-1 flex flex-col items-center gap-2 p-4 bg-neutral-950 border rounded-lg hover:bg-blue-950/20 group transition-all
                        ${suggestion?.label_name === nameA 
                          ? 'border-blue-500 shadow-[0_0_25px_rgba(59,130,246,0.3)]' 
                          : 'border-neutral-800 hover:border-blue-600'}
                      `}
                    >
                      <div className={`w-10 h-10 flex items-center justify-center bg-blue-900/30 text-blue-500 border border-blue-800 rounded-full group-hover:scale-110 transition-transform ${suggestion?.label_name === nameA ? 'animate-pulse' : ''}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                      </div>
                      <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest group-hover:text-blue-400">{nameA}</span>
                    </button>

                    <button 
                      onClick={() => handleAssign(null, 'down')}
                      className="flex flex-col items-center gap-2 p-4 text-neutral-500 hover:text-neutral-300 transition-colors"
                    >
                      <div className="w-10 h-10 flex items-center justify-center rounded-full border border-dashed border-neutral-700">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" /></svg>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest">Skip</span>
                    </button>

                    <button 
                      onClick={() => handleAssign(nameB, 'right')}
                      className={`
                        flex-1 flex flex-col items-center gap-2 p-4 bg-neutral-950 border rounded-lg hover:bg-purple-950/20 group transition-all
                        ${suggestion?.label_name === nameB 
                          ? 'border-purple-500 shadow-[0_0_25px_rgba(168,85,247,0.3)]' 
                          : 'border-neutral-800 hover:border-purple-600'}
                      `}
                    >
                      <div className={`w-10 h-10 flex items-center justify-center bg-purple-900/30 text-purple-500 border border-purple-800 rounded-full group-hover:scale-110 transition-transform ${suggestion?.label_name === nameB ? 'animate-pulse' : ''}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                      </div>
                      <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest group-hover:text-purple-400">{nameB}</span>
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
                    absolute inset-0 bg-neutral-900 border border-purple-500/50 rounded-lg shadow-2xl overflow-hidden flex flex-col
                    ${showConcise ? 'z-10' : 'z-0'}
                  `}
                >
                  <div className="p-10 flex-1 flex flex-col items-center justify-center text-center bg-gradient-to-b from-purple-950/20 to-neutral-900 border-b border-purple-900/30 relative">
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-purple-400/70">AI Summary</span>
                    </div>
                    <p className="text-2xl font-bold text-neutral-100 leading-tight">
                      "{conciseCache[`${currentEx.chatlog_id}:${currentEx.message_index}`] || 'Summarizing...'}"
                    </p>
                  </div>
                  
                  {/* Re-use buttons on concise card so user can sort from there too */}
                  <div className="p-6 bg-neutral-950/80 flex items-center justify-center gap-4">
                     <button onClick={() => handleAssign(nameA, 'left')} className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-blue-400 border border-blue-900/30 rounded hover:bg-blue-900/20 transition-all">{nameA}</button>
                     <button onClick={() => toggleConcise()} className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-neutral-500 border border-neutral-800 rounded hover:bg-neutral-800 transition-all">Back</button>
                     <button onClick={() => handleAssign(nameB, 'right')} className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-purple-400 border border-purple-900/30 rounded hover:bg-purple-900/20 transition-all">{nameB}</button>
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
              <div className="w-16 h-16 bg-blue-900/30 text-blue-500 border border-blue-800 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h3 className="text-xl font-bold text-neutral-100 mb-2">Split Complete!</h3>
              <p className="text-sm text-neutral-500 mb-8 max-w-sm mx-auto">Assignments made: {Object.keys(assignments).length}</p>
              <button 
                onClick={() => onComplete(nameA, nameB, assignments)}
                className="px-8 py-2.5 bg-blue-600 text-white text-sm font-bold rounded hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
              >
                Finish & Relabel Rest
              </button>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer / Instructions */}
      <div className="h-12 bg-neutral-900 border-t border-neutral-800 flex items-center justify-center gap-10 text-[10px] font-bold text-neutral-500 uppercase tracking-widest shrink-0">
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-700 rounded text-neutral-400 font-mono">↑</kbd>
          <span>Back</span>
        </div>
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-700 rounded text-neutral-400 font-mono">←</kbd>
          <span className="text-blue-400/70">{nameA}</span>
        </div>
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-700 rounded text-neutral-400 font-mono">↓</kbd>
          <span>Skip</span>
        </div>
        <div className="flex items-center gap-3">
          <kbd className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-700 rounded text-neutral-400 font-mono">→</kbd>
          <span className="text-purple-400/70">{nameB}</span>
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
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-900/50">
          <div>
            <h2 className="text-xl font-bold text-neutral-100">Confirm Label Merge</h2>
            <p className="text-sm text-neutral-500">Merging <span className="font-bold text-neutral-300">{source.name}</span> into <span className="font-bold text-blue-400">{target.name}</span>.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-500 hover:text-neutral-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Source Pane */}
          <div className="flex-1 border-r border-neutral-800 flex flex-col overflow-hidden bg-neutral-950/30">
            <div className="p-4 bg-neutral-900/80 border-b border-neutral-800">
              <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">From</span>
              <h3 className="font-bold text-neutral-400">{source.name}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? <div className="animate-pulse space-y-3"><div className="h-16 bg-neutral-800/50 rounded"/><div className="h-16 bg-neutral-800/50 rounded"/></div> :
                sourceEx.map((ex, i) => (
                  <div key={i} className="p-3 bg-[#0d1f33]/20 border border-blue-900/30 rounded text-xs text-neutral-400 italic">"{ex.message_text}"</div>
                ))
              }
            </div>
          </div>

          {/* Target Pane */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 bg-neutral-900/80 border-b border-neutral-800">
              <span className="text-[10px] font-bold text-blue-500/70 uppercase tracking-widest">Into</span>
              <h3 className="font-bold text-neutral-100">{target.name}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? <div className="animate-pulse space-y-3"><div className="h-16 bg-neutral-800/50 rounded"/><div className="h-16 bg-neutral-800/50 rounded"/></div> :
                targetEx.map((ex, i) => (
                  <div key={i} className="p-3 bg-[#0d1f33]/40 border border-blue-800/40 rounded text-xs text-neutral-200 italic font-medium">"{ex.message_text}"</div>
                ))
              }
            </div>
          </div>
        </div>

        <div className="p-6 bg-neutral-900 border-t border-neutral-800 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 text-xs font-bold text-neutral-500 hover:text-neutral-300 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 rounded transition-colors shadow-lg shadow-blue-900/20">Confirm & Merge</button>
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
    <div className="flex-1 flex items-center justify-center text-neutral-500 text-xs tracking-widest uppercase animate-pulse">
      Loading Taxonomy...
    </div>
  )

  const filteredLabels = filterLabelId ? labels.filter(l => l.id === filterLabelId) : labels

  return (
    <div className="flex-1 flex overflow-hidden bg-neutral-950">
      
      {/* Sidebar */}
      <aside className="w-56 border-r border-neutral-800 p-4 flex flex-col gap-6 shrink-0 bg-neutral-900/20 overflow-y-auto">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-600 font-bold mb-3">Filter Taxonomy</p>
          <div className="flex flex-col gap-1.5">
            <button 
              onClick={() => setFilterLabelId(null)}
              className={`w-full text-left rounded px-3 py-2 text-[11px] transition-colors ${
                !filterLabelId ? 'bg-blue-900/30 border border-blue-800 text-blue-200' : 'text-neutral-500 hover:bg-neutral-800'
              }`}
            >
              All Labels
            </button>
            {labels.map(l => (
              <button
                key={l.id}
                onClick={() => setFilterLabelId(l.id)}
                className={`w-full text-left rounded px-3 py-2 text-[11px] transition-colors truncate ${
                  filterLabelId === l.id ? 'bg-blue-900/30 border border-blue-800 text-blue-200' : 'text-neutral-500 hover:bg-neutral-800'
                }`}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>

        <button 
          onClick={() => setRefiningLabel({ id: -1, name: '', count: 0, description: '', created_at: '' })}
          className="w-full py-2 bg-neutral-800 text-neutral-300 text-[10px] font-bold uppercase tracking-widest rounded border border-neutral-700 hover:border-blue-500 transition-all mt-auto"
        >
          Quick Refine
        </button>
      </aside>

      {/* Main Grid */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="mb-10 flex items-end justify-between max-w-6xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100 tracking-tight">Label Taxonomy</h1>
            <p className="text-sm text-neutral-500 mt-1.5">Organize and refine your tutoring interaction labels.</p>
          </div>
          <div className="bg-neutral-900 px-4 py-2 rounded border border-neutral-800 flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-neutral-600 uppercase tracking-widest">Applications</span>
              <span className="text-sm font-bold text-blue-400">{labels.reduce((acc, l) => acc + l.count, 0)}</span>
            </div>
            <div className="w-px h-6 bg-neutral-800" />
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-neutral-600 uppercase tracking-widest">Taxonomy Size</span>
              <span className="text-sm font-bold text-neutral-300">{labels.length}</span>
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
                group relative bg-neutral-900 border border-neutral-800 rounded-lg p-6 transition-all duration-200 cursor-move
                ${draggedId === label.id ? 'opacity-30 border-blue-600 shadow-inner scale-95' : 'hover:border-neutral-600 hover:shadow-2xl hover:shadow-black/40'}
                ${draggedId && draggedId !== label.id ? 'hover:ring-2 hover:ring-blue-600' : ''}
              `}
            >
              {/* Delete Icon */}
              <button 
                onClick={(e) => { e.stopPropagation(); setDeletingLabel(label); }}
                className="absolute top-12 right-4 p-2 text-neutral-700 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>

              <div className="flex justify-between items-start mb-5">
                <span className="text-2xl font-black text-neutral-800 group-hover:text-neutral-700 transition-colors">#{label.id}</span>
                <span className="px-2 py-0.5 bg-neutral-950 text-blue-400 border border-neutral-800 rounded text-[10px] font-bold tracking-wider">
                  {label.count}
                </span>
              </div>
              
              <h3 className="text-base font-bold text-neutral-200 mb-2 leading-tight group-hover:text-white transition-colors">{label.name}</h3>
              <p className="text-xs text-neutral-500 line-clamp-2 min-h-[3em] leading-relaxed italic">
                {label.description || 'No description provided.'}
              </p>

              <div className="mt-8 flex gap-3 opacity-0 group-hover:opacity-100 transition-all transform translate-y-1 group-hover:translate-y-0">
                <button 
                  onClick={() => setRefiningLabel(label)}
                  className="flex-1 py-1.5 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
                >
                  Refine
                </button>
                <button 
                  onClick={() => setSplittingLabel(label)}
                  className="px-3 py-1.5 bg-neutral-800 text-neutral-300 text-[10px] font-black uppercase tracking-widest rounded border border-neutral-700 hover:bg-neutral-700 transition-colors"
                >
                  Split
                </button>
                <div className="relative group/tooltip">
                  <div className="p-1.5 bg-neutral-800 text-neutral-400 rounded hover:bg-neutral-700 hover:text-blue-400 transition-colors cursor-help border border-neutral-700">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                  </div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-neutral-800 border border-neutral-700 text-neutral-200 text-[9px] font-bold rounded opacity-0 group-hover/tooltip:opacity-100 pointer-events-none whitespace-nowrap transition-all uppercase tracking-tighter shadow-2xl">
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
