/** DB title for a label created on first /run visit before the instructor names it. */
export const PLACEHOLDER_LABEL_NAME = 'Label name…'

export function isPlaceholderLabelName(name: string): boolean {
  return name === PLACEHOLDER_LABEL_NAME
}

/** Human-readable title everywhere except the /run name field. */
export function displayLabelName(name: string): string {
  return isPlaceholderLabelName(name) ? 'Untitled label' : name
}
