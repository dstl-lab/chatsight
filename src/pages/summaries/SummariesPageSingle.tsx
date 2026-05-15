import { useEffect, useState, useCallback } from 'react'
import { LabelRail } from '../../components/summaries/LabelRail'
import { DetailHeader, type SummariesTab } from '../../components/summaries/DetailHeader'
import { TriageTab } from '../../components/summaries/TriageTab'
import { SettingsTab } from '../../components/summaries/SettingsTab'
import { RenameModal } from '../../components/summaries/RenameModal'
import { DeleteConfirmModal } from '../../components/summaries/DeleteConfirmModal'
import { api } from '../../services/api'
import type { HandoffSummaryItem, SingleLabelDetail } from '../../types'

export function SummariesPageSingle() {
  const [items, setItems] = useState<HandoffSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem('summaries.active_label_id')
    return stored ? Number(stored) : null
  })
  const [detail, setDetail] = useState<SingleLabelDetail | null>(null)
  const [tab, setTab] = useState<SummariesTab>('browse')
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const refreshList = useCallback(() => {
    api.listHandoffSummaries().then(setItems)
  }, [])

  const refreshDetail = useCallback(() => {
    if (activeId === null) {
      setDetail(null)
      return
    }
    api.getSingleLabelDetail(activeId).then(setDetail)
  }, [activeId])

  useEffect(() => {
    api.listHandoffSummaries().then((s) => {
      setItems(s)
      setLoading(false)
    })
  }, [])
  useEffect(() => { refreshDetail() }, [refreshDetail])
  useEffect(() => {
    if (activeId !== null) localStorage.setItem('summaries.active_label_id', String(activeId))
    else localStorage.removeItem('summaries.active_label_id')
  }, [activeId])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-faint font-mono text-[10px] tracking-[0.18em] uppercase animate-pulse">
        Loading…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface">
        <div className="text-center max-w-md">
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-2">no labels yet</div>
          <div className="font-serif text-[15px]">
            Head to <a href="/run" className="text-ochre underline">Run</a> to create your first label.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex bg-canvas min-h-0">
      <LabelRail items={items} activeId={activeId} onSelect={(id) => { setActiveId(id); setTab('browse') }} />
      <section className="flex-1 flex flex-col min-w-0">
        {detail ? (
          <>
            <DetailHeader
              detail={detail}
              activeTab={tab}
              onTabChange={setTab}
              onMenuAction={(action) => {
                if (action === 'rename' || action === 'edit') setRenameOpen(true)
                else if (action === 'delete') setDeleteOpen(true)
                else if (action === 'rehandoff') {
                  if (!confirm('Re-handoff this label to Gemini?')) return
                  api.handoffSingleLabel(detail.id).then(() => { refreshList(); refreshDetail() })
                }
              }}
            />
            {tab === 'browse' && (
              <TriageTab label={detail} onLabelChanged={() => { refreshList(); refreshDetail() }} />
            )}
            {tab === 'settings' && (
              <SettingsTab
                detail={detail}
                onRehandoff={async () => {
                  if (!confirm('Re-handoff this label to Gemini?')) return
                  await api.handoffSingleLabel(detail.id)
                  refreshList(); refreshDetail()
                }}
                onSaveThreshold={async (v) => {
                  await api.patchSingleLabel(detail.id, { review_threshold: v })
                  refreshDetail()
                }}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
            select a label →
          </div>
        )}
      </section>
      {renameOpen && detail && (
        <RenameModal
          initialName={detail.name}
          initialDescription={detail.description}
          onSave={async (name, description) => {
            await api.patchSingleLabel(detail.id, { name, description })
            setRenameOpen(false)
            refreshList(); refreshDetail()
          }}
          onCancel={() => setRenameOpen(false)}
        />
      )}
      {deleteOpen && detail && (
        <DeleteConfirmModal
          labelName={detail.name}
          onConfirm={async () => {
            await api.deleteSingleLabel(detail.id)
            setDeleteOpen(false)
            setActiveId(null)
            refreshList()
          }}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}
