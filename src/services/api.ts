import type { ChatlogSummary, ChatlogDetail, LabelSet } from '../types';

const BASE = '/api';

export async function listChatlogs(): Promise<ChatlogSummary[]> {
  const res = await fetch(`${BASE}/chatlogs`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getChatlog(id: number): Promise<ChatlogDetail> {
  const res = await fetch(`${BASE}/chatlogs/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateLabels(chatlogId: number, steeringNotes: string): Promise<{ label_set_id: number; labels: LabelSet['labels'] }> {
  const res = await fetch(`${BASE}/label`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatlog_id: chatlogId, steering_notes: steeringNotes }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getLabelSets(chatlogId: number): Promise<LabelSet[]> {
  const res = await fetch(`${BASE}/chatlogs/${chatlogId}/label-sets`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
