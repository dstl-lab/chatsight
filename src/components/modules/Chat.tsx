import "./Chat.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { useState, useRef, useEffect } from "react";

interface Message {
	id?: number;
	role: "user" | "assistant";
	content: string;
	timestamp: string;
}

interface ChatProps {
	// messages?: Message[];
	onClose?: () => void;
	onResize?: (newColSpan: number, newRowSpan: number) => void;
	colSpan?: number;
	rowSpan?: number;
}

export function Chat({
	onClose,
	onResize,
	colSpan = 1,
	rowSpan = 1,
}: ChatProps) {
	const [messages, setMessages] = useState<Message[]>([]);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
	const [input, setInput] = useState("");
	const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({
		colSpan,
		rowSpan,
		onResize,
	});
	const [conversationId, setConversationId] = useState<number | null>(null);

	const CONVERSATION_ID = 1;

	const handleSend = async () => {
		if (!input.trim()) return;
		const userMessage = {
			role: "user",
			content: input,
			timestamp: new Date().toISOString(),
		};

		const res = await fetch(
			`http://localhost:8000/conversations/${CONVERSATION_ID}/messages`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(userMessage),
			},
		);

		const returnedMessages = await res.json();

		setMessages((prev) => [
			...prev,
			...returnedMessages.map((m: any) => ({
				id: m.id,
				role: m.role,
				content: m.content,
				timestamp: m.timestamp,
			})),
		]);
		// setMessages((prev) => [...prev, savedMessage]);
		setInput("");
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="chat-module" ref={moduleRef}>
			{resizeHandles.right && (
				<div
					className="resize-handle resize-handle-right"
					onMouseDown={(e) => handleResizeStart(e, "right")}
				/>
			)}
			{resizeHandles.bottom && (
				<div
					className="resize-handle resize-handle-bottom"
					onMouseDown={(e) => handleResizeStart(e, "down")}
				/>
			)}
			{resizeHandles.corner && (
				<div
					className="resize-handle resize-handle-corner"
					onMouseDown={(e) => handleResizeStart(e, "corner")}
				/>
			)}
			<div className="module-header">
				<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
					<h3 className="module-title">Chatbox</h3>
					<div className="navigation"></div>
				</div>
				<button
					className="close-button"
					onClick={onClose}
					aria-label="Close module"
				>
					x
				</button>
			</div>
			<div className="messages-content" ref={scrollContainerRef}>
				{messages.map((message, index) => (
					<div
						key={message.id}
						ref={(el: HTMLDivElement | null) => {
							messageRefs.current[index] = el;
						}}
					>
						<div className="messages-role">
							{message.role === "user" ? "USER" : "CHATSIGHT"}
						</div>
						<div className="messages-text">{message.content}</div>
						<div className="messages-timestamp">{message.timestamp}</div>
					</div>
				))}
			</div>

			<div className="input-area">
				<div className="input-box">
					<textarea
						className="box"
						rows={1}
						placeholder="Ask Chatsight about this file..."
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
					<button
						className="send-button"
						onClick={handleSend}
						disabled={!input.trim()}
					>
						➤
					</button>
				</div>
			</div>
		</div>
	);
}
