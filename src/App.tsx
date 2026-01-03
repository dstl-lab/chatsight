import { useState } from 'react';
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

  const hasMessages = modules.some(m => m.type === 'messages');
  const hasCode = modules.some(m => m.type === 'code')

  return (
    <>
      <Header />
      <div className="body">
        <aside className="sidebar">
          <OperationsPanel hasMessages={hasMessages} hasCode={hasCode} />
        </aside>
        <div className="vertical-separator" />
        <Workspace modules={modules} setModules={setModules} />
      </div>
    </>
  );
}

export default App