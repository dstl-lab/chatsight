import { useState, useMemo } from 'react';
import type { ChatlogSummary } from '../types';

interface Props {
  chatlogs: ChatlogSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

type GroupBy = 'notebook' | 'student';

function groupKey(c: ChatlogSummary, by: GroupBy): string {
  if (by === 'notebook') return c.notebook ?? 'Unknown notebook';
  return c.user_email ?? 'Unknown student';
}

function itemLabel(c: ChatlogSummary, by: GroupBy): string {
  if (by === 'notebook') return c.user_email ?? 'Unknown student';
  return c.notebook ?? 'Unknown notebook';
}

export default function ChatlogList({ chatlogs, selectedId, onSelect }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('notebook');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return chatlogs;
    return chatlogs.filter(
      (c) =>
        (c.notebook ?? '').toLowerCase().includes(q) ||
        (c.user_email ?? '').toLowerCase().includes(q)
    );
  }, [chatlogs, search]);

  const groups = useMemo(() => {
    const map = new Map<string, ChatlogSummary[]>();
    for (const c of filtered) {
      const key = groupKey(c, groupBy);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, groupBy]);

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  if (chatlogs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-gray-400 text-sm text-center">
        No chatlogs found.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="px-3 py-2 border-b border-gray-100 space-y-2">
        <input
          type="text"
          placeholder="Search notebooks or students…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex gap-1">
          <button
            onClick={() => setGroupBy('notebook')}
            className={`flex-1 text-xs py-1 rounded transition-colors ${
              groupBy === 'notebook'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            By notebook
          </button>
          <button
            onClick={() => setGroupBy('student')}
            className={`flex-1 text-xs py-1 rounded transition-colors ${
              groupBy === 'student'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            By student
          </button>
        </div>
      </div>

      {/* Grouped list */}
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-6">No results.</p>
        ) : (
          groups.map(([key, items]) => {
            const isCollapsed = collapsed[key] ?? (groupBy === 'notebook');
            return (
              <div key={key}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 transition-colors"
                >
                  <span className="text-xs font-semibold text-gray-600 truncate text-left">
                    {key}
                  </span>
                  <span className="text-xs text-gray-400 ml-2 shrink-0">
                    {items.length} {isCollapsed ? '▶' : '▼'}
                  </span>
                </button>

                {/* Conversations */}
                {!isCollapsed &&
                  items.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onSelect(c.id)}
                      className={`w-full text-left pl-5 pr-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                        selectedId === c.id
                          ? 'bg-blue-50 border-l-2 border-l-blue-500'
                          : ''
                      }`}
                    >
                      <p
                        className={`text-xs font-medium truncate ${
                          selectedId === c.id ? 'text-blue-700' : 'text-gray-700'
                        }`}
                      >
                        {itemLabel(c, groupBy)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(c.created_at).toLocaleDateString()}
                      </p>
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
