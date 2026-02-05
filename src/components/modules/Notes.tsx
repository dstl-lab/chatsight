// export file into Markdown file (look back to onboarding-chat)

import { useState } from 'react';
import './Notes.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';
import Editor from "@monaco-editor/react";

interface NotesProps {
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
    messageIndex?: number;
}

export function Notes({ onClose, onResize, colSpan = 1, rowSpan = 1, messageIndex: _messageIndex }: NotesProps) {
    const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({ 
        colSpan, 
        rowSpan,
        onResize,
    });

    const [tabs, setTabs] = useState(['tab1']);
    const [tabCounter, setTabCounter] = useState(2);

    const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
    const [editingTabName, setEditingTabName] = useState('');

    const [activeTabIndex, setActiveTabIndex] = useState(0);
    const [tabContents, setTabContents] = useState(['']);

    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const lightEditorBg = "#ffffff";
    const darkEditorBg = "#1e1e1e";

    const handleTabDoubleClick = (index: number) => {
        setEditingTabIndex(index);
        // Start editing with the current tab name
        setEditingTabName(tabs[index] ?? '');
    };

    const handleTabNameChange = (newName: string) => {
        setEditingTabName(newName);
    };

    const handleTabNameSubmit = (index: number) => {
        const newName = editingTabName.trim();
        if (newName) {
            // Don't allow duplicate names on other tabs
            const nameExists = tabs.some((t, i) => i !== index && t === newName);
            if (!nameExists) {
                const newTabs = [...tabs];
                newTabs[index] = newName;
                setTabs(newTabs);
            }
            // If name exists, do nothing (keep old name)
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
        if (tabs.length === 1) {
            return;
        } else {
            const newTabs = tabs.filter((_, i) => i !== index);
            setTabs(newTabs);
            const newTabContents = tabContents.filter((_, i) => i !== index);
            setTabContents(newTabContents);
            setActiveTabIndex((prev) => {
                if (index < prev) return prev - 1;
                if (index === prev) return Math.max(0, prev - 1);
                return prev;
            });
        }
    };

    const handleTabAdd = () => {
        const newTabs = [...tabs, `tab${tabCounter}`];
        setTabs(newTabs);
        setTabContents([ ...tabContents, '']);
        setTabCounter((prevCounter) => (prevCounter >= 99 ? 1 : prevCounter + 1));
    }

    const handleTabClick = (index: number) => {
        setActiveTabIndex(index);
    }

    const handleExport = () => {
        const content = tabContents[activeTabIndex] || '';

        const rawName = tabs[activeTabIndex] || 'notes';
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
        <div className="notes-module" ref={moduleRef}>
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
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <button
                        className="export-button"
                        onClick={handleExport}
                    >
                        Export 
                        <img className="export-img" src="src/components/modules/Images/ExportButton.png" width="10px"></img>
                    </button>
                    <button className="close-button" onClick={onClose} aria-label="Close module" >
                        x
                    </button>
                </div>
            </div>

            <div className="notes-tabs-header">
                <div className="notes-tabs-container">
                    {tabs.map((tabName, index) => (
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
                                <span>{tabName}</span>
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
                </div>
            </div>
            <div className="notes-content-container" style={{ height: "100%"}}>
                <Editor
                    height="100%"
                    language="markdown"
                    theme={prefersDark ? 'vs-dark' : 'vs'}
                    value={tabContents[activeTabIndex] ?? ''}
                    onChange={(value) => {
                        const val = value ?? '';
                        setTabContents((prev) => {
                        const next = [...prev];
                        if (activeTabIndex >= next.length) {
                            next.length = activeTabIndex + 1;
                        }
                        next[activeTabIndex] = val;
                        return next;
                        });
                    }}
                    options={{
                        wordWrap: "on",
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true
                    }}
                />

                </div>
        </div>
    )
}