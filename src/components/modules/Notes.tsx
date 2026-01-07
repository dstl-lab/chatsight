// when shrinking the module, the header becomes longer, throwing off the spacing for the text and the lines

import { useEffect, useState } from 'react';
import './Notes.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';

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

    const [createLines, setCreateLines] = useState<React.ReactNode[]>([]);

    useEffect(() => {
        const moduleHeight = moduleRef?.current?.offsetHeight;
        const lineHeight = 1.5;
        const lineSpacing = 10;
        const totalLineHeight = lineHeight + lineSpacing;
        const numberOfLines = moduleHeight? Math.floor(moduleHeight / totalLineHeight) : 0;

        const lines = [];
        for (let i = 0; i < numberOfLines; i++) {
            lines.push(<div key={i} className="notes-line"></div>);
        }
        setCreateLines(lines);
    }, [colSpan, rowSpan]);


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
                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <h3 className="module-title">Notes</h3>
                </div>

                <div style={{display: 'flex', alignItems: 'right', gap: '10px'}}>
                    <button
                        className="export-button"
                    >
                        Export 
                        <img className="export-img" src="src/components/modules/Images/ExportButton.png" width="10px"></img>
                    </button>
                    <button className="close-button" onClick={onClose} aria-label="Close module" >
                        x
                    </button>
                </div>

            </div>
            <textarea className="notes-textarea" placeholder="Write your notes here..."></textarea>
            <>
                {createLines}
            </>
            <div className = "dropdown">
                <button className = "dropdown-button">Files</button>      // later change to whatever file name is created
                <div className="dropdown-content">
                    <a href="">File 1</a>
                    <a href="">File 2</a>
                    <a href="">File 3</a>
                </div>
            </div>
        </div>
    )
}