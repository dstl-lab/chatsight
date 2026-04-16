// src/services/api.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse,
  QueueStats, ApplyLabelRequest, CreateLabelRequest, UpdateLabelRequest,
  LabelExample, SplitAutoLabelRequest, ApplyBatchRequest, ConciseResponse
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
}
