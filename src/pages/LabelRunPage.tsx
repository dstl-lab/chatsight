import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { LabelDashboardItem, NextMessage, ReadinessState, DecisionValue } from '../types'
import { LabelHeader } from '../components/run/LabelHeader'
import { ConversationContext } from '../components/run/ConversationContext'
import { FocusedMessage } from '../components/run/FocusedMessage'
import { DecisionBar } from '../components/run/DecisionBar'

export function LabelRunPage() {
  const navigate = useNavigate()
  const [label, setLabel] = useState<LabelDashboardItem | null>(null)
  const [next, setNext] = useState<NextMessage | null>(null)
  const [readiness, setReadiness] = useState<ReadinessState | null>(null)
  const [busy, setBusy] = useState(false)
  const [handoffBusy, setHandoffBusy] = useState(false)

  const loadAll = useCallback(async (labelId: number) => {
    const [n, r] = await Promise.all([
      api.getBinaryNext(labelId),
      api.getBinaryReadiness(labelId),
    ])
    setNext(n)
    setReadiness(r)
  }, [])

  useEffect(() => {
    let cancelled = false
    api.listBinaryLabels().then((labels) => {
      if (cancelled) return
      const active = labels.find((l) => l.is_active) ?? null
      if (!active) {
        navigate('/labels')
        return
      }
      setLabel(active)
      loadAll(active.id)
    })
    return () => { cancelled = true }
  }, [loadAll, navigate])

  const onDecide = async (value: DecisionValue) => {
    if (!label || !next || next.done || busy) return
    setBusy(true)
    try {
      const nextMsg = await api.decideBinary(label.id, {
        chatlog_id: next.chatlog_id!,
        message_index: next.message_index!,
        value,
      })
      setNext(nextMsg)
      const r = await api.getBinaryReadiness(label.id)
      setReadiness(r)
    } finally {
      setBusy(false)
    }
  }

  const onHandoff = async () => {
    if (!label) return
    setHandoffBusy(true)
    try {
      await api.binaryHandoff(label.id)
      navigate('/labels')
    } finally {
      setHandoffBusy(false)
    }
  }

  if (!label) {
    return <div className="p-6 text-neutral-400">Loading…</div>
  }

  const handoffDisabled = !readiness?.ready

  return (
    <div className="flex flex-col h-full">
      <LabelHeader
        label={label}
        readiness={readiness}
        onHandoff={onHandoff}
        handoffDisabled={handoffDisabled}
        loading={handoffBusy}
      />
      <div className="flex-1 overflow-auto px-6 py-6 max-w-3xl mx-auto w-full">
        {next?.done ? (
          <div className="text-center py-12">
            <p className="text-neutral-300 text-lg">All caught up for this label.</p>
            <p className="text-neutral-500 mt-2">Hand off to Gemini, or close the label and start a new one.</p>
          </div>
        ) : next ? (
          <>
            <ConversationContext messages={next.conversation_context} focusedIndex={next.conversation_context.length - 1} />
            <FocusedMessage text={next.message_text!} contextBefore={next.context_before} />
            <div className="mt-6">
              <DecisionBar onDecide={onDecide} disabled={busy} />
            </div>
          </>
        ) : (
          <div className="text-neutral-400">Loading next message…</div>
        )}
      </div>
    </div>
  )
}
