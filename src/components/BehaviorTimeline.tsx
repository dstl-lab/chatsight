import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import type { LabelItem } from '../types';

interface Props {
  labels: LabelItem[];
  onSelectMessage: (index: number) => void;
}

const GRANULARITY_VALUE = { high: 3, mid: 2, low: 1 };
const GRANULARITY_COLOR = { high: '#8b5cf6', mid: '#3b82f6', low: '#6b7280' };

export default function BehaviorTimeline({ labels, onSelectMessage }: Props) {
  const data = labels.map((l) => ({
    name: `#${l.message_index + 1}`,
    value: GRANULARITY_VALUE[l.granularity as keyof typeof GRANULARITY_VALUE] ?? 2,
    label: l.label,
    granularity: l.granularity,
    message_index: l.message_index,
  }));

  return (
    <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Behavior Timeline</h3>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 3]} ticks={[1, 2, 3]} tick={{ fontSize: 10 }} />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload?.[0]) {
                const d = payload[0].payload;
                return (
                  <div className="bg-white border border-gray-200 rounded px-2 py-1 shadow text-xs">
                    <strong>{d.label}</strong>
                    <div className="text-gray-500">{d.granularity} • Turn {d.name}</div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="value" onClick={(data) => onSelectMessage(data.message_index)} cursor="pointer">
            {data.map((entry, index) => (
              <Cell key={index} fill={GRANULARITY_COLOR[entry.granularity as keyof typeof GRANULARITY_COLOR] ?? '#6b7280'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-1">
        {Object.entries(GRANULARITY_COLOR).map(([g, color]) => (
          <div key={g} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-500 capitalize">{g}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
