import type { ChatlogDetail, LabelSet } from '../types';
import TranscriptPanel from './TranscriptPanel';
import LabelsPanel from './LabelsPanel';
import BehaviorTimeline from './BehaviorTimeline';
import SteeringPanel from './SteeringPanel';
import { useState } from 'react';

interface Props {
  chatlog: ChatlogDetail;
  activeLabelSet: LabelSet | null;
  steeringNotes: string;
  isProcessing: boolean;
  onSteeringNotesChange: (notes: string) => void;
  onGenerateLabels: () => void;
  onSelectLabelSet: (ls: LabelSet) => void;
}

export default function LabelingDashboard({
  chatlog,
  activeLabelSet,
  steeringNotes,
  isProcessing,
  onSteeringNotesChange,
  onGenerateLabels,
  onSelectLabelSet: _onSelectLabelSet,
}: Props) {
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Main panels */}
      <div className="flex flex-1 overflow-hidden gap-0">
        <div className="flex-1 overflow-hidden border-r border-gray-200">
          <TranscriptPanel
            content={chatlog.content}
            labels={activeLabelSet?.labels ?? []}
            highlightedIndex={highlightedIndex}
            onHighlight={setHighlightedIndex}
          />
        </div>
        <div className="w-96 overflow-hidden">
          <LabelsPanel
            labels={activeLabelSet?.labels ?? []}
            isProcessing={isProcessing}
            hasLabelSet={!!activeLabelSet}
            onGenerateLabels={onGenerateLabels}
            highlightedIndex={highlightedIndex}
            onHighlight={setHighlightedIndex}
          />
        </div>
      </div>

      {/* Bottom area */}
      <div className="border-t border-gray-200 bg-white">
        {activeLabelSet && activeLabelSet.labels.length > 0 && (
          <BehaviorTimeline
            labels={activeLabelSet.labels}
            onSelectMessage={setHighlightedIndex}
          />
        )}
        <SteeringPanel
          notes={steeringNotes}
          onChange={onSteeringNotesChange}
          onSubmit={onGenerateLabels}
          isProcessing={isProcessing}
          hasExistingLabels={!!activeLabelSet}
        />
      </div>
    </div>
  );
}
