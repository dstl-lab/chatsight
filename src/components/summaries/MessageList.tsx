import type { MessageListItem } from '../../types'
import { MessageListRow } from './MessageListRow'

interface MessageListProps {
  items: MessageListItem[]
  activeKey: { chatlog_id: number; message_index: number } | null
  onSelect: (key: { chatlog_id: number; message_index: number }) => void
  height?: number
}

export function MessageList({ items, activeKey, onSelect, height = 600 }: MessageListProps) {
  return (
    <div style={{ height, overflowY: 'auto' }}>
      {items.map((item) => {
        const isActive =
          !!activeKey &&
          activeKey.chatlog_id === item.chatlog_id &&
          activeKey.message_index === item.message_index
        return (
          <MessageListRow
            key={`${item.chatlog_id}-${item.message_index}`}
            item={item}
            active={isActive}
            onSelect={() => onSelect({ chatlog_id: item.chatlog_id, message_index: item.message_index })}
          />
        )
      })}
    </div>
  )
}
