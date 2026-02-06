import "./Chat.css";
import "./ModuleResize.css";
import { useModuleResize } from "./useModuleResize";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

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

	// Conversation management
	const [conversations, setConversations] = useState<number[]>([1, 2]); // List of conversation IDs
	const [activeConversationId, setActiveConversationId] = useState<number>(1);

	// Load messages when active conversation changes
	useEffect(() => {
		const loadMessages = async () => {
			try {
				const res = await fetch(
					`http://localhost:8000/conversations/${activeConversationId}/messages`,
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
	}, [activeConversationId]); // Reload when conversation changes

	const handleSend = async () => {
		if (!input.trim()) return;

		const userMessage = {
			role: "user",
			content: input,
		};

		const tempUserMessage = {
			id: Date.now(),
			role: "user" as const,
			content: input,
			timestamp: new Date().toISOString(),
		};

		setMessages((prev) => [...prev, tempUserMessage]);
		setInput("");
		setIsLoading(true);

		try {
			const res = await fetch(
				`http://localhost:8000/conversations/${activeConversationId}/messages`, // Use active conversation
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(userMessage),
				},
			);

			if (!res.ok) {
				console.error("Server error:", await res.text());
				setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
				return;
			}

			const returnedMessages = await res.json();

			console.log("=== RETURNED MESSAGES ===");
			console.log(returnedMessages);
			if (Array.isArray(returnedMessages)) {
				returnedMessages.forEach((m: any, index: number) => {
					if (m) {
						console.log(
							`${index}: ID=${m.id}, Role=${m.role}, Content=${m.content?.substring(0, 30) || "NO CONTENT"}`,
						);
					} else {
						console.log(`${index}: UNDEFINED MESSAGE`);
					}
				});
			}

			setMessages((prev) => {
				const withoutTemp = prev.filter((m) => m.id !== tempUserMessage.id);
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
			setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
		} finally {
			setIsLoading(false);
		}
	};

	const createNewConversation = async () => {
		try {
			const res = await fetch("http://localhost:8000/conversations/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: `Conversation ${conversations.length + 1}`,
				}),
			});

			if (!res.ok) {
				const errorText = await res.text();
				console.error("Failed to create conversation:", errorText);
				return;
			}

			const newConv = await res.json();
			console.log("Created conversation:", newConv);
			setConversations((prev) => [...prev, newConv.id]);
			setActiveConversationId(newConv.id);
		} catch (error) {
			console.error("Failed to create conversation:", error);
		}
	};

	const deleteConversation = async (convId: number) => {
		if (!confirm(`Delete Chat ${convId}?`)) return;

		try {
			const res = await fetch(`http://localhost:8000/conversations/${convId}`, {
				method: "DELETE",
			});

			if (res.ok) {
				// Remove from conversations list
				setConversations((prev) => prev.filter((id) => id !== convId));

				// If we deleted the active conversation, switch to another
				if (activeConversationId === convId) {
					const remaining = conversations.filter((id) => id !== convId);
					if (remaining.length > 0) {
						setActiveConversationId(remaining[0]);
					}
				}
			}
		} catch (error) {
			console.error("Failed to delete conversation:", error);
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
		hours = hours % 12 || 12;
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

			{/* Conversation Tabs */}
			<div className="conversation-tabs">
				{conversations.map((convId) => (
					<div key={convId} className="tab-wrapper">
						<button
							className={`tab ${activeConversationId === convId ? "active" : ""}`}
							onClick={() => setActiveConversationId(convId)}
						>
							Chat {convId}
						</button>
						{conversations.length > 1 && (
							<button
								className="delete-tab-btn"
								onClick={(e) => {
									e.stopPropagation();
									deleteConversation(convId);
								}}
								aria-label="Delete conversation"
							>
								×
							</button>
						)}
					</div>
				))}
				<button
					key="new-conversation"
					className="tab new-tab"
					onClick={createNewConversation}
				>
					+
				</button>
			</div>
			<div className="messages-content" ref={scrollContainerRef}>
				{messages.map((message, index) => (
					<div
						key={message.id || `message-${index}`}
						className={`message-wrapper ${message.role === "user" ? "user-message" : "assistant-message"}`}
						ref={(el: HTMLDivElement | null) => {
							messageRefs.current[index] = el;
						}}
					>
						<div className="messages-role">
							{message.role === "user" ? "USER" : "CHATSIGHT"}
						</div>
						<div className="messages-text">
							<ReactMarkdown>{message.content}</ReactMarkdown>
						</div>
						<div className="messages-timestamp">
							{message.timestamp ? formatTimestamp(message.timestamp) : ""}
						</div>
					</div>
				))}
				{isLoading && (
					<div
						key="typing-indicator"
						className="message-wrapper assistant-message"
					>
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
