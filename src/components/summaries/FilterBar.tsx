import type { BrowseBucket, BrowseSort } from '../../types'

interface FilterBarProps {
  bucket: BrowseBucket
  sort: BrowseSort
  search: string
  onChange: (patch: Partial<{ bucket: BrowseBucket; sort: BrowseSort; search: string }>) => void
}

const CHIPS: { id: BrowseBucket; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'yes', label: 'YES' },
  { id: 'no', label: 'NO' },
  { id: 'review', label: 'Review' },
]

export function FilterBar({ bucket, sort, search, onChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-b border-edge-subtle">
      {CHIPS.map((c) => {
        const active = bucket === c.id
        return (
          <button
            key={c.id}
            data-testid={`chip-${c.id}`}
            data-active={String(active)}
            onClick={() => onChange({ bucket: c.id })}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[10px] cursor-pointer ${
              active ? 'bg-elevated border-ochre-dim text-paper' : 'border-edge text-on-surface hover:text-paper'
            }`}
          >
            {c.label}
          </button>
        )
      })}
      <button className="inline-flex items-center px-2.5 py-1 rounded-full border border-edge border-dashed font-mono text-[10px] text-muted hover:text-paper">
        + more
      </button>
      <input
        type="text"
        placeholder="search messages…"
        value={search}
        onChange={(e) => onChange({ search: e.target.value })}
        className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-paper font-serif italic text-[13px] px-1.5"
      />
      <select
        value={sort}
        onChange={(e) => onChange({ sort: e.target.value as BrowseSort })}
        className="font-mono text-[10px] text-muted bg-canvas border border-edge rounded-sm px-1.5 py-1"
      >
        <option value="confidence_asc">conf ↑</option>
        <option value="confidence_desc">conf ↓</option>
        <option value="recently_flipped">recent flips</option>
      </select>
    </div>
  )
}
