import { useRef } from 'react';
import './Code.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';

interface Code {
    id: string;
    content: string;
}

interface CodeProps {
    codes?: Code[];
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
}

export function Code({ codes, onClose, onResize, colSpan = 1, rowSpan = 1 }: CodeProps) {
    const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({
        colSpan,
        rowSpan,
        onResize,
    });
    
    return (
        <div className="code-module" ref={moduleRef}>
            <div className="module-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 className="module-title">Code</h3>
                </div>
                <button className="close-button" onClick={onClose} aria-label="Close module">
                    x
                </button>
            </div>
            <div className="code-content"></div>
        </div>
    )
}