// src/mocks/index.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse, HistoryItem, AnalysisSummary,
  TemporalAnalysis, RecalibrationItem, RecalibrationStats,
} from '../types'

export const mockApi = {
  queue: [
    {
      chatlog_id: 1,
      message_index: 0,
      message_text: "Can you explain what a DataFrame is and how it's different from a regular Python list?",
      context_before: "You can think of it like a spreadsheet with rows and columns...",
      context_after: "Great question! The key difference is that DataFrames are optimized for...",
    },
    {
      chatlog_id: 1,
      message_index: 2,
      message_text: "How do I filter rows where the grade column is above 90?",
      context_before: "You can use boolean indexing to filter DataFrames...",
      context_after: "Exactly. You can also use df.query('grade > 90') for the same result.",
    },
  ] satisfies QueueItem[],

  labels: [
    { id: 1, name: "Concept Question", description: "Student asks for an explanation of a new concept", created_at: "2026-03-28T00:00:00", count: 5 },
    { id: 2, name: "Clarification", description: null, created_at: "2026-03-28T00:00:00", count: 3 },
    { id: 3, name: "Debug Help", description: "Student needs help fixing an error", created_at: "2026-03-28T00:00:00", count: 2 },
  ] satisfies LabelDefinition[],

  session: {
    id: 1,
    started_at: "2026-03-28T10:00:00",
    last_active: "2026-03-28T10:30:00",
    labeled_count: 14,
  } satisfies LabelingSession,

  suggestion: {
    label_name: "Concept Question",
    evidence: "explain what a DataFrame is",
    rationale: "Student asks for a definition of a new concept, not debugging help.",
  } satisfies SuggestResponse,

  queuePosition: { position: 15, total_remaining: 85 },

  analysisSummary: {
    label_counts: {
      'Concept Question': 45,
      Clarification: 28,
      'Debug Help': 22,
      'Syntax / API': 12,
    },
    human_label_counts: {
      'Concept Question': 28,
      Clarification: 19,
      'Debug Help': 10,
      'Syntax / API': 4,
    },
    ai_label_counts: {
      'Concept Question': 17,
      Clarification: 9,
      'Debug Help': 12,
      'Syntax / API': 8,
    },
    notebook_breakdown: {
      lab01: { 'Concept Question': 12, Clarification: 8, 'Debug Help': 5 },
      lab02: { 'Concept Question': 18, Clarification: 11, 'Debug Help': 9, 'Syntax / API': 6 },
      homework03: { 'Concept Question': 15, Clarification: 9, 'Syntax / API': 6 },
    },
    coverage: {
      human_labeled: 52,
      ai_labeled: 38,
      unlabeled: 210,
      total: 300,
    },
    position_distribution: {
      'Concept Question': { early: 18, mid: 15, late: 12 },
      Clarification: { early: 10, mid: 12, late: 6 },
      'Debug Help': { early: 6, mid: 9, late: 7 },
      'Syntax / API': { early: 8, mid: 3, late: 1 },
    },
  } satisfies AnalysisSummary,

  temporalAnalysis: {
    tutor_usage: {
      by_hour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: hour >= 9 && hour <= 22 ? 12 + (hour % 5) : 2,
      })),
      by_weekday: [
        { weekday: 0, count: 45 },
        { weekday: 1, count: 120 },
        { weekday: 2, count: 110 },
        { weekday: 3, count: 95 },
        { weekday: 4, count: 88 },
        { weekday: 5, count: 40 },
        { weekday: 6, count: 30 },
      ],
      display_timezone: 'America/Los_Angeles',
      timezone_note: 'Mock data — connect to Postgres for real tutor_query timestamps.',
      error: null,
      by_day: Array.from({ length: 31 }, (_, i) => {
        const day = i + 1
        return {
          date: `2026-03-${String(day).padStart(2, '0')}`,
          count: day % 7 === 0 ? 42 + day : day % 3 === 0 ? 15 : 5,
        }
      }),
    },
    notebook_label_heatmap: {
      labels: ['Concept Question', 'Clarification', 'Debug Help'],
      notebooks: ['homework03', 'lab01', 'lab02'],
      raw_counts: [
        [10, 8, 4],
        [12, 6, 5],
        [18, 11, 9],
      ],
      row_normalized: [
        [0.45, 0.36, 0.18],
        [0.52, 0.26, 0.22],
        [0.47, 0.29, 0.24],
      ],
      column_normalized: [
        [0.25, 0.36, 0.39],
        [0.29, 0.27, 0.44],
        [0.45, 0.37, 0.18],
      ],
    },
    labeling_throughput: [
      { date: '2026-03-20', human: 5, ai: 0, total: 5 },
      { date: '2026-03-21', human: 12, ai: 0, total: 12 },
      { date: '2026-03-22', human: 8, ai: 15, total: 23 },
      { date: '2026-03-23', human: 3, ai: 42, total: 45 },
    ],
  } satisfies TemporalAnalysis,

  history: [
    {
      chatlog_id: 1, message_index: 0,
      message_text: "Can you explain what a DataFrame is and how it's different from a regular Python list?",
      context_before: "You can think of it like a spreadsheet with rows and columns...",
      context_after: "Great question! The key difference is that DataFrames are optimized for...",
      labels: ["Concept Question"],
      status: "labeled",
      applied_by: "human",
      confidence: null,
      processed_at: "2026-03-28T10:05:00",
    },
    {
      chatlog_id: 1, message_index: 2,
      message_text: "How do I filter rows where the grade column is above 90?",
      context_before: "You can use boolean indexing to filter DataFrames...",
      context_after: "Exactly. You can also use df.query('grade > 90') for the same result.",
      labels: ["Debug Help"],
      status: "labeled",
      applied_by: "ai",
      confidence: 0.72,
      processed_at: "2026-03-28T10:10:00",
    },
    {
      chatlog_id: 2, message_index: 0,
      message_text: "Thanks that makes sense now",
      context_before: null,
      context_after: null,
      labels: [],
      status: "skipped",
      applied_by: null,
      confidence: null,
      processed_at: "2026-03-28T10:12:00",
    },
  ] satisfies HistoryItem[],

  // Returns a recalibration item every 5th call to simulate adaptive interval
  _recalibrationCallCount: 0,
  recalibration(): RecalibrationItem | null {
    this._recalibrationCallCount++
    if (this._recalibrationCallCount % 5 !== 0) return null
    return {
      chatlog_id: 1,
      message_index: 0,
      message_text: "Can you explain what a DataFrame is and how it's different from a regular Python list?",
      context_before: "You can think of it like a spreadsheet with rows and columns...",
      context_after: "Great question! The key difference is that DataFrames are optimized for...",
      original_label_ids: [1, 3],
    }
  },
  // DEV: always returns a recalibration item. Remove with the force trigger.
  recalibrationForced(): RecalibrationItem {
    return {
      chatlog_id: 1,
      message_index: 0,
      message_text: "Can you explain what a DataFrame is and how it's different from a regular Python list?",
      context_before: "You can think of it like a spreadsheet with rows and columns...",
      context_after: "Great question! The key difference is that DataFrames are optimized for...",
      original_label_ids: [1, 3],
    }
  },

  recalibrationStats: {
    recent_results: [true, false, true, true, true, false, true, true],
    trend: 'improving' as const,
    current_interval: 15,
    total_recalibrations: 8,
  } satisfies RecalibrationStats,
}
