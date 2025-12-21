import { useState, useRef } from 'react';
import './Messages.css';
import './ModuleResize.css';
import { useModuleResize } from './useModuleResize';

interface Message {
    id: string;
    role: 'tutor' | 'student';
    content: string;
    timestamp: string;
}

interface MessagesProps {
    messages?: Message[];
    onClose?: () => void;
    onResize?: (newColSpan: number, newRowSpan: number) => void;
    colSpan?: number;
    rowSpan?: number;
}

export function Messages({ messages, onClose, onResize, colSpan = 1, rowSpan = 1 }: MessagesProps) {
    const defaultMessages: Message[] = messages || [
        {
            id: '1',
            role: 'tutor',
            content: 'Hello! How can I help you today?',
            timestamp: '10:30 AM',
        },
        {
            id: '2',
            role: 'student',
            content: 'I need help understanding this concept.',
            timestamp: '10:32 AM',
        },
        {
            id: '3',
            role: 'tutor',
            content: 'Of course! Let me explain it step by step.',
            timestamp: '10:33 AM',
        },
        {
            id: '4',
            role: 'student',
            content: "Thanks! Could you give me an example?",
            timestamp: '10:34 AM',
        },
        {
            id: '5',
            role: 'tutor',
            content: "Absolutely! Let me show you an example that makes it clearer.",
            timestamp: '10:35 AM',
        },
        {
            id: '6',
            role: 'tutor',
            content: "Suppose we have a function f(x) = x^2. To find its derivative, we use the power rule.",
            timestamp: '10:35 AM',
        },
        {
            id: '7',
            role: 'student',
            content: "Oh, so the derivative would be 2x?",
            timestamp: '10:36 AM',
        },
        {
            id: '8',
            role: 'tutor',
            content: "Exactly! Great job. Let me know if you have any more questions.",
            timestamp: '10:37 AM',
        },
    ];

    const [currentIndex, setCurrentIndex] = useState(0);
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
    }
    
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
                            {currentIndex + 1} / {defaultMessages.length}
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
                </div>
                <button className="close-button" onClick={onClose} aria-label="Close module">
                    x
                </button>
            </div>
            <div className="messages-content" ref={scrollContainerRef}>
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