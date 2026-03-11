import { useState, useEffect } from 'react';
import type { ChatlogSummary, ChatlogDetail, LabelSet } from './types';
import { listChatlogs, getChatlog, generateLabels } from './services/api';
import ChatlogList from './components/ChatlogList';
import LabelingDashboard from './components/LabelingDashboard';

export default function App() {
  const [chatlogs, setChatlogs] = useState<ChatlogSummary[]>([]);
  const [selectedChatlogId, setSelectedChatlogId] = useState<number | null>(null);
  const [chatlogDetail, setChatlogDetail] = useState<ChatlogDetail | null>(null);
  const [activeLabelSet, setActiveLabelSet] = useState<LabelSet | null>(null);
  const [steeringNotes, setSteeringNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listChatlogs().then(setChatlogs).catch(console.error);
  }, []);

  const handleSelectChatlog = async (id: number) => {
    setSelectedChatlogId(id);
    setActiveLabelSet(null);
    setSteeringNotes('');
    setError(null);
    try {
      const detail = await getChatlog(id);
      setChatlogDetail(detail);
      if (detail.latest_label_set) {
        setActiveLabelSet(detail.latest_label_set);
      }
    } catch (_e) {
      setError('Failed to load chatlog');
    }
  };

  const handleGenerateLabels = async () => {
    if (!selectedChatlogId) return;
    setIsProcessing(true);
    setError(null);
    try {
      const result = await generateLabels(selectedChatlogId, steeringNotes);
      const newLabelSet: LabelSet = {
        id: result.label_set_id,
        chatlog_id: selectedChatlogId,
        steering_notes: steeringNotes,
        created_at: new Date().toISOString(),
        labels: result.labels,
      };
      setActiveLabelSet(newLabelSet);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate labels');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Chatsight</h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Chatlogs</h2>
          </div>
          <ChatlogList
            chatlogs={chatlogs}
            selectedId={selectedChatlogId}
            onSelect={handleSelectChatlog}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 m-4 rounded-lg text-sm">
              {error}
            </div>
          )}
          {chatlogDetail ? (
            <LabelingDashboard
              chatlog={chatlogDetail}
              activeLabelSet={activeLabelSet}
              steeringNotes={steeringNotes}
              isProcessing={isProcessing}
              onSteeringNotesChange={setSteeringNotes}
              onGenerateLabels={handleGenerateLabels}
              onSelectLabelSet={setActiveLabelSet}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <div className="text-5xl mb-4">💬</div>
                <p className="text-lg font-medium">Select a chatlog to begin</p>
                <p className="text-sm mt-1">Select a session from the list</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
