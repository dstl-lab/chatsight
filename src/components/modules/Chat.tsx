import "./Chat.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { useState, useRef, useEffect } from "react";

interface Message {
	id?: number;
	role: "user" | "assistant";
	content: string;
	timestamp?: string;
	created_at?: string;
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
	const [isLoading, setIsLoading] = useState(false);
	const { moduleRef, handleResizeStart, resizeHandles } = useModuleResize({
		colSpan,
		rowSpan,
		onResize,
	});
	const [conversationId, setConversationId] = useState<number | null>(null);
	const CONVERSATION_ID = 2;

	useEffect(() => {
		const loadMessages = async () => {
			try {
				const res = await fetch(
					`http://localhost:8000/conversations/${CONVERSATION_ID}/messages`,
				);
				if (res.ok) {
					const msgs = await res.json();
					setMessages(
						msgs.map((m: any) => ({
							id: m.id,
							role: m.role,
							content: m.content,
							timestamp: m.created_at,
						})),
					);
				}
			} catch (error) {
				console.error("Failed to load messages:", error);
			}
		};

		loadMessages();
	}, []); // Empty dependency array = runs once on mount

	const handleSend = async () => {
		if (!input.trim()) return;

		const userMessage = {
			role: "user",
			content: input,
		};

		// Add user message to UI immediately (optimistic update)
		const tempUserMessage = {
			id: Date.now(), // Temporary ID
			role: "user" as const,
			content: input,
			timestamp: new Date().toISOString(),
		};

		setMessages((prev) => [...prev, tempUserMessage]);
		setInput("");
		setIsLoading(true);

		try {
			const res = await fetch(
				`http://localhost:8000/conversations/${CONVERSATION_ID}/messages`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(userMessage),
				},
			);

			if (!res.ok) {
				console.error("Server error:", await res.text());
				// Remove the optimistic message on error
				setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
				return;
			}

			const returnedMessages = await res.json();

			// Replace temp user message with real ones from backend
			setMessages((prev) => {
				// Remove the temporary message
				const withoutTemp = prev.filter((m) => m.id !== tempUserMessage.id);
				// Add the real messages from backend
				return [
					...withoutTemp,
					...returnedMessages.map((m: any) => ({
						id: m.id,
						role: m.role,
						content: m.content,
						timestamp: m.created_at,
					})),
				];
			});
		} catch (error) {
			console.error("Failed to send message:", error);
			// Remove the optimistic message on error
			setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
		} finally {
			setIsLoading(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const formatTimestamp = (timestamp: string): string => {
		const date = new Date(timestamp);
		let hours = date.getHours();
		const minutes = date.getMinutes().toString().padStart(2, "0");
		const ampm = hours >= 12 ? "PM" : "AM";
		hours = hours % 12 || 12; // Convert to 12-hour format
		return `${hours}:${minutes} ${ampm}`;
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
						<div className="messages-timestamp">
							{message.timestamp ? formatTimestamp(message.timestamp) : ""}
						</div>
					</div>
				))}
				{isLoading && (
					<div>
						<div className="messages-role">CHATSIGHT</div>
						<div className="messages-text">Typing...</div>
					</div>
				)}
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
						disabled={!input.trim() || isLoading}
					>
						{isLoading ? "..." : "➤"}
					</button>
				</div>
			</div>
		</div>
	);
}
