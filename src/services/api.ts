// src/services/api.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse,
  QueueStats, ApplyLabelRequest, CreateLabelRequest, UpdateLabelRequest,
  HistoryItem, OrphanedMessagesResponse, ArchiveResponse, RecalibrationItem,
  ConceptCandidate, EmbedStatus, AnalysisSummary, TemporalAnalysis,
  LabelExample, SplitAutoLabelRequest, ApplyBatchRequest, ConciseResponse
} from '../types'
import { mockApi } from '../mocks'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

const json = (body: any) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  getChatlogs: (): Promise<any[]> =>
    USE_MOCK ? Promise.resolve(mockApi.chatlogs)
             : req('/api/chatlogs'),

  getChatlog: (id: number): Promise<any> =>
    USE_MOCK ? Promise.resolve(mockApi.chatlog)
             : req(`/api/chatlogs/${id}`),

  getLabelSets: (id: number): Promise<LabelingSession[]> =>
    USE_MOCK ? Promise.resolve(mockApi.labelSets)
             : req(`/api/chatlogs/${id}/label-sets`),

  getLabels: (): Promise<LabelDefinition[]> =>
    USE_MOCK ? Promise.resolve(mockApi.labels)
             : req('/api/labels'),

  createLabel: (body: CreateLabelRequest): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve({ ...body, id: Math.random(), created_at: new Date().toISOString(), count: 0, description: body.description ?? null })
             : req('/api/labels', { method: 'POST', ...json(body) }),

  updateLabel: (id: number, body: UpdateLabelRequest): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve({ ...body, id } as any)
             : req(`/api/labels/${id}`, { method: 'PUT', ...json(body) }),

  reorderLabels: (labelIds: number[]): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req('/api/labels/reorder', { method: 'POST', ...json({ label_ids: labelIds }) }),

  applyLabel: (body: ApplyLabelRequest): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req('/api/queue/apply', { method: 'POST', ...json(body) }),

  skipMessage: (chatlog_id: number, message_index: number): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req('/api/queue/skip', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  unskipMessage: (chatlog_id: number, message_index: number): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req('/api/queue/skip', { method: 'DELETE', ...json({ chatlog_id, message_index }) }),

  getQueue: (limit = 20): Promise<QueueItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.queue)
             : req(`/api/queue?limit=${limit}`),

  getQueueStats: (): Promise<QueueStats> =>
    USE_MOCK ? Promise.resolve(mockApi.stats)
             : req('/api/queue/stats'),

  getQueuePosition: (): Promise<{ position: number; total_remaining: number }> =>
    USE_MOCK ? Promise.resolve(mockApi.queuePosition)
             : req('/api/queue/position'),

  suggest: (chatlog_id: number, message_index: number): Promise<SuggestResponse> =>
    USE_MOCK ? Promise.resolve({ label_name: '', evidence: '', rationale: '' })
             : req('/api/queue/suggest', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  advance: (chatlog_id: number, message_index: number): Promise<QueueItem | null> =>
    USE_MOCK ? Promise.resolve(mockApi.queue[0])
             : req('/api/queue/advance', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  undo: (): Promise<QueueItem | null> =>
    USE_MOCK ? Promise.resolve(mockApi.queue[0])
             : req('/api/queue/undo', { method: 'POST' }),

  getHistory: (limit = 50): Promise<HistoryItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.history)
             : req(`/api/history?limit=${limit}`),

  getRecentHistory: (limit = 20): Promise<HistoryItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.history)
             : req<{ items: HistoryItem[]; total: number }>(`/api/queue/history?limit=${limit}`).then(r => r.items),

  getSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session'),

  startSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session/start', { method: 'POST' }),

  getOrphanedMessages: (): Promise<OrphanedMessagesResponse> =>
    USE_MOCK ? Promise.resolve({ orphaned: [] } as any)
             : req('/api/history/orphaned'),

  archiveOrphaned: (ids: { chatlog_id: number, message_index: number }[]): Promise<ArchiveResponse> =>
    USE_MOCK ? Promise.resolve({ archived: ids.length } as any)
             : req('/api/history/archive-orphaned', { method: 'POST', ...json({ messages: ids }) }),

  // Concept Discovery
  discoverConcepts: (limit = 10): Promise<any> =>
    USE_MOCK ? Promise.resolve({ candidates: [], status: { cached: 0, total_unlabeled: 0, running: false } })
             : req(`/api/concepts/discover?limit=${limit}`, { method: 'POST' }),

  getCandidates: (): Promise<ConceptCandidate[]> =>
    USE_MOCK ? Promise.resolve([])
             : req('/api/concepts/candidates'),

  resolveCandidate: (id: number, action: 'accept' | 'reject', name?: string): Promise<LabelDefinition | { ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/concepts/candidates/${id}`, { method: 'PUT', ...json({ action, name }) }),

  getEmbedStatus: (): Promise<EmbedStatus> =>
    USE_MOCK ? Promise.resolve({ cached: 0, total_unlabeled: 0, running: false })
             : req('/api/concepts/embed-status'),

  getConciseMessage: (chatlog_id: number, message_index: number): Promise<ConciseResponse> =>
    USE_MOCK ? Promise.resolve({ concise_text: "Concise summary from AI." })
             : req('/api/queue/concise', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  getLabelExamples: (labelId: number, limit = 50): Promise<LabelExample[]> =>
    USE_MOCK ? Promise.resolve([])
             : req(`/api/labels/${labelId}/examples?limit=${limit}`),

  mergeLabels: (sourceLabelId: number, targetLabelId: number): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve(mockApi.labels[0])
             : req('/api/labels/merge', { method: 'POST', ...json({ source_label_id: sourceLabelId, target_label_id: targetLabelId }) }),

  splitLabelAutoLabel: (body: SplitAutoLabelRequest): Promise<LabelDefinition[]> =>
    USE_MOCK ? Promise.resolve([])
             : req('/api/labels/split-autolabel', { method: 'POST', ...json(body) }),

  deleteLabel: (id: number, force = false): Promise<{ ok: boolean, deleted_applications: number }> =>
    USE_MOCK ? Promise.resolve({ ok: true, deleted_applications: 0 })
             : req(`/api/labels/${id}?force=${force}`, { method: 'DELETE' }),

  applyBatch: (body: ApplyBatchRequest): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req('/api/queue/apply-batch', { method: 'POST', ...json(body) }),

  getRecalibration: (): Promise<RecalibrationItem[]> =>
    USE_MOCK ? Promise.resolve([])
             : req('/api/session/recalibration'),

  getSkippedMessages: (): Promise<QueueItem[]> =>
    USE_MOCK ? Promise.resolve([])
             : req('/api/queue/skipped'),

  getAnalysisSummary: (): Promise<AnalysisSummary> =>
    USE_MOCK ? Promise.resolve(mockApi.analysisSummary)
             : req('/api/analysis/summary'),

  getTemporalAnalysis: (opts?: { calendarFrom: string; calendarTo: string }): Promise<TemporalAnalysis> => {
    if (USE_MOCK) return Promise.resolve(mockApi.temporalAnalysis)
    const q = new URLSearchParams()
    if (opts) {
      q.set('calendar_from', opts.calendarFrom)
      q.set('calendar_to', opts.calendarTo)
    }
    const suffix = q.toString() ? `?${q.toString()}` : ''
    return req(`/api/analysis/temporal${suffix}`)
  },

  exportCsv: async (): Promise<Blob> => {
    if (USE_MOCK) {
      const header = 'chatlog_id,message_index,message_text,label_name,applied_by,created_at\n'
      return new Blob([header + '1,0,"Hello",Concept Question,human,2026-01-01T00:00:00\n'], {
        type: 'text/csv',
      })
    }
    const res = await fetch('/api/export/csv')
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    return res.blob()
  },
}
