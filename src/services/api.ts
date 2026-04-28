// src/services/api.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse,
  QueueStats, ApplyLabelRequest, CreateLabelRequest, UpdateLabelRequest,
  HistoryItem, OrphanedMessagesResponse, ArchiveResponse, LabelReviewItem,
  ConceptCandidate, EmbedStatus, ConversationMessage, AnalysisSummary, TemporalAnalysis,
  LabelExample, SplitAutoLabelRequest, ApplyBatchRequest, ConciseResponse,
  RecalibrationItem, RecalibrationStats, SaveRecalibrationRequest, SaveRecalibrationResponse,
  LabelDashboardItem, NextMessage, DecideRequestBody, ReadinessState, HandoffResult, ReviewQueueItem,
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
    USE_MOCK ? Promise.resolve({ total_messages: 100, labeled_count: 14, skipped_count: 0 })
             : req('/api/queue/stats'),

  getQueuePosition: (): Promise<{ position: number; total_remaining: number }> =>
    USE_MOCK ? Promise.resolve(mockApi.queuePosition)
             : req('/api/queue/position'),

  suggest: (chatlog_id: number, message_index: number): Promise<SuggestResponse> =>
    USE_MOCK ? Promise.resolve({ label_name: '', evidence: '', rationale: '' })
             : req('/api/queue/suggest', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  advanceMessage: (chatlog_id: number, message_index: number): Promise<{ ok: boolean; counted: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true, counted: true })
             : req('/api/queue/advance', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  undoLabels: (chatlog_id: number, message_index: number): Promise<{ ok: boolean; removed_count: number }> =>
    USE_MOCK ? Promise.resolve({ ok: true, removed_count: 0 })
             : req('/api/queue/undo', { method: 'POST', ...json({ chatlog_id, message_index }) }),

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

  getRecentHistory: (limit = 20): Promise<HistoryItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.history)
             : req<{ items: HistoryItem[]; total: number }>(`/api/queue/history?limit=${limit}`).then(r => r.items),

  getSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session'),

  startSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session/start', { method: 'POST' }),

  getOrphanedMessages: (labelId: number): Promise<OrphanedMessagesResponse> =>
    USE_MOCK ? Promise.resolve({ messages: [], count: 0 } as any)
             : req(`/api/labels/${labelId}/orphaned-messages`),

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

  getConversationMessages: (chatlogId: number): Promise<ConversationMessage[]> =>
    USE_MOCK ? Promise.resolve([])
             : req(`/api/chatlogs/${chatlogId}/messages`),
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

  getLabelReview: (): Promise<LabelReviewItem[]> =>
    USE_MOCK ? Promise.resolve([])
             : req('/api/session/label-review'),

  getAppliedLabels: (chatlog_id: number, message_index: number): Promise<number[]> =>
    USE_MOCK ? Promise.resolve([])
             : req<{ label_ids: number[] }>(`/api/queue/applied?chatlog_id=${chatlog_id}&message_index=${message_index}`).then(r => r.label_ids),

  unapplyLabel: (chatlog_id: number, message_index: number, label_id: number): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req(`/api/queue/apply?chatlog_id=${chatlog_id}&message_index=${message_index}&label_id=${label_id}`, { method: 'DELETE' }),

  startAutolabel: (): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req('/api/queue/autolabel', { method: 'POST' }),

  getAutolabelStatus: (): Promise<{ running: boolean; processed: number; total: number; error: string | null }> =>
    USE_MOCK ? Promise.resolve({ running: false, processed: 0, total: 0, error: null })
             : req('/api/queue/autolabel/status'),

  getMessage: (chatlog_id: number, message_index: number): Promise<QueueItem> =>
    USE_MOCK ? Promise.resolve(mockApi.queue[0])
             : req(`/api/queue/message?chatlog_id=${chatlog_id}&message_index=${message_index}`),

  archiveLabel: (labelId: number): Promise<ArchiveResponse> =>
    USE_MOCK ? Promise.resolve({ archived_at: new Date().toISOString(), messages_returned_to_queue: 0 })
             : req(`/api/labels/${labelId}/archive`, { method: 'PUT' }),

  suggestLabel: (chatlog_id: number, message_index: number): Promise<SuggestResponse> =>
    USE_MOCK ? Promise.resolve({ label_name: '', evidence: '', rationale: '' })
             : req('/api/queue/suggest', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  generateLabelDescription: (labelId: number): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve(mockApi.labels[0])
             : req(`/api/labels/${labelId}/generate-description`, { method: 'POST' }),

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

  // ── Recalibration ──────────────────────────────────────────────
  getRecalibration: (force = false): Promise<RecalibrationItem | null> =>
    USE_MOCK ? Promise.resolve(force ? mockApi.recalibrationForced() : mockApi.recalibration())
             : req(`/api/session/recalibration${force ? '?force=true' : ''}`),

  saveRecalibration: (body: SaveRecalibrationRequest): Promise<SaveRecalibrationResponse> =>
    USE_MOCK ? Promise.resolve({ matched: false, trend: 'steady' as const })
             : req('/api/session/recalibration', { method: 'POST', ...json(body) }),

  getRecalibrationStats: (): Promise<RecalibrationStats> =>
    USE_MOCK ? Promise.resolve(mockApi.recalibrationStats)
             : req('/api/session/recalibration/stats'),

  // ── Single-Label Binary Workflow ──────────────────────────────────
  listBinaryLabels: (): Promise<LabelDashboardItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryLabels)
             : req('/api/labels/binary'),

  createBinaryLabel: (body: CreateLabelRequest): Promise<LabelDashboardItem> =>
    USE_MOCK
      ? Promise.resolve({ id: Math.floor(Math.random() * 10000), name: body.name, description: body.description ?? null, phase: 'labeling', is_active: false, yes_count: 0, no_count: 0, skip_count: 0, ai_count: 0 })
      : req('/api/labels/binary', { method: 'POST', ...json(body) }),

  activateBinaryLabel: (id: number): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/labels/binary/${id}/activate`, { method: 'POST' }),

  closeBinaryLabel: (id: number): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/labels/binary/${id}/close`, { method: 'POST' }),

  getBinaryNext: (id: number): Promise<NextMessage> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryNext)
             : req(`/api/labels/binary/${id}/next`),

  decideBinary: (id: number, body: DecideRequestBody): Promise<NextMessage> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryNextAfterDecide)
             : req(`/api/labels/binary/${id}/decide`, { method: 'POST', ...json(body) }),

  undoBinary: (id: number): Promise<{ ok: boolean; removed: { chatlog_id: number; message_index: number } | null }> =>
    USE_MOCK ? Promise.resolve({ ok: true, removed: null })
             : req(`/api/labels/binary/${id}/undo`, { method: 'POST' }),

  getBinaryReadiness: (id: number): Promise<ReadinessState> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryReadiness)
             : req(`/api/labels/binary/${id}/readiness`),

  binaryHandoff: (id: number): Promise<HandoffResult> =>
    USE_MOCK ? Promise.resolve({ predictions_written: 0, phase: 'handed_off' })
             : req(`/api/labels/binary/${id}/handoff`, { method: 'POST' }),

  getBinaryReviewQueue: (id: number, threshold = 0.75): Promise<{ items: ReviewQueueItem[]; total: number }> =>
    USE_MOCK ? Promise.resolve({ items: [], total: 0 })
             : req(`/api/labels/binary/${id}/review-queue?threshold=${threshold}`),

  reviewBinary: (id: number, body: { chatlog_id: number; message_index: number; value: 'yes' | 'no' }): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/labels/binary/${id}/review`, { method: 'POST', ...json(body) }),
}
