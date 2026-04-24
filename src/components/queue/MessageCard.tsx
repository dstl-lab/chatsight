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
				<div className="bg-amber-900/30 border border-amber-700/40 rounded px-3 py-2">
					<span className="text-[10px] text-amber-400 uppercase tracking-wide">
						Reviewing previous message
					</span>
				</div>
			)}
			{item.context_before && (
				<div
					className="bg-neutral-900/70 border-l-2 border-neutral-600 rounded px-4 py-3 cursor-pointer group"
					onClick={() => setBeforeExpanded((v) => !v)}
				>
					<span className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
						Preceding AI response
						<span className="ml-2 text-neutral-600 group-hover:text-neutral-400 transition-colors">
							{beforeExpanded ? "▾ collapse" : "▸ expand"}
						</span>
					</span>
					{beforeExpanded ? (
						<div className="prose prose-sm prose-invert prose-p:text-neutral-300 prose-headings:text-neutral-200 prose-li:text-neutral-300 prose-strong:text-neutral-200 prose-code:text-blue-300 max-w-none text-neutral-300 leading-relaxed">
							<ReactMarkdown
								remarkPlugins={[remarkMath]}
								rehypePlugins={[rehypeKatex]}
							>
								{item.context_before}
							</ReactMarkdown>
						</div>
					) : (
						<p className="text-sm text-neutral-400 leading-relaxed italic">
							{truncateAtWord(stripMarkdown(item.context_before), 200, "tail")}
						</p>
					)}
				</div>
			)}

			<div className="bg-[#0d1f33] border border-blue-700/60 rounded-lg p-4">
				<div className="flex items-center justify-between mb-2">
					<span className="text-[10px] uppercase tracking-wide text-blue-400">
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
									? "text-neutral-600 cursor-default"
									: conversationError
										? "text-neutral-500 cursor-default"
										: showConversation
											? "text-blue-300 hover:text-blue-200"
											: "text-blue-400 hover:text-blue-300"
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
				<p className="text-sm text-neutral-100 leading-relaxed">
					{item.message_text}
				</p>

				<div className="flex justify-end mt-2">
					{aiUnlocked && suggestionLoading ? (
						<span className="text-[9px] text-blue-400 bg-neutral-900 border border-blue-500/40 rounded px-1.5 py-0.5 animate-pulse">
							✦ suggesting label...
						</span>
					) : aiUnlocked && suggestion ? (
						<span
							className={`inline-flex items-center gap-0 text-[9px] rounded overflow-hidden border ${
								isSuggestionApplied
									? "bg-blue-900/50 border-blue-500"
									: "bg-neutral-900 border-blue-500/40"
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
										? "text-blue-200 hover:text-blue-100"
										: "text-blue-400 hover:text-blue-300"
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
										? "border-blue-700 text-blue-400 hover:text-blue-200"
										: "border-blue-500/40 text-blue-500 hover:text-blue-300"
								}`}
							>
								why?
							</button>
						</span>
					) : !aiUnlocked ? (
						<span className="text-[8px] text-neutral-600 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5">
							AI unlocks at 20
						</span>
					) : null}
				</div>
			</div>

			{showRationale && suggestion && (
				<div className="border-l-2 border-neutral-700 pl-3 py-1">
					<p className="text-[10px] text-neutral-400 leading-relaxed">
						<span className="text-neutral-600">Evidence: </span>
						&ldquo;{suggestion.evidence}&rdquo;
					</p>
					<p className="text-[10px] text-neutral-400 leading-relaxed mt-1">
						<span className="text-neutral-600">Rationale: </span>
						{suggestion.rationale}
					</p>
				</div>
			)}

			{item.context_after && (
				<div
					className="bg-neutral-900/70 border-l-2 border-neutral-600 rounded px-4 py-3 cursor-pointer group"
					onClick={() => setAfterExpanded((v) => !v)}
				>
					<span className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
						Following AI response
						<span className="ml-2 text-neutral-600 group-hover:text-neutral-400 transition-colors">
							{afterExpanded ? "▾ collapse" : "▸ expand"}
						</span>
					</span>
					{afterExpanded ? (
						<div className="prose prose-sm prose-invert prose-p:text-neutral-300 prose-headings:text-neutral-200 prose-li:text-neutral-300 prose-strong:text-neutral-200 prose-code:text-blue-300 max-w-none text-neutral-300 leading-relaxed">
							<ReactMarkdown
								remarkPlugins={[remarkMath]}
								rehypePlugins={[rehypeKatex]}
							>
								{item.context_after}
							</ReactMarkdown>
						</div>
					) : (
						<p className="text-sm text-neutral-400 leading-relaxed italic">
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
							className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
						>
							← Back
						</button>
						<button
							onClick={onForward}
							className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
						>
							Forward →
						</button>
						<button
							onClick={onNext}
							className="text-xs text-white bg-blue-600 rounded px-3 py-1.5 hover:bg-blue-500 transition-colors"
						>
							Next →
						</button>
					</>
				) : (
					<>
						{!isReviewing && !isRecalibrating && canGoBack && (
							<button
								onClick={onBack}
								className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
							>
								← Back
							</button>
						)}
						{!isReviewing && !isRecalibrating && (
							<button
								onClick={onSkip}
								className="text-xs text-neutral-400 border border-neutral-700 rounded px-3 py-1.5 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
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
										? 'bg-amber-600 hover:bg-amber-500'
										: 'bg-purple-600 hover:bg-purple-500'
									: 'bg-blue-600 hover:bg-blue-500'
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
