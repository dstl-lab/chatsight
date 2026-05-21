// src/mocks/index.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse, HistoryItem, AnalysisSummary,
  TemporalAnalysis, RecalibrationItem, RecalibrationStats, SingleLabel,
  SingleLabelCohortResponse, SingleLabelRunDetail,
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
    {
      id: 1, name: "Concept Question",
      description: "Student asks for an explanation of a new concept",
      created_at: "2026-03-28T00:00:00", count: 5,
      paired_label_id: 101,
      paired_summary: {
        label_id: 101, name: "Concept Question", phase: "handed_off",
        yes_count: 87, no_count: 31, skip_count: 4,
      },
    },
    { id: 2, name: "Clarification", description: null, created_at: "2026-03-28T00:00:00", count: 3 },
    { id: 3, name: "Debug Help", description: "Student needs help fixing an error", created_at: "2026-03-28T00:00:00", count: 2 },
  ] satisfies LabelDefinition[],

  singleLabel: {
    id: 101, name: "Concept Question",
    description: "Student asks for an explanation of a new concept",
    mode: "single", phase: "queued", is_active: false, queue_position: 0,
    yes_count: 5, no_count: 0, skip_count: 0,
    conversations_walked: 1, total_conversations: 12,
    hybrid_explore_fraction: null,
    hybrid_explore_effective: 0.35,
  } satisfies SingleLabel,

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
    paired_label_counts: {
      'Concept Question': { paired_id: 101, phase: 'handed_off', yes: 87, no: 31, skip: 4 },
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
    labeling_throughput: {
      data: [
        { date: '2026-03-20', human: 5, ai: 0, total: 5 },
        { date: '2026-03-21', human: 12, ai: 0, total: 12 },
        { date: '2026-03-22', human: 8, ai: 15, total: 23 },
        { date: '2026-03-23', human: 3, ai: 42, total: 45 },
      ],
    },
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

  singleLabelCohort: {
    runs: [
      {
        run_id: 1,
        label_name: 'help-seeking',
        description: 'asking the tutor for an explanation, not just an answer',
        phase: 'reviewing',
        yes_count: 149,
        no_count: 91,
        yes_pct: 62,
        disagreement_pct: 8,
        overlap_count: 150,
        updated_at: '2026-05-08T14:30:00Z',
        weekly_sparkline: [65, 58, 71, 68, 62, 55, 60, 63],
      },
      {
        run_id: 2,
        label_name: 'confusion',
        description: 'student signals they are stuck or lost',
        phase: 'labeling',
        yes_count: 61,
        no_count: 119,
        yes_pct: 34,
        disagreement_pct: 21,
        overlap_count: 120,
        updated_at: '2026-05-09T09:12:00Z',
        weekly_sparkline: [22, 28, 35, 32, 38, 42, 40, 34],
      },
      {
        run_id: 3,
        label_name: 'off-topic',
        description: 'chat unrelated to the course',
        phase: 'complete',
        yes_count: 40,
        no_count: 180,
        yes_pct: 18,
        disagreement_pct: 4,
        overlap_count: 220,
        updated_at: '2026-04-22T17:55:00Z',
        weekly_sparkline: [15, 18, 19, 17, 16, 18, 20, 18],
      },
    ],
  } satisfies SingleLabelCohortResponse,

  singleLabelRunDetail: {
    run: {
      id: 1,
      label_name: 'help-seeking',
      description: 'asking the tutor for an explanation, not just an answer',
      phase: 'reviewing',
      updated_at: '2026-05-08T14:30:00Z',
      yes_count: 149,
      no_count: 91,
      yes_pct: 62,
      conv_yes_pct: 38,
    },
    confidence_histogram: {
      bins: [
        { lo: 0.0, hi: 0.1, count: 32, yes: 8,  no: 24 },
        { lo: 0.1, hi: 0.2, count: 28, yes: 5,  no: 23 },
        { lo: 0.2, hi: 0.3, count: 21, yes: 4,  no: 17 },
        { lo: 0.3, hi: 0.4, count: 12, yes: 3,  no: 9  },
        { lo: 0.4, hi: 0.5, count: 8,  yes: 4,  no: 4  },
        { lo: 0.5, hi: 0.6, count: 9,  yes: 5,  no: 4  },
        { lo: 0.6, hi: 0.7, count: 14, yes: 10, no: 4  },
        { lo: 0.7, hi: 0.8, count: 22, yes: 18, no: 4  },
        { lo: 0.8, hi: 0.9, count: 35, yes: 32, no: 3  },
        { lo: 0.9, hi: 1.0, count: 41, yes: 40, no: 1  },
      ],
      coverage: { with_confidence: 222, total_ai: 222 },
    },
    ai_coverage: {
      covered: 222,
      total: 2180,
      pct: 10,
    },
    agreement_by_confidence: {
      buckets: [
        { lo: 0.0, hi: 0.2, overlap_count: 32, agree: 29, agreement_rate: 91 },
        { lo: 0.2, hi: 0.4, overlap_count: 25, agree: 19, agreement_rate: 76 },
        { lo: 0.4, hi: 0.6, overlap_count: 18, agree: 10, agreement_rate: 55 },
        { lo: 0.6, hi: 0.8, overlap_count: 30, agree: 26, agreement_rate: 87 },
        { lo: 0.8, hi: 1.0, overlap_count: 45, agree: 43, agreement_rate: 96 },
      ],
    },
    disagreement: {
      overlap_count: 150,
      agree: 138,
      disagree: 12,
      rate: 8,
      breakdown: { ai_yes_human_no: 5, ai_no_human_yes: 7 },
    },
    by_assignment: [
      { key: 'Lab 1 — Probability',     yes: 33, no: 9,  yes_pct: 78 },
      { key: 'Lab 2 — DataFrames',      yes: 27, no: 11, yes_pct: 71 },
      { key: 'Final Project',           yes: 18, no: 10, yes_pct: 64 },
      { key: 'Lab 5 — Hypothesis',      yes: 18, no: 13, yes_pct: 58 },
      { key: 'Midterm',                 yes: 13, no: 11, yes_pct: 52 },
      { key: 'Lab 3 — Visualization',   yes: 13, no: 14, yes_pct: 49 },
      { key: 'Lab 4 — Regression',      yes: 9,  no: 13, yes_pct: 41 },
      { key: 'Concept Check',           yes: 6,  no: 22, yes_pct: 23 },
    ],
    by_position: [
      { bucket: 'early', yes: 77, no: 31, yes_pct: 71 },
      { bucket: 'mid',   yes: 59, no: 33, yes_pct: 64 },
      { bucket: 'late',  yes: 19, no: 21, yes_pct: 48 },
    ],
    by_hour_of_day: [
      { hour: 0,  yes: 1,  no: 1,  yes_pct: 50 },
      { hour: 1,  yes: 0,  no: 0,  yes_pct: 0 },
      { hour: 2,  yes: 0,  no: 0,  yes_pct: 0 },
      { hour: 3,  yes: 0,  no: 0,  yes_pct: 0 },
      { hour: 4,  yes: 0,  no: 0,  yes_pct: 0 },
      { hour: 5,  yes: 0,  no: 0,  yes_pct: 0 },
      { hour: 6,  yes: 0,  no: 0,  yes_pct: 0 },
      { hour: 7,  yes: 1,  no: 1,  yes_pct: 50 },
      { hour: 8,  yes: 3,  no: 4,  yes_pct: 43 },
      { hour: 9,  yes: 5,  no: 5,  yes_pct: 50 },
      { hour: 10, yes: 8,  no: 4,  yes_pct: 67 },
      { hour: 11, yes: 9,  no: 5,  yes_pct: 64 },
      { hour: 12, yes: 6,  no: 3,  yes_pct: 67 },
      { hour: 13, yes: 7,  no: 4,  yes_pct: 64 },
      { hour: 14, yes: 11, no: 5,  yes_pct: 69 },
      { hour: 15, yes: 12, no: 6,  yes_pct: 67 },
      { hour: 16, yes: 14, no: 7,  yes_pct: 67 },
      { hour: 17, yes: 13, no: 5,  yes_pct: 72 },
      { hour: 18, yes: 11, no: 4,  yes_pct: 73 },
      { hour: 19, yes: 16, no: 5,  yes_pct: 76 },
      { hour: 20, yes: 18, no: 6,  yes_pct: 75 },
      { hour: 21, yes: 14, no: 7,  yes_pct: 67 },
      { hour: 22, yes: 9,  no: 5,  yes_pct: 64 },
      { hour: 23, yes: 4,  no: 4,  yes_pct: 50 },
    ],
    by_conversation_depth: [
      { bucket: 'short', yes: 31, no: 35, yes_pct: 47 },
      { bucket: 'mid',   yes: 68, no: 39, yes_pct: 64 },
      { bucket: 'long',  yes: 50, no: 17, yes_pct: 75 },
    ],
    examples: {
      yes: [
        { message_id: 101, chatlog_id: 11, message_index: 4, text: "I'm not sure what bool_array does — can you explain again?",          ai_pred: 'yes', ai_confidence: 0.91, human_decision: 'yes', assignment: 'Lab 2',   position_bucket: 'mid',   created_at: '2026-04-10T12:00:00Z', flag: null },
        { message_id: 102, chatlog_id: 12, message_index: 5, text: 'Why does .groupby() return a different result for sum vs mean here?', ai_pred: 'yes', ai_confidence: 0.84, human_decision: 'yes', assignment: 'Lab 5',   position_bucket: 'mid',   created_at: '2026-04-12T15:30:00Z', flag: null },
        { message_id: 103, chatlog_id: 13, message_index: 1, text: 'I keep getting a KeyError on this DataFrame — what am I doing wrong?',ai_pred: 'yes', ai_confidence: 0.78, human_decision: 'yes', assignment: 'Lab 2',   position_bucket: 'early', created_at: '2026-04-13T09:00:00Z', flag: null },
      ],
      no: [
        { message_id: 201, chatlog_id: 21, message_index: 9, text: 'Thanks, that worked!',                                                ai_pred: 'no',  ai_confidence: 0.02, human_decision: 'no',  assignment: 'Final',   position_bucket: 'late',  created_at: '2026-04-15T11:00:00Z', flag: null },
        { message_id: 202, chatlog_id: 22, message_index: 0, text: 'Make this plot blue.',                                                ai_pred: 'no',  ai_confidence: 0.08, human_decision: 'no',  assignment: 'Lab 3',   position_bucket: 'early', created_at: '2026-04-16T13:00:00Z', flag: null },
        { message_id: 203, chatlog_id: 23, message_index: 2, text: 'Can you write the code for me?',                                      ai_pred: 'no',  ai_confidence: 0.12, human_decision: 'no',  assignment: 'Concept', position_bucket: 'early', created_at: '2026-04-17T14:00:00Z', flag: null },
      ],
      edge: [
        { message_id: 301, chatlog_id: 31, message_index: 4, text: "What does it mean when something is 'closed under' an operation?",    ai_pred: 'no',  ai_confidence: 0.51, human_decision: 'yes', assignment: 'Lab 1',   position_bucket: 'mid',   created_at: '2026-04-18T10:00:00Z', flag: 'low_confidence' },
        { message_id: 302, chatlog_id: 32, message_index: 1, text: 'Should I use .loc or .iloc here?',                                    ai_pred: 'no',  ai_confidence: 0.42, human_decision: 'yes', assignment: 'Lab 2',   position_bucket: 'early', created_at: '2026-04-19T11:00:00Z', flag: 'human_overruled' },
      ],
    },
  } satisfies SingleLabelRunDetail,
}
