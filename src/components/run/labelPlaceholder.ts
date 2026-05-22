import type { SingleLabel } from '../../types'

/** DB title for a label created on first /run visit before the instructor names it. */
export const PLACEHOLDER_LABEL_NAME = 'Label name…'

export function isPlaceholderLabelName(name: string): boolean {
  return name === PLACEHOLDER_LABEL_NAME
}

/** Human-readable title everywhere except the /run name field. */
export function displayLabelName(name: string): string {
  return isPlaceholderLabelName(name) ? 'Untitled label' : name
}

/** Strip-bar label before the instructor commits a name (no DB row yet). */
export function buildDraftSingleLabel(draftName: string): SingleLabel {
  const trimmed = draftName.trim()
  return {
    id: 0,
    name: trimmed && !isPlaceholderLabelName(trimmed) ? trimmed : PLACEHOLDER_LABEL_NAME,
    description: null,
    guidance: null,
    mode: 'single',
    phase: 'labeling',
    is_active: false,
    queue_position: null,
    yes_count: 0,
    no_count: 0,
    skip_count: 0,
    conversations_walked: 0,
    total_conversations: 0,
    hybrid_explore_fraction: null,
    hybrid_explore_effective: 0.35,
  }
}
