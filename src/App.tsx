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

  const hasMessages = modules.some(m => m.type === 'messages');
  const hasCode = modules.some(m => m.type === 'code');

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
      <Header onFileUpload={refreshFiles}/>
      <div className="body">
        <aside className="sidebar">
          <OperationsPanel 
            hasMessages={hasMessages} 
            hasCode={hasCode} 
            uploadedFiles={files}
            onFileUpload={refreshFiles}
            onFileDelete={refreshFiles}
          />
        </aside>
        <div className="vertical-separator" />
        <Workspace modules={modules} setModules={setModules} />
      </div>
    </>
  );
}

export default App