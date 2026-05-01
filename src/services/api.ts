// src/services/api.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse,
  QueueStats, ApplyLabelRequest, CreateLabelRequest, UpdateLabelRequest,
  HistoryItem, OrphanedMessagesResponse, ArchiveResponse, LabelReviewItem,
  ConceptCandidate, EmbedStatus, ConversationMessage, AnalysisSummary, TemporalAnalysis,
  LabelExample, SplitAutoLabelRequest, ApplyBatchRequest, ConciseResponse,
  RecalibrationItem, RecalibrationStats, SaveRecalibrationRequest, SaveRecalibrationResponse,
  ConceptCandidateKind, RipeSignal, DiscoveryRun,
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

  // Concept Discovery — RAG-style mode-aware API
  discoverConcepts: (
    query_kind: ConceptCandidateKind = 'broad_label',
    trigger: 'manual' | 'badge' = 'manual',
  ): Promise<{ run_id: number | string; status: string }> =>
    USE_MOCK ? Promise.resolve({ run_id: 'starting', status: 'running' })
             : req('/api/concepts/discover', {
                 method: 'POST', ...json({ query_kind, trigger }),
               }),

  getCandidates: (
    filters: { run_id?: number; kind?: ConceptCandidateKind; decision?: string } = {},
  ): Promise<ConceptCandidate[]> => {
    if (USE_MOCK) return Promise.resolve([])
    const p = new URLSearchParams()
    if (filters.run_id != null) p.set('run_id', String(filters.run_id))
    if (filters.kind) p.set('kind', filters.kind)
    if (filters.decision) p.set('decision', filters.decision)
    const qs = p.toString() ? `?${p.toString()}` : ''
    return req(`/api/concepts/candidates${qs}`)
  },

  resolveCandidate: (id: number, action: 'accept' | 'reject', name?: string): Promise<LabelDefinition | { ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/concepts/candidates/${id}`, { method: 'PUT', ...json({ action, name }) }),

  getEmbedStatus: (): Promise<EmbedStatus> =>
    USE_MOCK ? Promise.resolve({ cached: 0, total_unlabeled: 0, running: false })
             : req('/api/concepts/embed-status'),

  getConceptRipe: (): Promise<RipeSignal> =>
    USE_MOCK ? Promise.resolve({ ripe: false, pool_size: 0, drift_value: 0, reasons: ['pool_below_threshold'] })
             : req('/api/concepts/ripe'),

  acceptConceptCandidate: (
    id: number,
  ): Promise<{ candidate_id: number; created_label_id: number; applied_count: number }> =>
    USE_MOCK ? Promise.resolve({ candidate_id: id, created_label_id: 0, applied_count: 0 })
             : req(`/api/concepts/candidates/${id}/accept`, {
                 method: 'POST', ...json({}),
               }),

  dismissConceptCandidate: (id: number, reason?: string): Promise<{ ok: true }> =>
    USE_MOCK ? Promise.resolve({ ok: true as const })
             : req(`/api/concepts/candidates/${id}/dismiss`, {
                 method: 'POST', ...json({ reason }),
               }),

  noteConceptCandidate: (id: number): Promise<{ ok: true }> =>
    USE_MOCK ? Promise.resolve({ ok: true as const })
             : req(`/api/concepts/candidates/${id}/note`, {
                 method: 'POST', ...json({}),
               }),

  makeLabelFromCandidate: (
    id: number,
  ): Promise<{ candidate_id: number; created_label_id: number }> =>
    USE_MOCK ? Promise.resolve({ candidate_id: id, created_label_id: 0 })
             : req(`/api/concepts/candidates/${id}/make-label`, {
                 method: 'POST', ...json({}),
               }),

  suggestMergeFromCandidate: (
    id: number, archive_label_id: number, keep_label_id: number,
  ): Promise<{ archived_label_id: number; kept_label_id: number; retagged_count: number }> =>
    USE_MOCK ? Promise.resolve({
                 archived_label_id: archive_label_id,
                 kept_label_id: keep_label_id,
                 retagged_count: 0,
               })
             : req(`/api/concepts/candidates/${id}/suggest-merge`, {
                 method: 'POST',
                 ...json({ archive_label_id, keep_label_id }),
               }),

  getDiscoveryRuns: (limit = 20): Promise<DiscoveryRun[]> =>
    USE_MOCK ? Promise.resolve([])
             : req(`/api/concepts/runs?limit=${limit}`),

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
}
