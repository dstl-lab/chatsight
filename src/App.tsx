import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './App.css';

import { Header } from './components/Header';
import { OperationsPanel } from './components/OperationsPanel';
import { Workspace } from './components/Workspace';

function App() {
  return (
    <>
      <Header />
      <div className="body">
        <OperationsPanel />
        <Workspace />
      </div>
    </>
  );
}

export default App
