export interface ChatlogSummary {
  id: number;
  filename: string;
  notebook: string | null;
  user_email: string | null;
  created_at: string;
}

export interface LabelItem {
  id: number;
  label_set_id: number;
  message_index: number;
  label: string;
  evidence: string;
  rationale: string;
  granularity: 'high' | 'mid' | 'low';
}

export interface LabelSet {
  id: number;
  chatlog_id: number;
  steering_notes: string;
  created_at: string;
  labels: LabelItem[];
}

export interface ChatlogDetail {
  id: number;
  filename: string;
  content: string;
  created_at: string;
  latest_label_set: LabelSet | null;
}
