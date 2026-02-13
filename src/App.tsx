import { useState, useEffect } from 'react';
import { apiClient } from './services/apiClient';
import type { FileListItem } from '../shared/types';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './App.css';

import { Header } from './components/Header';
import { OperationsPanel } from './components/OperationsPanel';
import { Workspace } from './components/Workspace';

type ModuleType = 'messages' | 'code' | 'notes' | 'chat' | 'wordcloud' | 'sentiment' | null;
type SentimentMode = 'time' | 'aggregate' | 'per-sentence';

export const SENTIMENT_LABELS = [
  'anger',
  'surprise',
  'joy',
  'sadness',
  'fear',
  'disgust',
  'neutral',
] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

interface Module {
  id: string;
  type: ModuleType;
  startIndex: number;
  colSpan: number;
  rowSpan: number;
}

function App() {
  const [modules, setModules] = useState<Module[]>([]);
  const [files, setFiles] = useState<FileListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);

  const hasMessages = modules.some(m => m.type === 'messages');
  const hasCode = modules.some(m => m.type === 'code');

  const [mode, setMode] = useState<SentimentMode>('time');
  const [visibleSentiments, setVisibleSentiments] = useState<Set<string>>(
    () => new Set(SENTIMENT_LABELS),
  );
  const toggleSentiment = (label: string) => {
    setVisibleSentiments((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };
  const nextMode = new Map<SentimentMode, SentimentMode>([
    ['time', 'aggregate'],
    ['aggregate', 'per-sentence'],
    ['per-sentence', 'time'],
  ]);
  const cycleMode = () => setMode(nextMode.get(mode) ?? 'time');


  const fetchFiles = async () => {
    try { 
      const filesList = await apiClient.getFiles();
      setFiles(filesList);
    } catch (error) {
      console.error('Failed to load files:', error);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const refreshFiles = () => fetchFiles();

  return (
    <>
      <Header
        onFileUpload={refreshFiles}
        sentimentLabels={SENTIMENT_LABELS}
        visibleSentiments={visibleSentiments}
        onToggleSentiment={toggleSentiment}
        mode={mode}
        cycleMode={cycleMode}
      />
      <div className="body">
        <aside className="sidebar">
          <OperationsPanel 
            hasMessages={hasMessages} 
            hasCode={hasCode} 
            uploadedFiles={files}
            selectedConversationId={selectedConversationId}
            onSelectConversation={setSelectedConversationId}
            onFileUpload={refreshFiles}
            onFileDelete={refreshFiles}
          />
        </aside>
        <div className="vertical-separator" />
        <Workspace
          modules={modules}
          setModules={setModules}
          selectedConversationId={selectedConversationId}
          mode={mode}
          visibleSentiments={visibleSentiments}
        />
      </div>
    </>
  );
}

export default App