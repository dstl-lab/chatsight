// export file into Markdown file (look back to onboarding-chat)

import { useState, useEffect } from 'react';
import './Notes.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';
import Editor from "@monaco-editor/react";
import { getDatabase } from '../../../services/database';
import type { NotesTab } from '../../../services/database';

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

    const [tabs, setTabs] = useState<NotesTab[]>([]);

    const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
    const [editingTabName, setEditingTabName] = useState('');

    const [activeTabIndex, setActiveTabIndex] = useState(0);

    useEffect(() => {
        if (!conversationId) {
            setTabs([]);
            setActiveTabIndex(0);
            return;
        }

        const db = getDatabase();
        let tabsFromDb = db.getNotesTabs(conversationId);

        if (tabsFromDb.length === 0) {
            db.createNotesTab(conversationId, 'tab1');
            tabsFromDb = db.getNotesTabs(conversationId);
        }

        setTabs(tabsFromDb);
        setActiveTabIndex(0);
    }, [conversationId]);

    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const lightEditorBg = "#ffffff";
    const darkEditorBg = "#1e1e1e";

    const loading = conversationId != null && sharedMessages === undefined;

    const handleTabDoubleClick = (index: number) => {
        setEditingTabIndex(index);
        // Start editing with the current tab name
        setEditingTabName(tabs[index]?.tabName ?? '');
    };

    const handleTabNameChange = (newName: string) => {
        setEditingTabName(newName);
    };

    const handleTabNameSubmit = (index: number) => {
        const newName = editingTabName.trim();
        if (!newName) {
            setEditingTabIndex(null);
            return;
        }

        const nameExists = tabs.some((t, i) => i !== index && t.tabName === newName);
        if (nameExists) {
            setEditingTabIndex(null);
            return;
        }

        const updatedTabs = [...tabs];
        const currentTab = updatedTabs[index];

        updatedTabs[index] = {
            ...currentTab,
            tabName: newName
        };

        setTabs(updatedTabs);

        if (conversationId) {
            const db = getDatabase();
            db.renameNotesTab(currentTab.id, newName);
        }

        setEditingTabIndex(null);
    };


    const handleTabNameKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'Enter') {
            handleTabNameSubmit(index);
        } else if (e.key === 'Escape') {
            setEditingTabIndex(null);
        }
    };

    const handleTabDelete = (index: number) => {
        if (tabs.length === 1) return;

        const tabToDelete = tabs[index];

        if (conversationId) {
            const db = getDatabase();
            db.deleteNotesTab(tabToDelete.id);
        }

        const updatedTabs = tabs.filter((_, i) => i !== index);

        setTabs(updatedTabs);

        setActiveTabIndex(prev => {
            if (index < prev) return prev - 1;
            if (index === prev) return Math.max(0, prev - 1);
            return prev;
        });
    };

    const handleTabAdd = () => {
        if (!conversationId) return;

        const db = getDatabase();
        const newName = `tab${tabs.length + 1}`;

        const newId = db.createNotesTab(conversationId, newName);

        const newTab: NotesTab = {
            id: newId,
            conversationId,
            tabName: newName,
            content: '',
            sortOrder: tabs.length
        };

        setTabs([...tabs, newTab]);
        setActiveTabIndex(tabs.length);
    };



    const handleTabClick = (index: number) => {
        setActiveTabIndex(index);
    }

    const handleExport = () => {
        const content = tabs[activeTabIndex]?.content ?? '';

        const rawName = tabs[activeTabIndex]?.tabName ?? 'notes';
        const filenameBase = rawName
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .toLowerCase();

        const date = new Date().toISOString().slice(0, 10);

        const mdContent = `# ${rawName}\n\n${content}`;

        // Create a blob with the notes content
        const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        // Create a download link and trigger it
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenameBase}-${date}.md`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
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
                <div style={{display: 'flex', alignItems: 'center', gap: '10px', position: 'relative'}}>
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
                        <img className="export-img" src={require('../assets/export.png')} alt="export" width="10px" />
                    </button>
                    <button className="close-button" onClick={onClose} aria-label="Close module" >
                        x
                    </button>
                </div>
            </div>

            <div className="notes-tabs-header">
                <div className="notes-tabs-container">
                    {tabs.map((tab, index) => (
                        <button 
                            key={index}
                            className={`notes-tabs ${activeTabIndex === index ? 'notes-tab-active' : ''}`} 
                            onClick={() => handleTabClick(index)}
                            onDoubleClick={() => handleTabDoubleClick(index)}
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
                    <button className="notes-new-tabs" onClick={() => handleTabAdd()} aria-label="Close module">
                            +
                    </button>
                </div>
                <button className="notes-new-tabs" onClick={() => handleTabAdd()} aria-label="Close module">
                    +
                </button>
            </div>
            <div className="notes-content-container" style={{ height: "100%" }}>
                {conversationId && !loading && (
                    <Editor
                        height="100%"
                        language="markdown"
                        theme={prefersDark ? 'vs-dark' : 'vs'}
                        value={tabs[activeTabIndex]?.content ?? ''}
                        onChange={(value) => {
                            const val = value ?? '';
                            const updatedTabs = [...tabs];
                            const currentTab = updatedTabs[activeTabIndex];
                            updatedTabs[activeTabIndex] = {
                                ...currentTab,
                                content: val
                            };
                            setTabs(updatedTabs);
                        }}
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