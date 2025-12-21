import { useState, useRef, useEffect } from 'react';

interface UseModuleResizeProps {
    colSpan: number;
    rowSpan: number;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    maxColSpan?: number;
    maxRowSpan?: number;
}

export function useModuleResize({
    colSpan,
    rowSpan,
    onResize,
    maxColSpan = 3,
    maxRowSpan = 2,
}: UseModuleResizeProps) {
    const [isResizing, setIsResizing] = useState(false);
    const [resizeDirection, setResizeDirection] = useState<'right' | 'down' | 'corner' | null>(null);
    const moduleRef = useRef<HTMLDivElement>(null);
    const startResizePos = useRef<{ x: number; y: number; colSpan: number; rowSpan: number } | null>(null);

    const handleResizeStart = (e: React.MouseEvent, direction: 'right' | 'down' | 'corner') => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        setResizeDirection(direction);
        startResizePos.current = {
            x: e.clientX,
            y: e.clientY,
            colSpan,
            rowSpan,
        };
    };

    const onResizeRef = useRef(onResize);
    useEffect(() => {
        onResizeRef.current = onResize;
    }, [onResize]);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!startResizePos.current || !moduleRef.current) return;

            let workspaceContainer = moduleRef.current;
            while (workspaceContainer && !workspaceContainer.classList.contains('workspace')) {
                workspaceContainer = workspaceContainer.parentElement as HTMLDivElement;
            }

            if (!workspaceContainer) return;

            const containerRect = workspaceContainer.getBoundingClientRect();
            const styles = window.getComputedStyle(workspaceContainer);
            const paddingLeft = parseFloat(styles.paddingLeft);
            const paddingRight = parseFloat(styles.paddingRight);
            const columnGap = parseFloat(styles.columnGap) || 0;
            const paddingTop = parseFloat(styles.paddingTop);
            const paddingBottom = parseFloat(styles.paddingBottom);
            const rowGap = parseFloat(styles.rowGap) || 0;

            const usableWidth = containerRect.width - paddingLeft - paddingRight - (columnGap * (maxColSpan - 1));
            const gridColumnWidth = usableWidth / maxColSpan;

            const usableHeight = containerRect.height - paddingTop - paddingBottom - rowGap;
            const gridRowHeight = usableHeight / maxRowSpan;

            let newColSpan = startResizePos.current.colSpan;
            let newRowSpan = startResizePos.current.rowSpan;

            if (resizeDirection === 'right' || resizeDirection === 'corner') {
                const deltaX = e.clientX - startResizePos.current.x;
                const columnsMoved = deltaX / gridColumnWidth;

                let newColumns;
                if (deltaX > 0) {
                    newColumns = Math.max(0, Math.floor(columnsMoved));
                } else {
                    newColumns = Math.min(0, Math.floor(columnsMoved));
                }
                newColSpan = Math.max(1, Math.min(maxColSpan, startResizePos.current.colSpan + newColumns));
            }

            if (resizeDirection === 'down' || resizeDirection === 'corner') {
                const deltaY = e.clientY - startResizePos.current.y;
                const rowsMoved = deltaY / gridRowHeight;

                let newRows;
                if (deltaY > 0) {
                    newRows = Math.max(0, Math.floor(rowsMoved));
                } else {
                    newRows = Math.min(0, Math.floor(rowsMoved));
                }
                newRowSpan = Math.max(1, Math.min(maxRowSpan, startResizePos.current.rowSpan + newRows));
            }

            if (newColSpan !== startResizePos.current.colSpan || newRowSpan !== startResizePos.current.rowSpan) {
                onResizeRef.current?.(newColSpan, newRowSpan);
                startResizePos.current = {
                    x: e.clientX,
                    y: e.clientY,
                    colSpan: newColSpan,
                    rowSpan: newRowSpan,
                };
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            setResizeDirection(null);
            startResizePos.current = null;
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, resizeDirection, maxColSpan, maxRowSpan]);

    const resizeHandles = {
        right: colSpan >= 1,
        bottom: rowSpan >= 1, 
        corner: true, 
    };

    return {
        moduleRef,
        handleResizeStart,
        resizeHandles,
    };
}

