import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiClient } from '../services/apiClient';
import fileIcon from '../assets/files.png'
import txtFile from '../assets/txtfile.png';
import exclamation from '../assets/exclamation.png';
import messageBubble from '../assets/message_bubble.png'
import closeIcon from '../assets/close.png'
import backIcon from '../assets/back.png'
import type { FileListItem, FileTreeProps, PathStep, AssignmentListItem, ConversationListItem } from '../../shared/types';
import './FileExplorer.css';

type FileExplorerProps = FileTreeProps & {
    onClose?: () => void;
};

export function FileExplorer({ onClose, ...fileTreeProps }: FileExplorerProps) {
    const [path, setPath] = useState<PathStep[]>([]);
    const [assignments, setAssignments] = useState<AssignmentListItem[]>([]);
    const [assignmentsLoading, setAssignmentsLoading] = useState(false);
    const [conversations, setConversations] = useState<ConversationListItem[]>([]);
    const [conversationsLoading, setConversationsLoading] = useState(false);

    const handleFileClick = (file: FileListItem) => {
        setPath((prev) => [
            ...prev,
            { type: 'file' as const, id: file.id, label: file.filename },
        ]);
    };

    const handleAssignmentClick = (assignment: AssignmentListItem) => {
        setPath((prev) => [
            ...prev,
            { type: 'assignment' as const, id: assignment.id, label: assignment.assignmentRef },
        ]);
    };

    const handleConversationClick = (conversation: ConversationListItem) => {
        fileTreeProps.onSelectConversation(conversation.id);
    }

    useEffect(() => {
        if (path.length !== 2 || path[1].type !== 'assignment') {
            setConversations([]);
            return;
        }
        const assignmentId = path[1].id
        setConversationsLoading(true);
        apiClient
            .getAssignmentConversations(assignmentId)
            .then(setConversations)
            .catch(() => setConversations([]))
            .finally(() => setConversationsLoading(false));
    }, [path]);

    useEffect(() => {
        if (path.length !== 1 || path[0].type !== 'file') {
            setAssignments([]);
            return;
        }
        const fileId = path[0].id;
        setAssignmentsLoading(true);
        apiClient
            .getFileAssignments(fileId)
            .then(setAssignments)
            .catch(() => setAssignments([]))
            .finally(() => setAssignmentsLoading(false));
    }, [path]);

    return createPortal(
        <div className="file-explorer-backdrop" onClick={onClose}>
            <div className="file-explorer" onClick={(e) => e.stopPropagation()}>
                <div className="header">
                    <div className="left">
                        <img src={fileIcon}></img>
                        <h1>DIRECTORY</h1>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', 'cursor': 'pointer' }}>
                        <img src={closeIcon} />
                    </button>
                </div>
                <div className="section-separator"></div>
                {path.length > 0 && (
                    <div className="breadcrumb">
                        <button type="button" onClick={() => setPath(prev => prev.slice(0, -1))} style={{ background: 'none', border: 'none', 'cursor': 'pointer' }}>
                            <img src={backIcon} />
                        </button>
                        <span> {path.map(s => s.label).join(' / ')} </span>
                    </div>
                )}
                {path.length === 0 ? (
                    <div>
                        {(fileTreeProps.files ?? []).map((file) => (
                            <div 
                                key={file.id} 
                                onClick={() => handleFileClick(file)}
                                className="default-block file"
                            >
                                <img src={txtFile} />
                                {file.filename}
                            </div>
                        ))}
                    </div>
                ) : path.length === 1 ? (
                    <div>
                        {assignmentsLoading ? (
                            <div>Loading...</div>
                        ) : (
                            assignments.map((assignment) => (
                                <div
                                    key={assignment.id}
                                    onClick={() => handleAssignmentClick(assignment)}
                                    className="default-block"
                                >
                                    <img src={exclamation} />
                                    {assignment.assignmentRef}
                                </div>
                            ))
                        )}
                    </div>
                ) : path.length === 2 ? (
                    <div>
                        {conversationsLoading ? (
                            <div>Loading...</div>
                        ) : (
                            conversations.map((conversation) => (
                                <div
                                    key={conversation.id}
                                    onClick={() => handleConversationClick(conversation)}
                                    className={`default-block ${fileTreeProps.selectedConversationId === conversation.id ? 'selected' : ''}`}
                                >
                                    <img src={messageBubble} />
                                    {conversation.student}
                                </div>
                            ))
                        )}
                    </div>
                ) : null}
            </div>
        </div>,
        document.body
    );
}