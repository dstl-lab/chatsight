import type { LabelItem } from '../types';

interface Props {
  labels: LabelItem[];
  isProcessing: boolean;
  hasLabelSet: boolean;
  onGenerateLabels: () => void;
  highlightedIndex: number | null;
  onHighlight: (index: number | null) => void;
}

const GRANULARITY_COLORS = {
  high: 'bg-purple-100 text-purple-800 border border-purple-200',
  mid: 'bg-blue-100 text-blue-800 border border-blue-200',
  low: 'bg-gray-100 text-gray-700 border border-gray-200',
};

export default function LabelsPanel({ labels, isProcessing, hasLabelSet, onGenerateLabels, highlightedIndex, onHighlight }: Props) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Labels</h2>
          <p className="text-xs text-gray-400 mt-0.5">{labels.length} labels</p>
        </div>
        {!hasLabelSet && (
          <button
            onClick={onGenerateLabels}
            disabled={isProcessing}
            className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isProcessing ? 'Processing...' : 'Generate Labels'}
          </button>
        )}
      </div>

      {isProcessing ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <div className="animate-spin text-3xl mb-3">⚙️</div>
            <p className="text-sm font-medium">Analyzing chatlog...</p>
            <p className="text-xs mt-1">This may take a moment</p>
          </div>
        </div>
      ) : labels.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center text-gray-400">
          <div>
            <div className="text-4xl mb-3">🏷️</div>
            <p className="text-sm font-medium">No labels yet</p>
            <p className="text-xs mt-1">Click "Generate Labels" to analyze this chatlog</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {labels.map((label) => {
            const isHighlighted = highlightedIndex === label.message_index;
            return (
              <div
                key={label.id}
                onClick={() => onHighlight(isHighlighted ? null : label.message_index)}
                className={`rounded-lg p-3 cursor-pointer border transition-all ${
                  isHighlighted
                    ? 'border-blue-400 bg-blue-50 shadow-sm'
                    : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-gray-800">{label.label}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${GRANULARITY_COLORS[label.granularity as keyof typeof GRANULARITY_COLORS] ?? GRANULARITY_COLORS.mid}`}>
                    {label.granularity}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-1">Turn #{label.message_index + 1}</p>
                <blockquote className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-2 mb-1.5">
                  "{label.evidence}"
                </blockquote>
                <p className="text-xs text-gray-600">{label.rationale}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
