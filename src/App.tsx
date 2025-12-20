import { useState } from 'react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './App.css';

import { Header } from './components/Header';
import { OperationsPanel } from './components/OperationsPanel';
import { Workspace } from './components/Workspace';

type ModuleType = 'messages' | 'code' | 'notes' | 'chat' | 'wordcloud' | 'sentiment' | null;

function App() {
  const [gridSlots, setGridSlots] = useState<(ModuleType | null)[]>([
    null, null, null, 
    null, null, null, 
  ]);

  const hasMessages = gridSlots.includes('messages')

  return (
    <>
      <Header />
      <div className="body">
        <aside className="sidebar">
          <OperationsPanel hasMessages={hasMessages} />
        </aside>
        <div className="vertical-separator" />
        <Workspace gridSlots={gridSlots} setGridSlots={setGridSlots} />
      </div>
    </>
  );
}

export default App