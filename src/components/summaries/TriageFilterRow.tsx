import type { BrowseBucket, BrowseSort } from '../../types'

export type TriageFilter = Extract<BrowseBucket, 'review' | 'flagged' | 'all'>

interface TriageFilterRowProps {
  filter: TriageFilter
  sort: BrowseSort
  reviewCount: number
  flaggedCount: number
  onFilterChange: (next: TriageFilter) => void
  onSortChange: (next: BrowseSort) => void
}

export function TriageFilterRow({
  filter,
  sort,
  reviewCount,
  flaggedCount,
  onFilterChange,
  onSortChange,
}: TriageFilterRowProps) {
  return (
    <div className="px-7 py-2.5 border-b border-edge-subtle flex items-center gap-2 bg-canvas">
      <Chip active={filter === 'review'} onClick={() => onFilterChange('review')}>
        Review ({reviewCount})
      </Chip>
      {flaggedCount > 0 && (
        <Chip active={filter === 'flagged'} onClick={() => onFilterChange('flagged')}>
          Flagged ({flaggedCount})
        </Chip>
      )}
      <Chip active={filter === 'all'} onClick={() => onFilterChange('all')}>
        All
      </Chip>
      <label className="ml-auto font-mono text-[10px] tracking-[0.12em] uppercase text-faint flex items-center gap-2">
        sort
        <select
          aria-label="sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as BrowseSort)}
          className="bg-canvas border border-edge rounded-sm px-2 py-1 text-on-canvas font-mono text-[11px]"
        >
          <option value="confidence_asc">↧ confidence asc</option>
          <option value="confidence_desc">↥ confidence desc</option>
          <option value="recently_flipped">↺ recently flipped</option>
        </select>
      </label>
    </div>
  )
}

interface ChipProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full border font-mono text-[10px] tracking-[0.12em] uppercase ${
        active
          ? 'border-ochre text-ochre bg-ochre-dim'
          : 'border-edge text-on-surface hover:text-paper'
      }`}
    >
      {children}
    </button>
  )
}
