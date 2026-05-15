import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import { TriageStrip } from './TriageStrip'
import { TriageFilterRow, type TriageFilter } from './TriageFilterRow'
import { AiReviewDock } from '../decision/AiReviewDock'
import { DecisionWorkspace } from '../decision/DecisionWorkspace'
import type {
  BrowseSort,
  ConversationTurn,
  MessageDetail,
  MessageListItem,
  SingleLabelDetail,
} from '../../types'

const PAGE_SIZE = 50

type Decision = { cursor: number; from: 'yes' | 'no' | null; to: 'yes' | 'no' }

interface TriageTabProps {
  label: SingleLabelDetail
  onLabelChanged: () => void
}

export function TriageTab({ label, onLabelChanged }: TriageTabProps) {
  const [filter, setFilter] = useState<TriageFilter>('review')
  const [sort, setSort] = useState<BrowseSort>('confidence_asc')
  const [items, setItems] = useState<MessageListItem[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [focused, setFocused] = useState<MessageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Decision[]>([])

  const [prefetching, setPrefetching] = useState(false)

  const hiddenCount = Math.max(0, label.yes_count + label.no_count - label.review_count)

  const decide = async (verdict: 'yes' | 'no') => {
    const cur = items[cursor]
    if (!cur || !focused) return
    const prevVerdict = focused.verdict
    // Optimistic flip
    setFocused({ ...focused, verdict, applied_by: 'human' })
    setItems((arr) =>
      arr.map((it, i) =>
        i === cursor ? { ...it, verdict, applied_by: 'human' } : it,
      ),
    )
    try {
      await api.flipSingleLabelVerdict(label.id, cur.chatlog_id, cur.message_index, verdict)
      onLabelChanged()
      setHistory((h) => [
        ...h.slice(-9),
        { cursor, from: prevVerdict as 'yes' | 'no' | null, to: verdict },
      ])
      setCursor((c) => Math.min(c + 1, items.length))
    } catch {
      setError('Flip failed — retry?')
      setTimeout(() => setError(null), 4000)
      setFocused({ ...focused, verdict: prevVerdict })
      setItems((arr) =>
        arr.map((it, i) =>
          i === cursor ? { ...it, verdict: prevVerdict, applied_by: 'ai' } : it,
        ),
      )
    }
  }

  const acceptAi = () => {
    if (!focused?.verdict || focused.verdict === 'review') return
    decide(focused.verdict)
  }

  const skip = () => {
    setCursor((c) => Math.min(c + 1, items.length))
  }

  const undo = async () => {
    const last = history[history.length - 1]
    if (!last) {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    setCursor(last.cursor)
    setHistory((h) => h.slice(0, -1))
    const cur = items[last.cursor]
    if (!cur || last.from === null) return
    try {
      await api.flipSingleLabelVerdict(label.id, cur.chatlog_id, cur.message_index, last.from)
      onLabelChanged()
    } catch {
      setError('Undo failed — retry?')
      setTimeout(() => setError(null), 4000)
    }
  }

  useEffect(() => {
    api
      .listSingleLabelMessages(label.id, { bucket: filter, sort, limit: PAGE_SIZE, offset: 0 })
      .then((r) => {
        setItems(r.items)
        setTotal(r.total)
        setCursor(0)
      })
  }, [label.id, filter, sort])

  useEffect(() => {
    if (prefetching) return
    if (items.length === 0) return
    if (items.length >= total) return
    if (cursor < items.length - 5) return
    setPrefetching(true)
    api
      .listSingleLabelMessages(label.id, {
        bucket: filter,
        sort,
        limit: PAGE_SIZE,
        offset: items.length,
      })
      .then((r) => {
        if (r.items.length === 0) return
        setItems((cur) => [...cur, ...r.items])
      })
      .finally(() => setPrefetching(false))
  }, [label.id, filter, sort, items.length, total, cursor, prefetching])

  useEffect(() => {
    const cur = items[cursor]
    if (!cur) {
      setFocused(null)
      return
    }
    api
      .getSingleLabelMessageDetail(label.id, cur.chatlog_id, cur.message_index, '2')
      .then(setFocused)
  }, [label.id, items, cursor])

  const thread: ConversationTurn[] = useMemo(() => {
    if (!focused) return []
    return [
      ...focused.context_before.map((t) => ({
        message_index: t.turn_index,
        role: t.role,
        text: t.text,
      })),
      { message_index: focused.turn_index, role: 'student' as const, text: focused.text },
      ...focused.context_after.map((t) => ({
        message_index: t.turn_index,
        role: t.role,
        text: t.text,
      })),
    ]
  }, [focused])

  const focusIndex = focused?.context_before.length ?? 0

  const isCaughtUp = items.length === 0 || cursor >= items.length

  const header = (
    <>
      <TriageStrip
        cursor={isCaughtUp ? 0 : cursor}
        reviewTotal={isCaughtUp ? 0 : items.length}
        hiddenCount={hiddenCount}
      />
      <TriageFilterRow
        filter={filter}
        sort={sort}
        reviewCount={label.review_count}
        flaggedCount={0}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />
    </>
  )

  return (
    <>
      <DecisionWorkspace
        thread={isCaughtUp || !focused ? [] : thread}
        focusIndex={focusIndex}
        header={header}
        emptyState={
          <div className="text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
            All caught up for "{filter}"
          </div>
        }
        dock={
          <AiReviewDock
            mode={{
              kind: 'triage',
              aiVerdict:
                focused?.verdict === 'yes' || focused?.verdict === 'no' ? focused.verdict : 'yes',
            }}
            onYes={() => decide('yes')}
            onNo={() => decide('no')}
            onAcceptAi={acceptAi}
            onSkip={skip}
            onUndo={undo}
            canUndo={history.length > 0 || cursor > 0}
            disabled={!focused}
          />
        }
        onYes={() => decide('yes')}
        onNo={() => decide('no')}
        onSkip={skip}
        onUndo={undo}
        onAcceptAi={acceptAi}
        disabled={!focused}
      />
      {error && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 bg-brick-dim border border-brick text-paper px-3 py-2 rounded-sm font-mono text-[11px] z-50"
        >
          {error}
        </div>
      )}
    </>
  )
}
