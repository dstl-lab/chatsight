import { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import './Code.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';
import type { DiffLine } from '../../../shared/types';

interface CodeProps {
    studentMessageId?: number | null;
    codes?: string;
    previousCodes?: string;
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
}

function computeDiffLines(oldCode: string, newCode: string): DiffLine[] {
    const changes = diffLines(oldCode, newCode);
    const diff: DiffLine[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;

    changes.forEach((part) => {
        const lines = part.value.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        lines.forEach((line) => {
            if (part.added) {
                diff.push({
                    type: 'added',
                    line: newLineNum++,
                    content: line,
                });
            } else if (part.removed) {
                diff.push({
                    type: 'removed',
                    line: newLineNum,
                    originalLine: oldLineNum++,
                    content: line,
                });
            } else {
                diff.push({
                    type: 'unchanged',
                    line: newLineNum++,
                    originalLine: oldLineNum++,
                    content: line,
                });
            }
        });
    });
    return diff;
}

export function Code({
    studentMessageId,
    codes,
    previousCodes,
    onClose,
    onResize,
    colSpan = 1,
    rowSpan = 1,
}: CodeProps) {
    const [codeContent, setCodeContent] = useState('');

    const diffLines = useMemo<DiffLine[] | null>(() => {
        if (codes === undefined) return null;
        if (
            previousCodes !== undefined &&
            previousCodes !== '' &&
            codes !== previousCodes
        ) {
            return computeDiffLines(previousCodes, codes);
        }
        return null;
    }, [codes, previousCodes]);

    useEffect(() => {
        if (codes !== undefined) {
            setCodeContent(codes);
        } else {
            setCodeContent('');
        }
    }, [codes, studentMessageId]);

    const linesToDisplay =
        diffLines !== null && diffLines.length > 0
            ? diffLines
            : codeContent
                  .split('\n')
                  .map((content, index) => ({
                      type: 'unchanged' as const,
                      line: index + 1,
                      originalLine: index + 1,
                      content,
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
                {!codeContent && (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#6A737D' }}>
                        No code attached to this message.
                    </div>
                )}
                {codeContent && (
                    <div className="code-lines">
                        {linesToDisplay.map((diffLine, index) => (
                            <div
                                key={index}
                                className={`code-line code-line-${diffLine.type}`}
                            >
                                <span className="line-number line-number-original">
                                    {diffLine.type === 'added'
                                        ? '+'
                                        : diffLine.type === 'removed'
                                          ? diffLine.originalLine
                                          : diffLine.originalLine ?? diffLine.line}
                                </span>
                                <span className="line-number line-number-current">
                                    {diffLine.type === 'removed'
                                        ? '-'
                                        : diffLine.line}
                                </span>
                                <span className="line-content">{diffLine.content || ' '}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
