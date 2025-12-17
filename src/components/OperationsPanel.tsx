import { useState } from 'react';
import './OperationsPanel.css';
import operations from '../assets/operations.png';
import files from '../assets/files.png';
import messages from '../assets/messages.png';
import code from '../assets/code.png';
import notes from '../assets/notes.png';
import chatgpt from '../assets/chatgpt.png';
import wordcloud from '../assets/wordcloud.png';
import sentiment from '../assets/sentiment.png';
import collapseIcon from '../assets/collapse.png';
import expandIcon from '../assets/expand.png';
import txtFile from '../assets/txtfile.png';

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="section-title">
      <img className="header-img" src={icon} alt={title.toLowerCase()} />
      <h3>{title}</h3>
    </div>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode; }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="collapsible-section">
      <h4 className="collapsible-header" onClick={() => setIsOpen(!isOpen)}>
        <span>{title}</span>
        <img
          className="collapsible-icon"
          src={isOpen ? collapseIcon : expandIcon}
          alt={isOpen ? 'collapse' : 'expand'}
        />
      </h4>
      <div className={`collapsible-content ${isOpen ? 'open' : 'closed'}`}>
        {children}
      </div>
    </div>
  );
}

function OperationItem({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="operation-item">
      <img className="operation-img" src={icon} alt={title.toLowerCase()} />
      <p>{title}</p>
    </div>
  );
}

function FileItem({ title, selected, onClick }: { title: string; selected: boolean; onClick: () => void}) {
  return (
    <div className={`file-item ${selected ? 'selected' : ''}`} onClick={onClick}>
      <img className="file-img" src={txtFile} alt={title.toLowerCase()} />
      <p>{title}</p>
    </div>
  );
}

export function OperationsPanel() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const filesList = ['tempfile1.txt', 'tempfile2.txt', 'tempfile3.txt'];

  return (
    <aside className="files-and-notes">
      <div className="operations">
        <SectionTitle icon={operations} title="OPERATIONS" />
        <div className="section-separator"></div>
        <CollapsibleSection title="Line-by-Line">
          <OperationItem icon={messages} title="Messsages" />
          <OperationItem icon={code} title="Code" />
        </CollapsibleSection>
        <CollapsibleSection title="Holistic">
          <OperationItem icon={notes} title="Notes" />
          <OperationItem icon={chatgpt} title="Chat" />
          <OperationItem icon={wordcloud} title="Word Cloud" />
          <OperationItem icon={sentiment} title="Sentiment" />
        </CollapsibleSection>
      </div>
      <div className="files">
        <SectionTitle icon={files} title="FILES" />
        <div className="section-separator"></div>
        {filesList.map((name) => (
          <FileItem
            key={name}
            title={name}
            selected={selectedFile === name}
            onClick={() => setSelectedFile(name)}
          />
        ))}
      </div>
    </aside>
  );
}

