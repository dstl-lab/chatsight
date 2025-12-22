import { useRef, useEffect } from 'react';
import './Code.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';

interface CodeProps {
    codes?: string;
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
    messageIndex?: number;
}

export function Code({ codes, onClose, onResize, colSpan = 1, rowSpan = 1, messageIndex }: CodeProps) {
    const defaultCodeArray = [
        {
            id: '1',
            content: "print('Hello world')",
        },
        {
            id: '2',
            content: "def add(a, b): \n    return a + b"
        }
    ];

    const currentCodeId = messageIndex !== undefined ? String(messageIndex + 1) : '1';
    const selectedCode = defaultCodeArray.find(item => item.id === currentCodeId);

    const codeString = typeof codes === 'string'
        ? codes
        : (selectedCode?.content || defaultCodeArray[0].content);  
    const codeLines = codeString.split('\n');

    const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({
        colSpan,
        rowSpan,
        onResize,
    });
    
    return (
        <div className="code-module" ref={moduleRef}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 className="module-title">Code</h3>
                </div>
                <button className="close-button" onClick={onClose} aria-label="Close module">
                    x
                </button>
            </div>
            <div className="code-content">
                <div className="code-lines">
                    {codeLines.map((line, index) => (
                        <div key={index} className="code-line">
                            <span className="line-number">{index + 1}</span>
                            <span className="line-content">{line || ' '}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}