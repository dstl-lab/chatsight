import { useState, useRef, useEffect } from 'react';
import './Messages.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';

interface Message {
    id: string;
    role: 'tutor' | 'student';
    content: string;
    timestamp: string;
}

interface FileMessageRow {
    id: number;
    role: string | null;
    content: string;
    timestamp: string | null;
    sortOrder: number;
}

interface MessagesProps {
    conversationId: number | null;
    sharedMessages?: FileMessageRow[];
    messages?: Message[];
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
    currentIndex?: number;
    onIndexChange?: (index: number) => void;
}

function dbRoleToMessageRole(role: string | null): 'tutor' | 'student' {
    if (!role) return 'tutor';
    const r = role.toLowerCase();
    if (r === 'student' || r === 'student:' || r === '----student') return 'student';
    return 'tutor';
}

export function Messages({ conversationId, sharedMessages, messages: messagesProp, onClose, onResize, colSpan = 1, rowSpan = 1, currentIndex: externalIndex, onIndexChange }: MessagesProps) {
    // Filter out Code messages; show only Student and Tutor
    const convertedMessages: Message[] = (sharedMessages ?? [])
        .filter((row) => row.role?.toLowerCase() !== 'code')
        .map((row) => ({
            id: String(row.id),
            role: dbRoleToMessageRole(row.role),
            content: row.content,
            timestamp: row.timestamp ?? '',
        }));

    const loading = conversationId != null && sharedMessages === undefined;

    const defaultMessages: Message[] =
        messagesProp ?? convertedMessages;

    const[localIndex, setLocalIndex] = useState(0);
    const currentIndex = externalIndex !== undefined ? externalIndex : localIndex;
    const setCurrentIndex = onIndexChange || setLocalIndex;
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<(HTMLDivElement | null)[]>([]);

    const scrollToMessage = (index: number) => {
        const messageElement = messageRefs.current[index];
        if (messageElement && scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const messageTop = messageElement.offsetTop;
            const containerHeight = container.clientHeight;
            const messageHeight = messageElement.offsetHeight;

            const scrollPosition = messageTop - (containerHeight / 2) + (messageHeight / 2);

            container.scrollTo({
                top: scrollPosition,
                behavior: 'smooth',
            });
        }
    };

    const handleMessageClick = (index: number) => {
        setCurrentIndex(index);
        scrollToMessage(index);
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            const newIndex = currentIndex - 1;
            setCurrentIndex(newIndex);
            scrollToMessage(newIndex);
        }
    };

    const handleNext = () => {
        if (currentIndex < defaultMessages.length - 1) {
            const newIndex = currentIndex + 1;
            setCurrentIndex(newIndex);
            scrollToMessage(newIndex);
        }
    };

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.metaKey && event.key == 'j') {
                event.preventDefault()
                handlePrev()
            } else if (event.metaKey && event.key == 'k') {
                event.preventDefault()
                handleNext()
            }
        }

        window.addEventListener('keydown', handleKey)
        return () => window.removeEventListener('keydown', handleKey)
    })
    
    const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({ 
        colSpan, 
        rowSpan,
        onResize,
    });

    return (
        <div className="messages-module" ref={moduleRef}>
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
                    <h3 className="module-title">Messages</h3>
                    {!conversationId && (
                        <span className="messages-hint">Select a conversation</span>
                    )}
                    {conversationId && loading && (
                        <span className="messages-hint">Loading…</span>
                    )}
                    {conversationId && !loading && (
                        <div className="navigation">
                            <button 
                                className="nav-button prev-button"
                                onClick={handlePrev}
                                disabled={currentIndex === 0}
                                aria-label="Previous message"
                            >
                                ←
                            </button>
                            <span className="message-counter">
                                {defaultMessages.length === 0
                                    ? '0'
                                    : `${currentIndex + 1} / ${defaultMessages.length}`}
                            </span>
                            <button
                                className="nav-button next-button"
                                onClick={handleNext}
                                disabled={currentIndex === defaultMessages.length - 1}
                                aria-label="Next message"
                            >
                                →
                            </button>
                        </div>
                    )}
                </div>
                <button className="close-button" onClick={onClose} aria-label="Close module">
                    x
                </button>
            </div>
            <div className="messages-content" ref={scrollContainerRef}>
                {defaultMessages.length === 0 && !loading && conversationId && (
                    <div className="messages-empty">No messages in this conversation.</div>
                )}
                {defaultMessages.map((message, index) => (
                    <div
                        key={message.id}
                        ref={(el: HTMLDivElement | null) => {
                            messageRefs.current[index] = el;
                        }}
                        onClick={() => handleMessageClick(index)}
                        className={`message-bubble ${message.role} ${
                            index === currentIndex ? 'active' : ''
                        }`}
                    >
                        <div className="messages-role">
                            {message.role === 'tutor' ? 'TUTOR' : 'STUDENT'}
                        </div>
                        <div className="messages-text">{message.content}</div>
                        <div className="messages-timestamp">{message.timestamp}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}