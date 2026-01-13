import { useEffect, useState, useRef } from 'react';
import './Code.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';
import { apiClient } from '../../services/apiClient';
import type { DiffLine } from '../../types';

interface CodeProps {
    codes?: string;
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
    messageIndex?: number;
}

export function Code({ codes, onClose, onResize, colSpan = 1, rowSpan = 1, messageIndex }: CodeProps) {
    const [codeContent, setCodeContent] = useState<string>('');
    const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const prevMessageIndexRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (codes && typeof codes === 'string') {
            setCodeContent(codes);
            setDiffLines(null);
            return;
        }

        if (messageIndex !== undefined) {
            setLoading(true);
            setError(null);

            const prevIndex = prevMessageIndexRef.current;
            prevMessageIndexRef.current = messageIndex;

            if (prevIndex !== undefined && prevIndex !== messageIndex) {
                Promise.all([
                    apiClient.getCode(messageIndex),
                    apiClient.getDiff(prevIndex, messageIndex)
                ])
                    .then(([codeData, diffData]) => {
                        setCodeContent(codeData.codeContent);
                        setDiffLines(diffData.diff);
                        console.log('Diff data:', diffData.diff);
                        console.log('Diff types:', diffData.diff.map(d => d.type));
                        setLoading(false);
                    })
                    .catch((error) => {
                        console.warn('Diff fetch failed, falling back to code only:', error.message);
                        apiClient.getCode(messageIndex)
                            .then((data) => {
                                setCodeContent(data.codeContent);
                                setDiffLines(null);
                                setLoading(false);
                            })
                            .catch((codeError) => {
                                setError(codeError.message);
                                setLoading(false);
                                setCodeContent('');
                                setDiffLines(null);
                            });
                    });
            } else {
                apiClient.getCode(messageIndex)
                    .then((data) => {
                        setCodeContent(data.codeContent);
                        setDiffLines(null);
                        setLoading(false);
                    })
                    .catch((error) => {
                        setError(error.message);
                        setLoading(false);
                        setCodeContent('');
                        setDiffLines(null);
                    });
            }
        }
    }, [messageIndex, codes]);

    const linesToDisplay = diffLines !== null
        ? diffLines
        : codeContent.split('\n').map((content, index) => ({
            type: 'unchanged' as const,
            line: index + 1,
            originalLine: index + 1,  // For unchanged lines, original equals current
            content
        }));

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
                {loading && (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#6A737D' }}>
                        Loading...
                    </div>
                )}
                {error && (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#f85149' }}>
                        Error: {error}
                    </div>
                )}
                {!loading && !error && (
                    <div className="code-lines">
                        {linesToDisplay.map((diffLine, index) => (
                            <div
                                key = {index}
                                className={`code-line code-line-${diffLine.type}`}
                            >
                                <span className="line-number line-number-original">
                                    {diffLine.type === 'added'
                                        ? '+'
                                        : diffLine.type === 'removed'
                                        ? diffLine.originalLine
                                        : diffLine.originalLine || diffLine.line
                                    }
                                </span>
                                <span className="line-number line-number-current">
                                    {diffLine.type === 'removed'
                                        ? '-'
                                        : diffLine.line
                                    }
                                </span>
                                <span className="line-content">{diffLine.content || ' '}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}