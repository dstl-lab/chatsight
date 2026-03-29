import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { LabelItem } from '../types';

interface Props {
  labels: LabelItem[];
  onSelectMessage: (index: number) => void;
}

export default function BehaviorTimeline({ labels, onSelectMessage }: Props) {
  const data = labels.map((l) => ({
    name: `#${l.message_index + 1}`,
    value: 1,
    label: l.label,
    message_index: l.message_index,
  }));

  return (
    <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Behavior Timeline</h3>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis hide />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload?.[0]) {
                const d = payload[0].payload;
                return (
                  <div className="bg-white border border-gray-200 rounded px-2 py-1 shadow text-xs">
                    <strong>{d.label}</strong>
                    <div className="text-gray-500">Turn {d.name}</div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="value" onClick={(data) => onSelectMessage(data.message_index)} cursor="pointer" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
