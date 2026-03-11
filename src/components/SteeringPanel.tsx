interface Props {
  notes: string;
  onChange: (notes: string) => void;
  onSubmit: () => void;
  isProcessing: boolean;
  hasExistingLabels: boolean;
}

export default function SteeringPanel({ notes, onChange, onSubmit, isProcessing, hasExistingLabels }: Props) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
            {hasExistingLabels ? 'Steering Instructions (re-process with feedback)' : 'Steering Instructions (optional)'}
          </label>
          <textarea
            value={notes}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. Focus on conceptual math errors, ignore procedural steps..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={2}
            disabled={isProcessing}
          />
        </div>
        <div className="pt-5">
          <button
            onClick={onSubmit}
            disabled={isProcessing}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
          >
            {isProcessing ? 'Processing...' : hasExistingLabels ? 'Re-process ▶' : 'Generate Labels ▶'}
          </button>
        </div>
      </div>
    </div>
  );
}
