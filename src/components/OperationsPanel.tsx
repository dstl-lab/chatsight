import { useState } from 'react';
import { apiClient } from '../services/apiClient';
import './OperationsPanel.css';
import operations from '../assets/operations.png';
import files_png from '../assets/files.png';
import messages from '../assets/messages.png';
import code from '../assets/code.png';
import notes from '../assets/notes.png';
import chatgpt from '../assets/chatgpt.png';
import wordcloud from '../assets/wordcloud.png';
import sentiment from '../assets/sentiment.png';
import collapseIcon from '../assets/collapse.png';
import expandIcon from '../assets/expand.png';
import txtFile from '../assets/txtfile.png';

interface OperationItemProps {
  icon: string;
  title: string;
  isMessagesDisabled?: boolean;
  isCodeDisabled?: boolean;
}

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

function OperationItem({ icon, title, isMessagesDisabled, isCodeDisabled }: OperationItemProps) {
  const handleDragStart = (e: React.DragEvent) => {
    if (isMessagesDisabled) {
      e.preventDefault();
      return;
    }

    if (isCodeDisabled) {
      e.preventDefault();
      return;
    }

    const moduleType = title.toLowerCase().replace(/\s+/g, '');
    e.dataTransfer.setData('moduleType', moduleType);
    e.dataTransfer.effectAllowed = 'move';
  };

  const isDisabled = isMessagesDisabled || isCodeDisabled;

  return (
    <div 
      className={`operation-item ${isDisabled ? 'disabled' : ''}`}
      draggable={!isDisabled}
      onDragStart={handleDragStart}
    >
      <img className="operation-img" src={icon} alt={title.toLowerCase()} />
      <p>{title}</p>
    </div>
  );
}

function FileItem({ 
  title, 
  selected, 
  onClick, 
  onClose
 }: { 
  title: string; 
  selected: boolean; 
  onClick: () => void; 
  onClose?: () => void; 
}) {
  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  };

  return (
    <div className={`file-item ${selected ? 'selected' : ''}`} onClick={onClick}>
      <img className="file-img" src={txtFile} alt={title.toLowerCase()} />
      <p>{title}</p>
      {onClose && (
        <button
          className="file-item-close"
          onClick={handleCloseClick}
          aria-label={`Close ${title}`}
        >
          x
        </button>
      )}
    </div>
  );
}

export function OperationsPanel({ 
  hasMessages, 
  hasCode,
  uploadedFiles,
  onFileUpload,
  onFileDelete
}: { 
  hasMessages: boolean, 
  hasCode: boolean,
  uploadedFiles: Array<{ id: number; filename: string; fileType: string | null; fileSize: number | null; createdAt: string }>
  onFileUpload?: () => void;
  onFileDelete?: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<number | null>(null);

  return (
    <aside className="files-and-notes">
      <div className="operations">
        <SectionTitle icon={operations} title="OPERATIONS" />
        <div className="section-separator"></div>
        <CollapsibleSection title="Line-by-Line">
          <OperationItem icon={messages} title="Messages" isMessagesDisabled={hasMessages} />
          <OperationItem icon={code} title="Code" isCodeDisabled={!hasMessages || hasCode} />
        </CollapsibleSection>
        <CollapsibleSection title="Holistic">
          <OperationItem icon={notes} title="Notes" />
          <OperationItem icon={chatgpt} title="Chat" />
          <OperationItem icon={wordcloud} title="Word Cloud" />
          <OperationItem icon={sentiment} title="Sentiment" />
        </CollapsibleSection>
      </div>
      <div className="files">
        <SectionTitle icon={files_png} title="FILES" />
        <div className="section-separator"></div>
        { uploadedFiles.map((file) => (
          <FileItem
            key={file.id}
            title={file.filename}
            selected={selectedFile === file.id}
            onClick={() => setSelectedFile((prev) => (prev === file.id ? null : file.id))}
            onClose={async () => {
              if (selectedFile === file.id) {
                setSelectedFile(null);
              }
              try {
                await apiClient.deleteFile(file.id);
                onFileDelete?.();
              } catch (error) {
                console.error('Failed to delete file:', error);
              } 
            }}
          />
        ))}
      </div>
    </aside>
  );
}

