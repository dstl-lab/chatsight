// src/services/api.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse,
  QueueStats, ApplyLabelRequest, CreateLabelRequest, UpdateLabelRequest,
  HistoryItem, OrphanedMessagesResponse, ArchiveResponse, LabelReviewItem,
  ConceptCandidate, EmbedStatus, ConversationMessage, AnalysisSummary, TemporalAnalysis,
  LabelExample, SplitAutoLabelRequest, ApplyBatchRequest, ConciseResponse,
  RecalibrationItem, RecalibrationStats, SaveRecalibrationRequest, SaveRecalibrationResponse,
  SingleLabel, FocusedMessage, ReadinessState, DecisionValue,
  SingleLabelSummary, HandoffResponse, ReviewItem,
  AssignmentMapping, UnmappedCount, InferAssignmentsResult, HandoffSummaryItem,
} from '../types'
import { mockApi } from '../mocks'
import {
  mockActiveLabel, mockQueuedLabels, mockFocusedMessage, mockReadiness,
} from '../mocks/runMock'

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

  // ─── Single-label binary flow ───
  listSingleLabels: (params?: { phase?: string }): Promise<SingleLabel[]> =>
    USE_MOCK
      ? Promise.resolve(
          params?.phase === 'queued' ? mockQueuedLabels : [mockActiveLabel, ...mockQueuedLabels]
        )
      : req(`/api/single-labels${params?.phase ? `?phase=${params.phase}` : ''}`),

  getActiveSingleLabel: (): Promise<SingleLabel | null> =>
    USE_MOCK ? Promise.resolve(mockActiveLabel) : req('/api/single-labels/active'),

  createSingleLabel: (body: { name: string; description?: string }): Promise<SingleLabel> =>
    USE_MOCK
      ? Promise.resolve({ ...mockActiveLabel, id: Math.random(), name: body.name, description: body.description ?? null })
      : req('/api/single-labels', { method: 'POST', ...json(body) }),

  queueSingleLabel: (body: { name: string; description?: string }): Promise<SingleLabel> =>
    USE_MOCK
      ? Promise.resolve({
          ...mockActiveLabel,
          id: Math.random(),
          name: body.name,
          description: body.description ?? null,
          phase: 'queued',
          is_active: false,
          queue_position: mockQueuedLabels.length,
        })
      : req('/api/single-labels/queue', { method: 'POST', ...json(body) }),

  activateSingleLabel: (id: number): Promise<SingleLabel> =>
    USE_MOCK ? Promise.resolve({ ...mockActiveLabel, is_active: true })
             : req(`/api/single-labels/${id}/activate`, { method: 'POST' }),

  closeSingleLabel: (id: number): Promise<SingleLabel> =>
    USE_MOCK ? Promise.resolve({ ...mockActiveLabel, is_active: false, phase: 'complete' })
             : req(`/api/single-labels/${id}/close`, { method: 'POST' }),

  getNextFocused: (id: number, assignmentId?: number): Promise<FocusedMessage | null> =>
    USE_MOCK
      ? Promise.resolve(mockFocusedMessage)
      : req(`/api/single-labels/${id}/next${assignmentId ? `?assignment_id=${assignmentId}` : ''}`),

  decide: (
    id: number,
    body: { chatlog_id: number; message_index: number; value: DecisionValue }
  ): Promise<FocusedMessage | null> =>
    USE_MOCK ? Promise.resolve(mockFocusedMessage)
             : req(`/api/single-labels/${id}/decide`, { method: 'POST', ...json(body) }),

  undoLastDecision: (id: number): Promise<FocusedMessage | null> =>
    USE_MOCK ? Promise.resolve(mockFocusedMessage)
             : req(`/api/single-labels/${id}/undo`, { method: 'POST' }),

  skipConversation: (id: number, chatlogId: number): Promise<FocusedMessage | null> =>
    USE_MOCK
      ? Promise.resolve(mockFocusedMessage)
      : req(`/api/single-labels/${id}/skip-conversation`, {
          method: 'POST',
          ...json({ chatlog_id: chatlogId }),
        }),

  getReadiness: (id: number): Promise<ReadinessState> =>
    USE_MOCK ? Promise.resolve(mockReadiness)
             : req(`/api/single-labels/${id}/readiness`),

  deleteSingleLabel: (id: number): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/single-labels/${id}`, { method: 'DELETE' }),

  handoffSingleLabel: (id: number): Promise<HandoffResponse> =>
    USE_MOCK
      ? Promise.resolve({
          label_id: id, classified: 142, yes_count: 98, no_count: 44, review_count: 23,
        })
      : req(`/api/single-labels/${id}/handoff`, { method: 'POST' }),

  getSingleLabelSummary: (id: number): Promise<SingleLabelSummary> =>
    USE_MOCK
      ? Promise.resolve({
          label_id: id,
          label_name: 'Help',
          yes_count: 98,
          no_count: 44,
          review_threshold: 0.75,
          review_count: 23,
          included: [
            { excerpt: "i'm stuck", frequency: 'common', confidence_avg: 0.92 },
            { excerpt: 'getting an error', frequency: 'common', confidence_avg: 0.88 },
            { excerpt: 'can you help me', frequency: 'moderate', confidence_avg: 0.81 },
            { excerpt: 'tracebacks & KeyError', frequency: 'moderate', confidence_avg: 0.76 },
          ],
          excluded: [
            { excerpt: 'why does X work?', frequency: 'common', confidence_avg: 0.84 },
            { excerpt: 'conceptual "what is" questions', frequency: 'moderate', confidence_avg: 0.73 },
            { excerpt: 'course logistics', frequency: 'rare', confidence_avg: 0.69 },
            { excerpt: 'exploratory follow-ups', frequency: 'rare', confidence_avg: 0.61 },
          ],
        })
      : req(`/api/single-labels/${id}/summary`),

  refineSingleLabel: (id: number): Promise<SingleLabel> =>
    USE_MOCK ? Promise.resolve(mockActiveLabel)
             : req(`/api/single-labels/${id}/refine`, { method: 'POST' }),

  getReviewQueue: (_id: number): Promise<ReviewItem[]> =>
    USE_MOCK
      ? Promise.resolve([
          {
            chatlog_id: 2200,
            message_index: 4,
            text: "Why does `bins=10` give a different shape than `bins=20`? They're both reasonable, right?",
            notebook: 'lab3.ipynb',
            ai_value: 'no',
            ai_confidence: 0.62,
          },
          {
            chatlog_id: 2218,
            message_index: 3,
            text: "I'm getting this weird `KeyError: 'col'` when I try `df['col']`. The column is definitely there.",
            notebook: 'lab3.ipynb',
            ai_value: 'yes',
            ai_confidence: 0.68,
          },
          {
            chatlog_id: 2231,
            message_index: 7,
            text: "When the textbook says 'mean', do they always mean arithmetic mean, or sometimes median?",
            notebook: 'lab4.ipynb',
            ai_value: 'no',
            ai_confidence: 0.71,
          },
        ])
      : req(`/api/single-labels/${_id}/review-queue`),

  reviewItem: (
    id: number,
    body: { chatlog_id: number; message_index: number; value: 'yes' | 'no' }
  ): Promise<ReviewItem> =>
    USE_MOCK ? Promise.resolve({} as ReviewItem)
             : req(`/api/single-labels/${id}/review`, { method: 'POST', ...json(body) }),

  // ─── Assignment mappings ───
  listAssignments: (): Promise<AssignmentMapping[]> =>
    USE_MOCK
      ? Promise.resolve([
          { id: 1, pattern: '^lab0?3', name: 'Lab 3 · Histograms', description: null, message_count: 68 },
          { id: 2, pattern: '^lab0?4', name: 'Lab 4 · Hypothesis testing', description: null, message_count: 54 },
          { id: 3, pattern: '^proj(ect)?_?1', name: 'Project 1', description: null, message_count: 91 },
        ])
      : req('/api/assignments'),

  getUnmappedCount: (): Promise<UnmappedCount> =>
    USE_MOCK ? Promise.resolve({ unmapped_count: 199, total_count: 412 })
             : req('/api/assignments/unmapped'),

  createAssignment: (
    body: { pattern: string; name: string; description?: string }
  ): Promise<AssignmentMapping> =>
    USE_MOCK
      ? Promise.resolve({
          id: Date.now(),
          pattern: body.pattern,
          name: body.name,
          description: body.description ?? null,
          message_count: 0,
        })
      : req('/api/assignments', { method: 'POST', ...json(body) }),

  deleteAssignment: (id: number): Promise<{ ok: boolean; cleared: number }> =>
    USE_MOCK ? Promise.resolve({ ok: true, cleared: 0 })
             : req(`/api/assignments/${id}`, { method: 'DELETE' }),

  inferAssignments: (): Promise<InferAssignmentsResult> =>
    USE_MOCK
      ? Promise.resolve({ created: 0, total_notebooks: 0, groups: [] })
      : req('/api/assignments/infer', { method: 'POST' }),

  mergeAssignments: (body: {
    source_ids: number[]
    target_id: number
    new_name?: string
  }): Promise<{ merged: number; moved_messages: number; target_id: number }> =>
    USE_MOCK
      ? Promise.resolve({ merged: body.source_ids.length, moved_messages: 0, target_id: body.target_id })
      : req('/api/assignments/merge', { method: 'POST', ...json(body) }),

  // ─── Handoff summaries ───
  listHandoffSummaries: (): Promise<HandoffSummaryItem[]> =>
    USE_MOCK
      ? Promise.resolve([
          {
            label_id: 2,
            label_name: 'frustration',
            description: null,
            phase: 'classifying',
            yes_count: 0,
            no_count: 0,
            review_count: 0,
            review_threshold: 0.75,
            included: [],
            excluded: [],
            classified_count: 87,
            classification_total: 142,
            error: null,
            error_kind: null,
          },
          {
            label_id: 1,
            label_name: 'Help',
            description: 'Student is asking for assistance, expressing being stuck, or reporting an error.',
            phase: 'reviewing',
            yes_count: 98,
            no_count: 44,
            review_count: 23,
            review_threshold: 0.75,
            included: [
              { excerpt: "i'm stuck", frequency: 'common', confidence_avg: 0.92 },
              { excerpt: 'getting an error', frequency: 'common', confidence_avg: 0.88 },
              { excerpt: 'can you help me', frequency: 'moderate', confidence_avg: 0.81 },
              { excerpt: 'tracebacks & KeyError', frequency: 'moderate', confidence_avg: 0.76 },
            ],
            excluded: [
              { excerpt: 'why does X work?', frequency: 'common', confidence_avg: 0.84 },
              { excerpt: 'conceptual "what is" questions', frequency: 'moderate', confidence_avg: 0.73 },
              { excerpt: 'course logistics', frequency: 'rare', confidence_avg: 0.69 },
            ],
            classified_count: 142,
            classification_total: 142,
            error: null,
            error_kind: null,
          },
        ])
      : req('/api/handoff-summaries'),
}
