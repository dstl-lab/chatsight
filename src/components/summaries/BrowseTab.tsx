import { useEffect, useState, useCallback } from 'react'
import { api } from '../../services/api'
import { FilterBar } from './FilterBar'
import { MessageList } from './MessageList'
import { FocusedMessage } from './FocusedMessage'
import type {
  BrowseBucket, BrowseSort, ContextDepth,
  MessageListItem, MessageDetail, SingleLabelDetail,
} from '../../types'

interface BrowseTabProps {
  label: SingleLabelDetail
  onLabelChanged: () => void
}

export function BrowseTab({ label, onLabelChanged }: BrowseTabProps) {
  const [bucket, setBucket] = useState<BrowseBucket>(
    () => (localStorage.getItem('summaries.browse.bucket') as BrowseBucket) || 'all',
  )
  const [sort, setSort] = useState<BrowseSort>(
    () => (localStorage.getItem('summaries.browse.sort') as BrowseSort) || 'confidence_asc',
  )
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MessageListItem[]>([])
  const [activeKey, setActiveKey] = useState<{ chatlog_id: number; message_index: number } | null>(null)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const contextDepth: ContextDepth = (localStorage.getItem('summaries.context_depth') as ContextDepth) || '1'

  useEffect(() => {
    api
      .listSingleLabelMessages(label.id, {
        bucket: bucket === 'all' ? undefined : bucket,
        sort,
        search: search || undefined,
        limit: 200,
      })
      .then((r) => setItems(r.items))
    localStorage.setItem('summaries.browse.bucket', bucket)
    localStorage.setItem('summaries.browse.sort', sort)
  }, [label.id, bucket, sort, search])

  useEffect(() => {
    if (!activeKey) {
      setDetail(null)
      return
    }
    api
      .getSingleLabelMessageDetail(label.id, activeKey.chatlog_id, activeKey.message_index, contextDepth)
      .then(setDetail)
  }, [label.id, activeKey, contextDepth])

  const flip = useCallback(
    async (verdict: 'yes' | 'no') => {
      if (!activeKey || !detail) return
      const prev = detail
      setDetail({ ...detail, verdict, applied_by: 'human' })
      setItems((cur) =>
        cur.map((it) =>
          it.chatlog_id === activeKey.chatlog_id && it.message_index === activeKey.message_index
            ? { ...it, verdict, applied_by: 'human' }
            : it,
        ),
      )
      try {
        await api.flipSingleLabelVerdict(
          label.id,
          activeKey.chatlog_id,
          activeKey.message_index,
          verdict,
        )
        onLabelChanged()
      } catch (e) {
        setDetail(prev)
        setItems((cur) =>
          cur.map((it) =>
            it.chatlog_id === activeKey.chatlog_id && it.message_index === activeKey.message_index
              ? { ...it, verdict: prev.verdict, applied_by: prev.applied_by }
              : it,
          ),
        )
      }
    },
    [activeKey, detail, label.id, onLabelChanged],
  )

  const accept = useCallback(() => {
    if (!detail?.verdict || detail.verdict === 'review') return
    flip(detail.verdict as 'yes' | 'no')
  }, [detail, flip])

  const saveNote = useCallback(
    async (text: string) => {
      if (!activeKey) return
      await api.upsertSingleLabelNote(label.id, activeKey.chatlog_id, activeKey.message_index, text)
      setItems((cur) =>
        cur.map((it) =>
          it.chatlog_id === activeKey.chatlog_id && it.message_index === activeKey.message_index
            ? { ...it, has_note: !!text }
            : it,
        ),
      )
    },
    [activeKey, label.id],
  )

  return (
    <div className="flex-1 grid grid-cols-[5fr_6fr] min-h-0">
      <div className="flex flex-col border-r border-edge min-h-0">
        <FilterBar
          bucket={bucket}
          sort={sort}
          search={search}
          onChange={(p) => {
            if (p.bucket !== undefined) setBucket(p.bucket)
            if (p.sort !== undefined) setSort(p.sort)
            if (p.search !== undefined) setSearch(p.search)
          }}
        />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MessageList items={items} activeKey={activeKey} onSelect={setActiveKey} />
        </div>
      </div>
      <div className="flex flex-col min-h-0">
        {detail ? (
          <FocusedMessage
            detail={detail}
            reviewThreshold={label.review_threshold}
            onAccept={accept}
            onFlip={flip}
            onFlag={() => { /* Phase 2 */ }}
            onSaveNote={saveNote}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
            select a message →
          </div>
        )}
      </div>
    </div>
  )
}
