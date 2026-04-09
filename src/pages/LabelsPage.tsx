import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'
import type { LabelDefinition, LabelExample } from '../types'

// ── Components ───────────────────────────────────────────────────────────────

/**
 * SplitSessionModal: The "Tinder-style" swipe interface.
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
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [allLabels, setAllLabels] = useState<LabelDefinition[]>([])

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

  const handleAssign = useCallback((targetName: string | null) => {
    if (currentIndex >= examples.length) return
    
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
    setCurrentIndex(prev => prev - 1)
  }, [currentIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (step !== 'swiping') return
      if (e.key === 'ArrowLeft') handleAssign(nameA)
      if (e.key === 'ArrowRight') handleAssign(nameB)
      if (e.key === 'ArrowDown') handleAssign(null)
      if (e.key === 'ArrowUp' || e.key === 'Backspace') handleBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [step, handleAssign, handleBack, nameA, nameB])

  if (step === 'names') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-neutral-900 rounded-xl shadow-2xl w-full max-w-md p-6 border border-neutral-700">
          <h2 className="text-xl font-bold mb-4 text-neutral-100">Split "{label.name}"</h2>
          <p className="text-sm text-neutral-400 mb-6">Enter two new sub-categories to split this label into.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1.5">Sub-category A (Left Arrow)</label>
              <input 
                autoFocus
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-600 transition-all"
                placeholder="e.g. Theory"
                value={nameA}
                onChange={e => setNameA(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1.5">Sub-category B (Right Arrow)</label>
              <input 
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-600 transition-all"
                placeholder="e.g. Implementation"
                value={nameB}
                onChange={e => setNameB(e.target.value)}
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

  const currentEx = examples[currentIndex]
  const progress = (currentIndex / examples.length) * 100

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
      <div className="h-0.5 bg-neutral-800 w-full overflow-hidden">
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
                onClick={() => handleAssign(l.name)}
                className="w-full text-left bg-neutral-900 border border-neutral-800 hover:border-blue-600 hover:bg-neutral-800 rounded px-2.5 py-2 text-[11px] text-neutral-400 hover:text-neutral-200 transition-all truncate"
              >
                {l.name}
              </button>
            ))}
          </div>
        </aside>

        {/* Swipe Area */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden bg-neutral-950">
          {currentIndex < examples.length ? (
          <div className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-8 flex-1 overflow-y-auto min-h-[300px] flex items-center justify-center text-center bg-[#0d1f33]/30 border-b border-blue-900/30">
              <p className="text-xl font-medium text-neutral-200 leading-relaxed italic">
                "{currentEx.message_text}"
              </p>
            </div>
            
            {/* Controls */}
            <div className="p-6 bg-neutral-900 flex items-center justify-center gap-4">
              <button 
                onClick={() => handleAssign(nameA)}
                className="flex-1 flex flex-col items-center gap-2 p-4 bg-neutral-950 border border-neutral-800 rounded-lg hover:border-blue-600 hover:bg-blue-950/20 group transition-all"
              >
                <div className="w-10 h-10 flex items-center justify-center bg-blue-900/30 text-blue-500 border border-blue-800 rounded-full group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </div>
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest group-hover:text-blue-400">{nameA}</span>
              </button>

              <button 
                onClick={() => handleAssign(null)}
                className="flex flex-col items-center gap-2 p-4 text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                <div className="w-10 h-10 flex items-center justify-center rounded-full border border-dashed border-neutral-700">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" /></svg>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">Skip</span>
              </button>

              <button 
                onClick={() => handleAssign(nameB)}
                className="flex-1 flex flex-col items-center gap-2 p-4 bg-neutral-950 border border-neutral-800 rounded-lg hover:border-purple-600 hover:bg-purple-950/20 group transition-all"
              >
                <div className="w-10 h-10 flex items-center justify-center bg-purple-900/30 text-purple-500 border border-purple-800 rounded-full group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </div>
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest group-hover:text-purple-400">{nameB}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-900/30 text-blue-500 border border-blue-800 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-xl font-bold text-neutral-100 mb-2">Swipe Session Complete!</h3>
            <p className="text-sm text-neutral-500 mb-8 max-w-sm mx-auto">You've labeled {Object.keys(assignments).length} messages. Gemini will re-label the remaining items for you.</p>
            <button 
              onClick={() => onComplete(nameA, nameB, assignments)}
              className="px-8 py-2.5 bg-blue-600 text-white text-sm font-bold rounded hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
            >
              Finish & Relabel Rest
            </button>
          </div>
        )}
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
    </div></div>
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
  const [splittingLabel, setSplittingLabel] = useState<LabelDefinition | null>(null)
  const [mergeState, setMergeState] = useState<{ source: LabelDefinition, target: LabelDefinition } | null>(null)
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

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-neutral-500 text-xs tracking-widest uppercase">
      Fetching taxonomy...
    </div>
  )

  return (
    <div className="flex-1 bg-neutral-950 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100 tracking-tight">Taxonomy Management</h1>
            <p className="text-sm text-neutral-500 mt-1.5">Refine your classification system by splitting or merging labels.</p>
          </div>
          <div className="bg-neutral-900 px-4 py-2 rounded border border-neutral-800 flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-neutral-600 uppercase tracking-widest">Total Coverage</span>
              <span className="text-sm font-bold text-blue-400">{labels.reduce((acc, l) => acc + l.count, 0)}</span>
            </div>
            <div className="w-px h-6 bg-neutral-800" />
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-neutral-600 uppercase tracking-widest">Unique Labels</span>
              <span className="text-sm font-bold text-neutral-300">{labels.length}</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {labels.map(label => (
            <div 
              key={label.id}
              draggable
              onDragStart={() => setDraggedId(label.id)}
              onDragOver={(e) => {
                e.preventDefault()
              }}
              onDrop={() => {
                const source = labels.find(l => l.id === draggedId)
                if (source && source.id !== label.id) {
                  setMergeState({ source, target: label })
                }
                setDraggedId(null)
              }}
              className={`
                group relative bg-neutral-900 border border-neutral-800 rounded p-6 transition-all duration-200 cursor-move
                ${draggedId === label.id ? 'opacity-30 border-blue-600 shadow-inner' : 'hover:border-neutral-700 hover:shadow-xl hover:shadow-black/20'}
                ${draggedId && draggedId !== label.id ? 'hover:ring-1 hover:ring-blue-500' : ''}
              `}
            >
              <div className="flex justify-between items-start mb-5">
                <span className="text-2xl font-black text-neutral-800/40 group-hover:text-neutral-700/50 transition-colors">#{label.id}</span>
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
                  onClick={() => setSplittingLabel(label)}
                  className="flex-1 py-1.5 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
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

        {labels.length === 0 && (
          <div className="text-center py-24 bg-neutral-900/30 border border-dashed border-neutral-800 rounded">
            <p className="text-neutral-600 italic text-sm tracking-widest uppercase font-medium">Empty Taxonomy</p>
          </div>
        )}
      </div>

      {splittingLabel && (
        <SplitSessionModal 
          label={splittingLabel}
          onClose={() => setSplittingLabel(null)}
          onComplete={handleSplitComplete}
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
    </div>
  )
}
