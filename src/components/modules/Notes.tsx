// when shrinking the module, the header becomes longer, throwing off the spacing for the text and the lines

import { useState } from 'react';
import './Notes.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';
import exportButton from '../../assets/ExportButton.png';


interface NotesProps {
    codes?: string;
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
    messageIndex?: number;
    numberOfLines?: number;
}

export function Notes({ onClose, onResize, colSpan = 1, rowSpan = 1, }: NotesProps) {
    const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({ 
        colSpan, 
        rowSpan,
        onResize,
    });

    const [tabs, setTabs] = useState(['tab1']);
    const[tabCounter, setTabCounter] = useState(2);

    const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
    const [editingTabName, setEditingTabName] = useState('');

    const [activeTabIndex, setActiveTabIndex] = useState(0);
    const [tabContents, setTabContents] = useState(['']);


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
        const newTabs = tabs.filter((_, i) => i !== index);
        setTabs(newTabs);
        const newTabContents = tabContents.filter((_, i) => i !== index);
        setTabContents(newTabContents);
        if (activeTabIndex === index) {
            setActiveTabIndex(0);
        }
    };

    const handleTabAdd = () => {
        const newTabs = [...tabs, `tab${tabCounter}`];
        setTabs(newTabs);
        setTabCounter(tabCounter + 1);
        if (tabCounter === 99) {
            setTabCounter(1)
        }
    }

    const handleTabClick = (index: number) => {
        const textarea = moduleRef.current?.querySelector('.notes-textarea') as HTMLTextAreaElement;
        
        if (textarea) {
            // Save current tab's content before switching
            const newTabContents = [...tabContents];
            newTabContents[activeTabIndex] = textarea.value;
            setTabContents(newTabContents);
            setActiveTabIndex(index);
            textarea.value = newTabContents[index] || '';
        }
    }

    const handleExport = () => {
        const textarea = moduleRef.current?.querySelector('.notes-textarea') as HTMLTextAreaElement;
        const content = textarea?.value || '';
        
        // Create a blob with the notes content
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        // Create a download link and trigger it
        const link = document.createElement('a');
        link.href = url;
    link.download = `${tabs[activeTabIndex]}-${new Date().toISOString().slice(0, 10)}.txt`; /* maybe change file name to include name of tab? */
        link.click();
        
        // Clean up
        URL.revokeObjectURL(url);
    };

    return (
        <div className = "notes-module" ref={moduleRef}>
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
                </div>

                <div style={{display: 'flex', alignItems: 'right', gap: '10px'}}>
                    <button
                        className="export-button"
                        onClick={handleExport}
                    >
                        Export 
                        <img className="export-img" src={exportButton} alt="export" width="10px" />
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
                        >
                            {editingTabIndex === index ? (
                                <input
                                    type="text"
                                    className="notes-tab-input"
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
                            <button 
                                className="notes-tabs-exit"
                                onClick={(e) => { e.stopPropagation(); handleTabDelete(index); }}>
                                X
                            </button>
                        </button>
                    ))}
                </div>
                <button className="notes-new-tabs" onClick={() => handleTabAdd()} aria-label="Close module">
                    +
                </button>
            </div>
            <textarea className="notes-textarea" placeholder="Write your notes here..." ></textarea>
        </div>
    )
}