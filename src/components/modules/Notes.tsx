// export file into Markdown file (look back to onboarding-chat)

import { useEffect, useState } from 'react';
import './Notes.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';
import Editor from "@monaco-editor/react";
import { apiClient } from '../../services/apiClient';
import type { NotesTab } from '../../../shared/types';

interface FileMessageRow {
    id: number;
    role: string | null;
    content: string;
    timestamp: string | null;
    sortOrder: number;
}

interface NotesProps {
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
    messageIndex?: number;
    conversationId: number | null;
    sharedMessages?: FileMessageRow[];
}

export function Notes({ onClose, onResize, colSpan = 1, rowSpan = 1, messageIndex: _messageIndex, conversationId, sharedMessages }: NotesProps) {
    const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({ 
        colSpan, 
        rowSpan,
        onResize,
    });

    const [notesTabs, setNotesTabs] = useState<NotesTab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState(0);
    const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
    const [editingTabName, setEditingTabName] = useState('');
    const [isLoading, setIsLoading] = useState(false);


    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const lightEditorBg = "#ffffff";
    const darkEditorBg = "#1e1e1e";

    const loading = conversationId != null && sharedMessages === undefined;

    useEffect(() => {
        if (!conversationId) {
            setNotesTabs([]);
            setActiveTabIndex(0);
            return;
        }

        setIsLoading(true);
        apiClient.getNotesTabs(conversationId)
            .then((tabs) => {
                if (tabs.length === 0) {
                    apiClient.createNotesTab(conversationId, 'tab1')
                        .then((newTab) => {
                            setNotesTabs([{
                                id: newTab.id,
                                conversationId,
                                tabName: newTab.tabName,
                                content: '',
                                sortOrder: 0
                            }])
                        }
                    );
                } else {
                    setNotesTabs(tabs);
                    setActiveTabIndex(0);
                }
            })
            .catch(console.error)
            .finally(() => setIsLoading(false));
    }, [conversationId]);

    const handleTabDoubleClick = (index: number) => {
        setEditingTabIndex(index);
        setEditingTabName(notesTabs[index]?.tabName ?? '');
    };

    const handleTabNameChange = (newName: string) => {
        setEditingTabName(newName);
    };

    const handleTabNameSubmit = (index: number) => {
        const newName = editingTabName.trim();
        if (!newName || !notesTabs[index]) return;
        
        const nameExists = notesTabs.some((t, i) => i !== index && t.tabName === newName);
        if (nameExists) {  // <-- Fixed: removed the "!"
            setEditingTabIndex(null);
            return;
        }
        
        const tabId = notesTabs[index].id;
        apiClient.renameNotesTab(tabId, newName)
            .then(() => {
                setNotesTabs(prev => {
                    const updated = [...prev];
                    updated[index] = { ...updated[index], tabName: newName };
                    return updated;
                });
            })
            .catch(console.error)
            .finally(() => setEditingTabIndex(null));
    };

    const handleTabNameKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'Enter') {
            handleTabNameSubmit(index);
        } else if (e.key === 'Escape') {
            setEditingTabIndex(null);
        }
    };

    const handleTabDelete = (index: number) => {
        if (notesTabs.length === 1 || !notesTabs[index] || !conversationId) return;

        const tabId = notesTabs[index].id;
        apiClient.deleteNotesTab(tabId)
            .then(() => {
                setNotesTabs(prev => prev.filter((_, i) => i !== index));
                setActiveTabIndex(prev => {
                    if (index < prev) return prev - 1;
                    if (index === prev) return Math.max(0, prev - 1);
                    return prev;
                });
            })
            .catch(console.error);
    };

    const handleTabAdd = () => {
        if (!conversationId) return;

        const newTabName = `tab${notesTabs.length + 1}`;
        apiClient.createNotesTab(conversationId, newTabName)
            .then((newTab) => {
                const fullTab: NotesTab = {
                    id: newTab.id,
                    conversationId,
                    tabName: newTab.tabName,
                    content: '',
                    sortOrder: notesTabs.length
                };
                setNotesTabs(prev => [...prev, fullTab]);
                setActiveTabIndex(notesTabs.length);
            })
            .catch(console.error);
    };

    const handleTabClick = (index: number) => {
        setActiveTabIndex(index);
    }

    const handleContentChange = (value: string | undefined) => {
        const val = value ?? '';
        const currentTab = notesTabs[activeTabIndex];
        if (!currentTab) return;

        setNotesTabs(prev => {
            const updated = [...prev];
            updated[activeTabIndex] = { ...updated[activeTabIndex], content: val };
            return updated;
        });

        apiClient.updateNotesContent(currentTab.id, val)
            .catch(console.error);
    };

    const handleExport = () => {
        const currentTab = notesTabs[activeTabIndex] || '';
        if (!currentTab) return;

        const content = currentTab.content || '';
        const rawName = currentTab.tabName || 'notes';
        const filenameBase = rawName
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .toLowerCase();

        const date = new Date().toISOString().slice(0, 10);

        const mdContent = `# ${rawName}\n\n${content}`;

        const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenameBase}-${date}.md`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
    };

    return (
        <div className="notes-module" ref={moduleRef} style={{
            ["--editor-bg" as any]: prefersDark ? darkEditorBg : lightEditorBg,
            ["--editor-fg" as any]: prefersDark ? "#ffffff" : "#000000",
            ["--editor-nbg" as any]: prefersDark ? "#333333" : "#E5E5E5",
            ["--editor-hbg" as any]: prefersDark ? "#4b4d51ff" : "#eff2f3",
        }}>
            {resizeHandles.right && (
                <div
                    className="resize-handle resize-handle-right"
                    onMouseDown={(e) => handleResizeStart(e, 'right')}
                />
            )}
            {resizeHandles.bottom && (
                <div
                    className="resize-handle resize-handle-bottom"
                    onMouseDown={(e) => handleResizeStart(e, 'down')}
                />
            )}
            {resizeHandles.corner && (
                <div
                    className="resize-handle resize-handle-corner"
                    onMouseDown={(e) => handleResizeStart(e, 'corner')}
                />
            )}
            <div className="module-header">
                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <h3 className="module-title">Notes</h3>
                    {!conversationId && (
                        <span className="messages-hint">Select a conversation</span>
                    )}
                    {conversationId && loading && (
                        <span className="messages-hint">Loading…</span>
                    )}
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <button
                        className="export-button"
                        onClick={handleExport}
                    >
                        Export 
                        <img className="export-img" src="src/assets/ExportButton.png" width="10px"></img>
                    </button>
                    <button className="close-button" onClick={onClose} aria-label="Close module" >
                        x
                    </button>
                </div>
            </div>

            <div className="notes-tabs-header">
                <div className="notes-tabs-container">
                    {notesTabs.map((tab, index) => (
                        <button 
                            key={index}
                            className={`notes-tabs ${activeTabIndex === index ? 'notes-tab-active' : ''}`} 
                            onClick={() => handleTabClick(index)}
                            onDoubleClick={() => handleTabDoubleClick(index)}
                            style={{
                                ["--editor-bg" as any]: prefersDark ? darkEditorBg : lightEditorBg,
                                ["--editor-fg" as any]: prefersDark ? "#ffffff" : "#000000",
                                ["--editor-nbg" as any]: prefersDark ? "#333333" : "#E5E5E5",
                                ["--editor-hbg" as any]: prefersDark ? "#4b4d51ff" : "#eff2f3",
                            }}
                        >
                            {editingTabIndex === index ? (
                                <input
                                    type="text"
                                    value={editingTabName}
                                    onChange={(e) => handleTabNameChange(e.target.value)}
                                    onBlur={() => handleTabNameSubmit(index)}
                                    onKeyDown={(e) => handleTabNameKeyDown(e, index)}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <span>{tab.tabName}</span>
                            )}
                            <span
                                className="notes-tabs-exit"
                                onClick={(e) => { e.stopPropagation(); handleTabDelete(index); }}
                                role="button"
                                tabIndex={0}
                            >
                                X
                            </span>
                        </button>

                    ))}
                    {conversationId && !loading && !isLoading && notesTabs[activeTabIndex] && (
                        <button className="notes-new-tabs" onClick={() => handleTabAdd()} aria-label="Close module"
                            style={{
                                ["--editor-bg" as any]: prefersDark ? darkEditorBg : lightEditorBg,
                                ["--editor-fg" as any]: prefersDark ? "#ffffff" : "#000000",
                                ["--editor-nbg" as any]: prefersDark ? "#333333" : "#E5E5E5",
                                ["--editor-hbg" as any]: prefersDark ? "#4b4d51ff" : "#eff2f3",
                            }}
                        >
                                +
                        </button>
                    )}
                </div>
            </div>
            <div className="notes-content-container" style={{ height: "100%" }}>
                {conversationId && !loading && !isLoading && notesTabs[activeTabIndex] && (
                    <Editor
                        height="100%"
                        language="markdown"
                        theme={prefersDark ? 'vs-dark' : 'vs'}
                        value={notesTabs[activeTabIndex].content}
                        onChange={handleContentChange}
                        options={{
                            wordWrap: "on",
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            automaticLayout: true
                        }}
                    />
                )}
            </div>
        </div>
    )
}