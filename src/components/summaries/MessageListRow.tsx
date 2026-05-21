import type { MessageListItem } from '../../types'
import { AppliedByGlyph } from './AppliedByGlyph'

interface MessageListRowProps {
  item: MessageListItem
  active: boolean
  onSelect: () => void
}

function confColor(v: MessageListItem['verdict']): string {
  if (v === 'yes') return 'text-moss'
  if (v === 'no') return 'text-brick'
  return 'text-ochre'  // review or null
}

export function MessageListRow({ item, active, onSelect }: MessageListRowProps) {
  return (
    <div
      onClick={onSelect}
      // active rows draw a 2px left border; pl-[18px] = px-5 (20px) minus that
      // border so the glyph/confidence columns don't shift.
      className={`grid grid-cols-[16px_38px_1fr] items-center gap-2.5 px-5 py-2 cursor-pointer ${
        active ? 'bg-elevated border-l-2 border-ochre pl-[18px]' : 'hover:bg-surface'
      }`}
    >
      <span className="flex justify-center">
        <AppliedByGlyph
          appliedBy={item.applied_by}
          chatlogId={item.chatlog_id}
          messageIndex={item.message_index}
        />
      </span>
      <span className={`font-mono text-[11px] text-right tabular-nums ${confColor(item.verdict)}`}>
        {item.confidence !== null ? item.confidence.toFixed(2) : '—'}
      </span>
      <span className="text-paper text-[13.5px] truncate font-serif">
        {item.flagged && (
          <span
            data-testid={`flag-glyph-${item.chatlog_id}-${item.message_index}`}
            className="text-brick mr-1"
          >
            ⚑
          </span>
        )}
        {item.text}
        {item.has_note && (
          <span
            data-testid={`note-dot-${item.chatlog_id}-${item.message_index}`}
            className="inline-block w-1 h-1 rounded-full bg-ochre ml-1.5 align-middle"
          />
        )}
      </span>
    </div>
  )
}
