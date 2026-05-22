const BROWSE_KEY = 'chatsight_starter_browse'

export type StarterBrowsePosition = {
  chatlog_id: number
  message_index: number
  exhausted_chatlog_ids?: number[]
}

function resetBrowseOnReload(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (nav?.type === 'reload') {
      sessionStorage.removeItem(BROWSE_KEY)
    }
  } catch {
    /* ignore */
  }
}

resetBrowseOnReload()

export function getStarterBrowse(): StarterBrowsePosition | null {
  try {
    const raw = sessionStorage.getItem(BROWSE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StarterBrowsePosition
    if (
      typeof parsed.chatlog_id === 'number' &&
      typeof parsed.message_index === 'number'
    ) {
      const exhausted = Array.isArray(parsed.exhausted_chatlog_ids)
        ? parsed.exhausted_chatlog_ids.filter((id) => typeof id === 'number')
        : []
      return { ...parsed, exhausted_chatlog_ids: exhausted }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function setStarterBrowse(pos: StarterBrowsePosition): void {
  try {
    sessionStorage.setItem(BROWSE_KEY, JSON.stringify(pos))
  } catch {
    /* ignore */
  }
}

export function clearStarterBrowse(): void {
  try {
    sessionStorage.removeItem(BROWSE_KEY)
  } catch {
    /* ignore */
  }
}
