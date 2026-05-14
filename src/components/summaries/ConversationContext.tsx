import { useState } from 'react'
import type { SummariesConversationTurn } from '../../types'

interface ConversationContextProps {
  before: SummariesConversationTurn[]
  after: SummariesConversationTurn[]
  focusedText: string
  focusedTurnIndex: number
  totalTurns: number
}

export function ConversationContext({
  before, after, focusedText, focusedTurnIndex, totalTurns,
}: ConversationContextProps) {
  const [beforeOpen, setBeforeOpen] = useState(false)
  const [afterOpen, setAfterOpen] = useState(false)

  return (
    <div>
      <div className="font-mono text-[11px] text-muted mb-2.5">
        turn {focusedTurnIndex + 1} of {totalTurns}
      </div>

      {before.length > 0 && (
        <button
          onClick={() => setBeforeOpen(!beforeOpen)}
          className="w-full text-left px-3 py-2 rounded-sm bg-surface hover:bg-elevated font-mono text-[10px] tracking-[0.12em] uppercase text-muted mb-1 flex justify-between"
        >
          <span>▾ {before.length} tutor turn{before.length === 1 ? '' : 's'} before</span>
          <span className="opacity-60">{beforeOpen ? 'collapse' : 'expand'}</span>
        </button>
      )}
      {beforeOpen && before.map((t, i) => (
        <div key={`b-${i}`} className="pl-3.5 border-l-2 border-edge italic text-muted text-[13.5px] leading-[1.55] py-2">
          {t.text}
        </div>
      ))}

      <div className="border-l-[3px] border-ochre bg-[rgba(228,181,59,0.06)] pl-3.5 pr-3 py-3 my-1.5 -ml-3.5">
        <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-ochre">● student · turn {focusedTurnIndex + 1}</div>
        <div className="text-paper text-[19px] leading-[1.55] mt-1.5 font-serif">{focusedText}</div>
      </div>

      {after.length > 0 && (
        <button
          onClick={() => setAfterOpen(!afterOpen)}
          className="w-full text-left px-3 py-2 rounded-sm bg-surface hover:bg-elevated font-mono text-[10px] tracking-[0.12em] uppercase text-muted mt-1 flex justify-between"
        >
          <span>▾ {after.length} tutor turn{after.length === 1 ? '' : 's'} after</span>
          <span className="opacity-60">{afterOpen ? 'collapse' : 'expand'}</span>
        </button>
      )}
      {afterOpen && after.map((t, i) => (
        <div key={`a-${i}`} className="pl-3.5 border-l-2 border-edge italic text-muted text-[13.5px] leading-[1.55] py-2">
          {t.text}
        </div>
      ))}
    </div>
  )
}
