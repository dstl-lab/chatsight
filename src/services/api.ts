// src/services/api.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse,
  QueueStats, ApplyLabelRequest, CreateLabelRequest, UpdateLabelRequest,
  HistoryItem, OrphanedMessagesResponse, ArchiveResponse,
  ConceptCandidate, EmbedStatus, AnalysisSummary, TemporalAnalysis,
} from '../types'
import { mockApi } from '../mocks'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  getQueue: (limit = 20): Promise<QueueItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.queue)
             : req(`/api/queue?limit=${limit}`),

  applyLabel: (body: ApplyLabelRequest): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req('/api/queue/apply', { method: 'POST', ...json(body) }),

  skipMessage: (chatlog_id: number, message_index: number): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req('/api/queue/skip', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  suggestLabel: (chatlog_id: number, message_index: number): Promise<SuggestResponse> =>
    USE_MOCK ? Promise.resolve(mockApi.suggestion)
             : req('/api/queue/suggest', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  getLabels: (): Promise<LabelDefinition[]> =>
    USE_MOCK ? Promise.resolve(mockApi.labels)
             : req('/api/labels'),

  createLabel: (body: CreateLabelRequest): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve({ ...body, id: Date.now(), description: body.description ?? null, created_at: new Date().toISOString(), count: 0 })
             : req('/api/labels', { method: 'POST', ...json(body) }),

  updateLabel: (id: number, body: UpdateLabelRequest): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve(mockApi.labels[0])
             : req(`/api/labels/${id}`, { method: 'PUT', ...json(body) }),

  getSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session'),

  startSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session/start', { method: 'POST' }),

  getQueueStats: (): Promise<QueueStats> =>
    USE_MOCK ? Promise.resolve({ total_messages: 100, labeled_count: 14, skipped_count: 3 })
             : req('/api/queue/stats'),

  unapplyLabel: (chatlog_id: number, message_index: number, label_id: number): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req(`/api/queue/apply?chatlog_id=${chatlog_id}&message_index=${message_index}&label_id=${label_id}`, { method: 'DELETE' }),

  getAppliedLabels: (chatlog_id: number, message_index: number): Promise<number[]> =>
    USE_MOCK ? Promise.resolve([])
             : req<{ label_ids: number[] }>(`/api/queue/applied?chatlog_id=${chatlog_id}&message_index=${message_index}`).then(r => r.label_ids),

  advanceMessage: (chatlog_id: number, message_index: number): Promise<{ ok: boolean; counted: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true, counted: true })
             : req('/api/queue/advance', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  undoLabels: (chatlog_id: number, message_index: number): Promise<{ ok: boolean; removed_count: number }> =>
    USE_MOCK ? Promise.resolve({ ok: true, removed_count: 0 })
             : req('/api/queue/undo', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  startAutolabel: (): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req('/api/queue/autolabel', { method: 'POST' }),

  getAutolabelStatus: (): Promise<{ running: boolean; processed: number; total: number; error: string | null }> =>
    USE_MOCK ? Promise.resolve({ running: false, processed: 0, total: 0, error: null })
             : req('/api/queue/autolabel/status'),

  getQueuePosition: (): Promise<{ position: number; total_remaining: number }> =>
    USE_MOCK ? Promise.resolve(mockApi.queuePosition)
             : req('/api/queue/position'),

  getRecentHistory: (limit = 20): Promise<HistoryItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.history)
             : req<{ items: HistoryItem[]; total: number }>(`/api/queue/history?limit=${limit}`).then(r => r.items),

  unskipMessage: (chatlog_id: number, message_index: number): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req(`/api/queue/skip?chatlog_id=${chatlog_id}&message_index=${message_index}`, { method: 'DELETE' }),

  reorderLabels: (labelIds: number[]): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req('/api/labels/reorder', { method: 'PUT', ...json({ label_ids: labelIds }) }),

  getHistory: (params: {
    limit?: number; offset?: number;
    filter?: 'all' | 'human' | 'ai' | 'skipped';
    sort_by?: 'processed_at' | 'confidence';
    search?: string;
  } = {}): Promise<{ items: HistoryItem[]; total: number }> => {
    if (USE_MOCK) return Promise.resolve({ items: mockApi.history, total: mockApi.history.length })
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    if (params.offset) q.set('offset', String(params.offset))
    if (params.filter && params.filter !== 'all') q.set('filter', params.filter)
    if (params.sort_by) q.set('sort_by', params.sort_by)
    if (params.search) q.set('search', params.search)
    return req(`/api/queue/history?${q.toString()}`)
  },

  getMessage: (chatlog_id: number, message_index: number): Promise<QueueItem> =>
    USE_MOCK ? Promise.resolve(mockApi.queue[0])
             : req(`/api/queue/message?chatlog_id=${chatlog_id}&message_index=${message_index}`),

  getOrphanedMessages: (labelId: number): Promise<OrphanedMessagesResponse> =>
    USE_MOCK ? Promise.resolve({ messages: [], count: 0 })
             : req(`/api/labels/${labelId}/orphaned-messages`),

  archiveLabel: (labelId: number): Promise<ArchiveResponse> =>
    USE_MOCK ? Promise.resolve({ archived_at: new Date().toISOString(), messages_returned_to_queue: 0 })
             : req(`/api/labels/${labelId}/archive`, { method: 'PUT' }),

  // ── Concept Induction ──────────────────────────────────────────
  discoverConcepts: (): Promise<{ run_id: string; status: string }> =>
    USE_MOCK ? Promise.resolve({ run_id: 'mock-run', status: 'running' })
             : req('/api/concepts/discover', { method: 'POST', ...json({}) }),

  getCandidates: (): Promise<ConceptCandidate[]> =>
    USE_MOCK ? Promise.resolve([])
             : req('/api/concepts/candidates'),

  resolveCandidate: (id: number, action: 'accept' | 'reject', name?: string): Promise<LabelDefinition | { ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/concepts/candidates/${id}`, { method: 'PUT', ...json({ action, name }) }),

  getEmbedStatus: (): Promise<EmbedStatus> =>
    USE_MOCK ? Promise.resolve({ cached: 0, total_unlabeled: 0, running: false })
             : req('/api/concepts/embed-status'),

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
