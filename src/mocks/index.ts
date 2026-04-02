// src/mocks/index.ts
import type { LabelDefinition, QueueItem, LabelingSession, SuggestResponse, HistoryItem } from '../types'

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

  history: [
    {
      chatlog_id: 1, message_index: 0,
      message_text: "Can you explain what a DataFrame is and how it's different from a regular Python list?",
      labels: ["Concept Question"],
      labeled_at: "2026-03-28T10:05:00",
    },
    {
      chatlog_id: 1, message_index: 2,
      message_text: "How do I filter rows where the grade column is above 90?",
      labels: ["Concept Question", "Debug Help"],
      labeled_at: "2026-03-28T10:10:00",
    },
  ] satisfies HistoryItem[],
}
