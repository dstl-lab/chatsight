import { useState, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import type { AssignmentListItem, ConversationListItem, FileListItem } from '../shared/types';
import './OperationsPanel.css';
import operations from '../assets/operations.png';
import filesIcon from '../assets/files.png';
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

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
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

interface FileTreeProps {
  files: FileListItem[];
  selectedConversationId: number | null;
  onSelectConversation: (id: number | null) => void;
  onFileDeleted: () => void;
}

function FileTree({ files, selectedConversationId, onSelectConversation, onFileDeleted }: FileTreeProps) {
  const [expandedFileIds, setExpandedFileIds] = useState<Set<number>>(new Set());
  const [expandedAssignmentIds, setExpandedAssignmentIds] = useState<Set<number>>(new Set());
  const [assignmentsByFileId, setAssignmentsByFileId] = useState<Record<number, AssignmentListItem[]>>({});
  const [conversationsByAssignmentId, setConversationsByAssignmentId] = useState<Record<number, ConversationListItem[]>>({});
  const [loadingFileId, setLoadingFileId] = useState<number | null>(null);
  const [loadingAssignmentId, setLoadingAssignmentId] = useState<number | null>(null);

  const toggleFile = useCallback(
    async (fileId: number) => {
      setExpandedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
          if (!(fileId in assignmentsByFileId)) {
            setLoadingFileId(fileId);
            apiClient
              .getFileAssignments(fileId)
              .then((list) => {
                setAssignmentsByFileId((a) => ({ ...a, [fileId]: list }));
              })
              .catch(() => {})
              .finally(() => setLoadingFileId(null));
          }
        }
        return next;
      });
    },
    [assignmentsByFileId]
  );

  const toggleAssignment = useCallback(
    async (assignmentId: number) => {
      setExpandedAssignmentIds((prev) => {
        const next = new Set(prev);
        if (next.has(assignmentId)) {
          next.delete(assignmentId);
        } else {
          next.add(assignmentId);
          if (!(assignmentId in conversationsByAssignmentId)) {
            setLoadingAssignmentId(assignmentId);
            apiClient
              .getAssignmentConversations(assignmentId)
              .then((list) => {
                setConversationsByAssignmentId((c) => ({ ...c, [assignmentId]: list }));
              })
              .catch(() => {})
              .finally(() => setLoadingAssignmentId(null));
          }
        }
        return next;
      });
    },
    [conversationsByAssignmentId]
  );

  const handleDeleteFile = async (e: React.MouseEvent, fileId: number) => {
    e.stopPropagation();
    try {
      await apiClient.deleteFile(fileId);
      onSelectConversation(null);
      setExpandedFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      setAssignmentsByFileId((a) => {
        const { [fileId]: _, ...rest } = a;
        return rest;
      });
      onFileDeleted();
    } catch (err) {
      console.error('Failed to delete file:', err);
      window.alert('Could not delete file. Please try again.');
    }
  };

  return (
    <div className="file-tree">
      {files.map((file) => {
        const fileExpanded = expandedFileIds.has(file.id);
        const assignments = assignmentsByFileId[file.id] ?? [];
        const fileLoading = loadingFileId === file.id;

        return (
          <div key={file.id} className="file-tree-file">
            <div
              className="file-tree-row file-tree-file-row"
              onClick={() => toggleFile(file.id)}
            >
              <img
                className="file-tree-expand"
                src={fileExpanded ? collapseIcon : expandIcon}
                alt={fileExpanded ? 'collapse' : 'expand'}
              />
              <img className="file-img" src={txtFile} alt="" />
              <span className="file-tree-label">{file.filename}</span>
              <button
                type="button"
                className="file-item-close"
                onClick={(e) => handleDeleteFile(e, file.id)}
                aria-label={`Delete ${file.filename}`}
              >
                ×
              </button>
            </div>
            {fileExpanded && (
              <div className="file-tree-children">
                {fileLoading && <div className="file-tree-loading">Loading…</div>}
                {!fileLoading && assignments.length === 0 && (
                  <div className="file-tree-empty">No assignments. Import cleaned data first.</div>
                )}
                {!fileLoading &&
                  assignments.map((assignment) => {
                    const assignmentExpanded = expandedAssignmentIds.has(assignment.id);
                    const conversations = conversationsByAssignmentId[assignment.id] ?? [];
                    const assignmentLoading = loadingAssignmentId === assignment.id;

                    return (
                      <div key={assignment.id} className="file-tree-assignment">
                        <div
                          className="file-tree-row file-tree-assignment-row"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAssignment(assignment.id);
                          }}
                        >
                          <img
                            className="file-tree-expand"
                            src={assignmentExpanded ? collapseIcon : expandIcon}
                            alt={assignmentExpanded ? 'collapse' : 'expand'}
                          />
                          <span className="file-tree-label" title={assignment.assignmentRef}>
                            {assignment.assignmentRef.length > 24
                              ? assignment.assignmentRef.slice(0, 24) + '…'
                              : assignment.assignmentRef}
                          </span>
                        </div>
                        {assignmentExpanded && (
                          <div className="file-tree-children">
                            {assignmentLoading && (
                              <div className="file-tree-loading">Loading…</div>
                            )}
                            {!assignmentLoading && conversations.length === 0 && (
                              <div className="file-tree-empty">No conversations.</div>
                            )}
                            {!assignmentLoading &&
                              conversations.map((conversation) => (
                                <div
                                  key={conversation.id}
                                  className={`file-tree-row file-tree-conversation-row ${
                                    selectedConversationId === conversation.id ? 'selected' : ''
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectConversation(
                                      selectedConversationId === conversation.id ? null : conversation.id
                                    );
                                  }}
                                >
                                  <span className="file-tree-label" title={conversation.student}>
                                    {conversation.student.length > 28
                                      ? conversation.student.slice(0, 28) + '…'
                                      : conversation.student}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function OperationsPanel({
  hasMessages,
  hasCode,
  uploadedFiles,
  selectedConversationId,
  onSelectConversation,
  onFileUpload,
  onFileDelete,
}: {
  hasMessages: boolean;
  hasCode: boolean;
  uploadedFiles: FileListItem[];
  selectedConversationId: number | null;
  onSelectConversation: (id: number | null) => void;
  onFileUpload?: () => void;
  onFileDelete?: () => void;
}) {
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
        <SectionTitle icon={filesIcon} title="FILES" />
        <div className="section-separator"></div>
        <FileTree
          files={uploadedFiles}
          selectedConversationId={selectedConversationId}
          onSelectConversation={onSelectConversation}
          onFileDeleted={onFileDelete ?? (() => {})}
        />
      </div>
    </aside>
  );
}
