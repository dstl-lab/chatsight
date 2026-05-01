import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { MessageSquare } from "lucide-react";
import type {
	QueueItem,
	SuggestResponse,
	LabelDefinition,
	ConversationMessage,
} from "../../types";
import { ConversationPanel } from "./ConversationPanel";

function stripMarkdown(md: string): string {
	return md
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/#{1,6}\s+/g, "")
		.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
		.replace(/~~([^~]+)~~/g, "$1")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+\.\s+/gm, "")
		.replace(/^\s*>\s+/gm, "")
		.replace(/\n{2,}/g, " ")
		.replace(/\n/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function truncateAtWord(
	text: string,
	maxLen: number,
	end: "head" | "tail",
): string {
	if (text.length <= maxLen) return text;

	if (end === "head") {
		const slice = text.slice(0, maxLen);
		const lastSpace = slice.lastIndexOf(" ");
		return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "...";
	} else {
		const slice = text.slice(-maxLen);
		const firstSpace = slice.indexOf(" ");
		return "..." + (firstSpace >= 0 ? slice.slice(firstSpace + 1) : slice);
	}
}

interface Props {
	item: QueueItem;
	aiUnlocked: boolean;
	suggestion: SuggestResponse | null;
	suggestionLoading?: boolean;
	onSkip: () => void;
	onNext: () => void;
	onBack?: () => void;
	canGoBack?: boolean;
	onForward?: () => void;
	isBackNav?: boolean;
	hasLabelsApplied: boolean;
	isReviewing?: boolean;
	isRecalibrating?: boolean;
	recalibrationPhase?: 'blind' | 'reconcile' | null;
	labels?: LabelDefinition[];
	appliedLabelIds?: Set<number>;
	onToggleLabel?: (labelId: number) => void;
	onApplySuggestionAndNext?: (labelId: number) => void;
	conversationMessages?: ConversationMessage[];
	conversationLoading?: boolean;
	conversationError?: boolean;
	showConversation?: boolean;
	onToggleConversation?: () => void;
	onSelectConversationMessage?: (chatlogId: number, messageIndex: number) => void;
}

export function MessageCard({
	item,
	aiUnlocked,
	suggestion,
	suggestionLoading,
	onSkip,
	onNext,
	onBack,
	canGoBack,
	onForward,
	isBackNav,
	hasLabelsApplied,
	isReviewing,
	isRecalibrating,
	recalibrationPhase,
	labels,
	appliedLabelIds,
	onToggleLabel,
	onApplySuggestionAndNext,
	conversationMessages,
	conversationLoading,
	conversationError,
	showConversation,
	onToggleConversation,
	onSelectConversationMessage,
}: Props) {
	const [showRationale, setShowRationale] = useState(false);
	const [beforeExpanded, setBeforeExpanded] = useState(false);
	const [afterExpanded, setAfterExpanded] = useState(false);

	const suggestionLabelId =
		suggestion && labels
			? labels.find((l) => l.name === suggestion.label_name)?.id
			: undefined;
	const isSuggestionApplied =
		suggestionLabelId !== undefined &&
		(appliedLabelIds?.has(suggestionLabelId) ?? false);

	function handleApplySuggestion() {
		if (!suggestion || !labels || !onToggleLabel) return;
		const match = labels.find((l) => l.name === suggestion.label_name);
		if (match) onToggleLabel(match.id);
	}

	return (
		<div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
			{isReviewing && (
				<div className="bg-warning-surface border border-warning-border rounded px-3 py-2">
					<span className="text-[10px] text-warning uppercase tracking-wide">
						Reviewing previous message
					</span>
				</div>
			)}
			{item.context_before && (
				<div
					className="bg-surface/70 border-l-2 border-edge-strong rounded px-4 py-3 cursor-pointer group"
					onClick={() => setBeforeExpanded((v) => !v)}
				>
					<span className="text-[10px] uppercase tracking-wide text-faint block mb-2">
						Preceding AI response
						<span className="ml-2 text-disabled group-hover:text-muted transition-colors">
							{beforeExpanded ? "▾ collapse" : "▸ expand"}
						</span>
					</span>
					{beforeExpanded ? (
						<div className="prose prose-sm dark:prose-invert prose-p:text-tertiary prose-headings:text-on-surface prose-li:text-tertiary prose-strong:text-on-surface prose-code:text-accent-muted max-w-none text-tertiary leading-relaxed">
							<ReactMarkdown
								remarkPlugins={[remarkMath]}
								rehypePlugins={[rehypeKatex]}
							>
								{item.context_before}
							</ReactMarkdown>
						</div>
					) : (
						<p className="text-sm text-muted leading-relaxed italic">
							{truncateAtWord(stripMarkdown(item.context_before), 200, "tail")}
						</p>
					)}
				</div>
			)}

			<div className="bg-[#0d1f33] border border-message-border rounded-lg p-4">
				<div className="flex items-center justify-between mb-2">
					<span className="text-[10px] uppercase tracking-wide text-accent-text">
						Student · message {item.message_index}
					</span>
					{(conversationLoading ||
						conversationError ||
						(conversationMessages && conversationMessages.length > 0)) && (
						<button
							onClick={() =>
								!conversationLoading &&
								!conversationError &&
								onToggleConversation?.()
							}
							disabled={conversationLoading || conversationError}
							className={`flex items-center gap-1 text-[9px] transition-colors ${
								conversationLoading
									? "text-disabled cursor-default"
									: conversationError
										? "text-faint cursor-default"
										: showConversation
											? "text-accent-on-surface hover:text-accent-on-surface"
											: "text-accent-text hover:text-accent-on-surface"
							}`}
							title={
								conversationError
									? "Conversation unavailable in database"
									: "View full conversation"
							}
						>
							<MessageSquare size={11} />
							<span>
								{conversationError
									? "Conversation unavailable"
									: "View full conversation"}
							</span>
						</button>
					)}
				</div>
				<p className="text-sm text-on-canvas leading-relaxed">
					{item.message_text}
				</p>

				<div className="flex justify-end mt-2">
					{aiUnlocked && suggestionLoading ? (
						<span className="text-[9px] text-accent-text bg-surface border border-accent-border rounded px-1.5 py-0.5 animate-pulse">
							✦ suggesting label...
						</span>
					) : aiUnlocked && suggestion ? (
						<span
							className={`inline-flex items-center gap-0 text-[9px] rounded overflow-hidden border ${
								isSuggestionApplied
									? "bg-accent-surface border-accent-border"
									: "bg-surface border-accent-border"
							}`}
						>
							<button
								onClick={handleApplySuggestion}
								onKeyDown={(e) => {
									if (e.key === "Enter" && suggestionLabelId && onApplySuggestionAndNext) {
										e.preventDefault();
										e.stopPropagation();
										isSuggestionApplied ? onNext() : onApplySuggestionAndNext(suggestionLabelId);
									}
								}}
								className={`px-1.5 py-0.5 transition-colors ${
									isSuggestionApplied
										? "text-accent-on-surface hover:text-blue-100"
										: "text-accent-text hover:text-accent-on-surface"
								}`}
								title="Click to toggle this label"
							>
								✦ {suggestion.label_name}
							</button>
							<button
								onClick={() => setShowRationale((v) => !v)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && suggestionLabelId && onApplySuggestionAndNext) {
										e.preventDefault();
										e.stopPropagation();
										isSuggestionApplied ? onNext() : onApplySuggestionAndNext(suggestionLabelId);
									}
								}}
								className={`px-1.5 py-0.5 transition-colors border-l ${
									isSuggestionApplied
										? "border-blue-700 text-accent-text hover:text-accent-on-surface"
										: "border-accent-border text-accent-muted hover:text-accent-on-surface"
								}`}
							>
								why?
							</button>
						</span>
					) : !aiUnlocked ? (
						<span className="text-[8px] text-disabled bg-surface border border-edge-subtle rounded px-1.5 py-0.5">
							AI unlocks at 20
						</span>
					) : null}
				</div>
			</div>

			{showRationale && suggestion && (
				<div className="border-l-2 border-edge pl-3 py-1">
					<p className="text-[10px] text-muted leading-relaxed">
						<span className="text-disabled">Evidence: </span>
						&ldquo;{suggestion.evidence}&rdquo;
					</p>
					<p className="text-[10px] text-muted leading-relaxed mt-1">
						<span className="text-disabled">Rationale: </span>
						{suggestion.rationale}
					</p>
				</div>
			)}

			{item.context_after && (
				<div
					className="bg-surface/70 border-l-2 border-edge-strong rounded px-4 py-3 cursor-pointer group"
					onClick={() => setAfterExpanded((v) => !v)}
				>
					<span className="text-[10px] uppercase tracking-wide text-faint block mb-2">
						Following AI response
						<span className="ml-2 text-disabled group-hover:text-muted transition-colors">
							{afterExpanded ? "▾ collapse" : "▸ expand"}
						</span>
					</span>
					{afterExpanded ? (
						<div className="prose prose-sm dark:prose-invert prose-p:text-tertiary prose-headings:text-on-surface prose-li:text-tertiary prose-strong:text-on-surface prose-code:text-accent-muted max-w-none text-tertiary leading-relaxed">
							<ReactMarkdown
								remarkPlugins={[remarkMath]}
								rehypePlugins={[rehypeKatex]}
							>
								{item.context_after}
							</ReactMarkdown>
						</div>
					) : (
						<p className="text-sm text-muted leading-relaxed italic">
							{truncateAtWord(stripMarkdown(item.context_after), 200, "head")}
						</p>
					)}
				</div>
			)}

			<div className="flex justify-end gap-2 pt-1">
				{isBackNav ? (
					<>
						<button
							onClick={onBack}
							disabled={!canGoBack}
							className="text-xs text-muted border border-edge rounded px-3 py-1.5 hover:text-on-surface hover:border-edge-strong disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
						>
							← Back
						</button>
						<button
							onClick={onForward}
							className="text-xs text-muted border border-edge rounded px-3 py-1.5 hover:text-on-surface hover:border-edge-strong transition-colors"
						>
							Forward →
						</button>
						<button
							onClick={onNext}
							className="text-xs text-white bg-accent rounded px-3 py-1.5 hover:bg-accent-hover transition-colors"
						>
							Next →
						</button>
					</>
				) : (
					<>
						{!isReviewing && !isRecalibrating && canGoBack && (
							<button
								onClick={onBack}
								className="text-xs text-muted border border-edge rounded px-3 py-1.5 hover:text-on-surface hover:border-edge-strong transition-colors"
							>
								← Back
							</button>
						)}
						{!isReviewing && !isRecalibrating && (
							<button
								onClick={onSkip}
								className="text-xs text-muted border border-edge rounded px-3 py-1.5 hover:text-on-surface hover:border-edge-strong transition-colors"
							>
								Skip
							</button>
						)}
						<button
							onClick={onNext}
							disabled={!isReviewing && !isRecalibrating && !hasLabelsApplied}
							className={`text-xs text-white rounded px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
								isRecalibrating
									? recalibrationPhase === 'reconcile'
										? 'bg-warning hover:bg-warning'
										: 'bg-ai-action hover:bg-ai-hover'
									: 'bg-accent hover:bg-accent-hover'
							}`}
						>
							{isReviewing ? "Back to queue" : isRecalibrating
								? recalibrationPhase === 'reconcile' ? 'Confirm →' : 'Next →'
								: "Next →"}
						</button>
					</>
				)}
			</div>

			{showConversation &&
				conversationMessages &&
				conversationMessages.length > 0 && (
					<ConversationPanel
						messages={conversationMessages}
						currentMessageIndex={item.message_index}
						chatlogId={item.chatlog_id}
						onClose={() => onToggleConversation?.()}
						onSelectMessage={onSelectConversationMessage}
					/>
				)}
		</div>
	);
}
