interface ConversationMetaProps {
  chatlogId: number
  notebook: string | null
  turnCount: number
}

export function ConversationMeta({ chatlogId, notebook, turnCount }: ConversationMetaProps) {
  return (
    <div className="px-12 py-[11px] border-t border-b border-edge-subtle bg-canvas">
      <div className="max-w-[760px] mx-auto font-mono text-[10px] tracking-[0.14em] uppercase text-faint">
        Conversation #{chatlogId}
        {notebook && (
          <>
            <span className="mx-2.5 opacity-50">·</span>
            {notebook}
          </>
        )}
        <span className="mx-2.5 opacity-50">·</span>
        {turnCount} turns
      </div>
    </div>
  )
}
