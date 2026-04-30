import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type {
	QueueItem,
	LabelDefinition,
	LabelingSession,
	QueueStats,
	SuggestResponse,
	UpdateLabelRequest,
	HistoryItem,
	OrphanedMessage,
	ArchiveReviewState,
	ConceptCandidate,
	ConversationMessage,
	LabelReviewItem,
	RecalibrationItem,
	RecalibrationStats,
} from "../types";
import { api } from "../services/api";
import { ProgressSidebar } from "../components/queue/ProgressSidebar";
import { MessageCard } from "../components/queue/MessageCard";
import { ArchiveConfirmModal } from "../components/queue/ArchiveConfirmModal";
import { ArchiveReviewBanner } from "../components/queue/ArchiveReviewBanner";
import { ArchiveReviewSidebar } from "../components/queue/ArchiveReviewSidebar";
import DiscoverModal from "../components/queue/DiscoverModal";
import { LabelReviewOverlay } from "../components/queue/LabelReviewOverlay";

interface UndoState {
	message: QueueItem;
	labelNames: string[];
	fromSkippedTab: boolean;
}

interface RecalibrationState {
  item: RecalibrationItem
  phase: 'blind' | 'reconcile'
  relabelIds: Set<number>
}

export function QueuePage() {
	const [queue, setQueue] = useState<QueueItem[]>([]);
	const [currentIdx, setCurrentIdx] = useState(0);
	const [labels, setLabels] = useState<LabelDefinition[]>([]);
	const [session, setSession] = useState<LabelingSession | null>(null);
	const [stats, setStats] = useState<QueueStats | null>(null);
	const [skippedCount, setSkippedCount] = useState(0);
	const [loading, setLoading] = useState(true);
	const [appliedLabelIds, setAppliedLabelIds] = useState<Set<number>>(
		new Set(),
	);
	const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null);
	const [suggestionLoading, setSuggestionLoading] = useState(false);
	const [conversationMessages, setConversationMessages] = useState<
		ConversationMessage[]
	>([]);
	const [conversationLoading, setConversationLoading] = useState(false);
	const [conversationError, setConversationError] = useState(false);
	const [undoState, setUndoState] = useState<UndoState | null>(null);
	const [navStack, setNavStack] = useState<QueueItem[]>([]);
	const [navPos, setNavPos] = useState<number | null>(null);
	const [autolabelStatus, setAutolabelStatus] = useState<{
		running: boolean;
		processed: number;
		total: number;
		error: string | null;
	} | null>(null);
	const autolabelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const suggestionCacheRef = useRef<Map<string, SuggestResponse>>(new Map());
	const [remaining, setRemaining] = useState<number | null>(null);
	const [history, setHistory] = useState<HistoryItem[]>([]);
	const [reviewTarget, setReviewTarget] = useState<QueueItem | null>(null);
	const [showConversation, setShowConversation] = useState(false);
	const [archiveReview, setArchiveReview] = useState<ArchiveReviewState | null>(
		null,
	);
	const [archiveConfirm, setArchiveConfirm] = useState<{
		labelId: number;
		labelName: string;
		totalApplications: number;
		orphanedCount: number;
		orphanedMessages: OrphanedMessage[];
	} | null>(null);
	const [candidates, setCandidates] = useState<ConceptCandidate[]>([]);
	const [discovering, setDiscovering] = useState(false);
	const [discoverModalOpen, setDiscoverModalOpen] = useState(false);
	const discoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const [showLabelReview, setShowLabelReview] = useState(false);
	const [labelReviewItems, setLabelReviewItems] = useState<
		LabelReviewItem[]
	>([]);
	const [isSkippedReview, setIsSkippedReview] = useState(false);
	const [skippedQueue, setSkippedQueue] = useState<QueueItem[]>([]);
	const [skippedIdx, setSkippedIdx] = useState(0);

	interface RecalibrationState {
		item: RecalibrationItem;
		phase: 'blind' | 'reconcile';
		relabelIds: Set<number>;
	}
	const [recalibration, setRecalibration] = useState<RecalibrationState | null>(null);
	const [recalibrationStats, setRecalibrationStats] = useState<RecalibrationStats | null>(null);
	const [recalibrationToast, setRecalibrationToast] = useState<'match' | null>(null);

	const currentMessage = queue[currentIdx] ?? null;
	const isBackNav = navPos !== null;
	const isRecalibrating = recalibration !== null;
	const displayedMessage = recalibration?.item
		?? (isBackNav ? navStack[navPos!] : (reviewTarget ?? currentMessage));
	const isReviewing = reviewTarget !== null;
	const aiUnlocked = (stats?.labeled_count ?? 0) >= 20;

	const loadQueue = useCallback(async () => {
		const q = await api.getQueue(20);
		setQueue(q);
		setCurrentIdx(0);
		setNavStack([]);
		setNavPos(null);
	}, []);

	useEffect(() => {
		Promise.all([
			api.startSession(),
			api.getLabels(),
			api.getQueue(20),
			api.getQueueStats(),
			api.getQueuePosition(),
			api.getRecentHistory(5),
			api.getCandidates(),
		])
			.then(([sess, lbls, q, st, pos, hist, cands]) => {
				setSession(sess);
				setLabels(lbls);
				setQueue(q);
				setStats(st);
				setSkippedCount(st.skipped_count);
				setRemaining(pos.total_remaining);
				setHistory(hist);
				setCandidates(cands);
				setLoading(false);
				api.getRecalibrationStats().then(setRecalibrationStats).catch(() => {});
			})
			.catch((err) => {
				console.error("Failed to load queue data:", err);
				setLoading(false);
			});
	}, []);

	useEffect(() => {
		return () => {
			if (discoverPollRef.current) clearInterval(discoverPollRef.current);
		};
	}, []);


	// Keep label review items in sync whenever labels change
	useEffect(() => {
		if (loading) return;
		api.getLabelReview().then(setLabelReviewItems).catch(() => {});
	}, [labels, loading]);

	// Show label review overlay once per browser session (after items are loaded)
	useEffect(() => {
		if (loading) return;
		if (sessionStorage.getItem("label_review_shown")) return;
		if (labelReviewItems.length > 0) setShowLabelReview(true);
	}, [loading, labelReviewItems]);

	// Enter review mode from ?review= query param (e.g., from /history page)
	const [searchParams, setSearchParams] = useSearchParams();
	useEffect(() => {
		const reviewParam = searchParams.get("review");
		if (!reviewParam || loading) return;
		const [cidStr, midxStr] = reviewParam.split("-");
		const cid = parseInt(cidStr);
		const midx = parseInt(midxStr);
		if (isNaN(cid) || isNaN(midx)) return;
		const modeParam = searchParams.get("mode");
		setSearchParams({}, { replace: true });
		if (modeParam === "skipped") {
			api
				.getSkippedMessages()
				.then((items) => {
					setSkippedQueue(items);
					const idx = items.findIndex(
						(m) => m.chatlog_id === cid && m.message_index === midx,
					);
					setSkippedIdx(idx >= 0 ? idx : 0);
					setIsSkippedReview(true);
					setAppliedLabelIds(new Set());
					setSuggestion(null);
				})
				.catch(() => {});
		} else {
			api
				.getMessage(cid, midx)
				.then((msg) => {
					setReviewTarget(msg);
				})
				.catch(() => {});
		}
	}, [loading, searchParams, setSearchParams]);

	// Fetch conversation once per chatlog (not per message)
	useEffect(() => {
		if (!displayedMessage) return;
		setConversationMessages([]);
		setConversationError(false);
		setConversationLoading(true);
		api
			.getConversationMessages(displayedMessage.chatlog_id)
			.then(setConversationMessages)
			.catch(() => setConversationError(true))
			.finally(() => setConversationLoading(false));
	}, [displayedMessage?.chatlog_id]);

	// Fetch applied labels and AI suggestion per message
	useEffect(() => {
		if (!displayedMessage) return;
		api
			.getAppliedLabels(
				displayedMessage.chatlog_id,
				displayedMessage.message_index,
			)
			.then((ids) => setAppliedLabelIds(new Set(ids)));
		const cacheKey = `${displayedMessage.chatlog_id}-${displayedMessage.message_index}`;
		const cached = suggestionCacheRef.current.get(cacheKey);
		if (cached) {
			setSuggestion(cached);
		} else {
			setSuggestion(null);
			if (aiUnlocked) {
				setSuggestionLoading(true);
				api
					.suggestLabel(
						displayedMessage.chatlog_id,
						displayedMessage.message_index,
					)
					.then((s) => {
						if (s.label_name) {
							suggestionCacheRef.current.set(cacheKey, s);
							setSuggestion(s);
						}
					})
					.catch(() => {})
					.finally(() => setSuggestionLoading(false));
			}
		}
	}, [
		displayedMessage?.chatlog_id,
		displayedMessage?.message_index,
		aiUnlocked,
	]);

	const advance = useCallback(() => {
		setCurrentIdx((i) => {
			const next = i + 1;
			if (next < queue.length) return next;
			loadQueue();
			return 0;
		});
	}, [queue.length, loadQueue]);

	const handleToggleLabel = useCallback(
		async (labelId: number) => {
			if (!displayedMessage) return;
			if (appliedLabelIds.has(labelId)) {
				await api.unapplyLabel(
					displayedMessage.chatlog_id,
					displayedMessage.message_index,
					labelId,
				);
				setAppliedLabelIds((prev) => {
					const next = new Set(prev);
					next.delete(labelId);
					return next;
				});
			} else {
				await api.applyLabel({
					chatlog_id: displayedMessage.chatlog_id,
					message_index: displayedMessage.message_index,
					label_id: labelId,
				});
				setAppliedLabelIds((prev) => new Set(prev).add(labelId));
			}
			api.getLabels().then(setLabels);
		},
		[displayedMessage, appliedLabelIds, archiveReview],
	);

	const handleApplySuggestionAndNext = useCallback(async (labelId: number) => {
		if (!currentMessage) return;
		await api.applyLabel({
			chatlog_id: currentMessage.chatlog_id,
			message_index: currentMessage.message_index,
			label_id: labelId,
		});
		const appliedLabel = labels.find((l) => l.id === labelId);
		const allLabelNames = [
			...labels.filter((l) => appliedLabelIds.has(l.id)).map((l) => l.name),
			...(appliedLabel ? [appliedLabel.name] : []),
		];
		setNavStack((prev) => [...prev, currentMessage]);
		setNavPos(null);
		setUndoState({ message: currentMessage, labelNames: allLabelNames, fromSkippedTab: false });
		await api.advanceMessage(currentMessage.chatlog_id, currentMessage.message_index);
		setStats((s) => (s ? { ...s, labeled_count: s.labeled_count + 1 } : s));
		setTimeout(() => setUndoState((prev) => prev?.message === currentMessage ? null : prev), 8000);
		setAppliedLabelIds(new Set());
		advance();
		api.getQueuePosition().then((p) => setRemaining(p.total_remaining));
		api.getRecentHistory(5).then(setHistory);
		api.getLabels().then(setLabels);
		api.getQueueStats().then(setStats);
	}, [currentMessage, labels, appliedLabelIds, advance]);

	const handleCreateAndApply = async (name: string, description?: string) => {
		if (!displayedMessage) return;
		const newLabel = await api.createLabel({ name, description });
		setLabels((prev) => [...prev, newLabel]);
		await api.applyLabel({
			chatlog_id: displayedMessage.chatlog_id,
			message_index: displayedMessage.message_index,
			label_id: newLabel.id,
		});
		setAppliedLabelIds((prev) => new Set(prev).add(newLabel.id));
	};

	const handleNext = useCallback(async () => {
		// Recalibration: blind phase → check match → reconcile or auto-advance
		if (recalibration && recalibration.phase === 'blind') {
			const relabelIds = new Set(appliedLabelIds);
			const originalSet = new Set(recalibration.item.original_label_ids);
			const matched = relabelIds.size === originalSet.size && [...relabelIds].every(id => originalSet.has(id));

			if (matched) {
				await api.saveRecalibration({
					chatlog_id: recalibration.item.chatlog_id,
					message_index: recalibration.item.message_index,
					original_label_ids: recalibration.item.original_label_ids,
					relabel_ids: [...relabelIds],
					final_label_ids: [...relabelIds],
				});
				setRecalibration(null);
				setRecalibrationToast('match');
				setTimeout(() => setRecalibrationToast(null), 2000);
				setAppliedLabelIds(new Set());
				api.getRecalibrationStats().then(setRecalibrationStats).catch(() => {});
			} else {
				setRecalibration(prev => prev ? { ...prev, phase: 'reconcile', relabelIds } : prev);
			}
			return;
		}

		// Recalibration: reconcile phase → save final labels and exit
		if (recalibration && recalibration.phase === 'reconcile') {
			await api.saveRecalibration({
				chatlog_id: recalibration.item.chatlog_id,
				message_index: recalibration.item.message_index,
				original_label_ids: recalibration.item.original_label_ids,
				relabel_ids: [...recalibration.relabelIds],
				final_label_ids: [...appliedLabelIds],
			});
			setRecalibration(null);
			setAppliedLabelIds(new Set());
			api.getRecalibrationStats().then(setRecalibrationStats).catch(() => {});
			return;
		}

		if (isBackNav) {
			setNavPos(null);
			return;
		}
		if (isReviewing && reviewTarget) {
			if (appliedLabelIds.size > 0) {
				await api
					.unskipMessage(reviewTarget.chatlog_id, reviewTarget.message_index)
					.catch(() => {});
			}
			setReviewTarget(null);
			api.getRecentHistory(5).then(setHistory);
			api.getLabels().then(setLabels);
			return;
		}
		if (!currentMessage) return;
		setNavStack((prev) => [...prev, currentMessage]);
		setNavPos(null);
		if (appliedLabelIds.size > 0) {
			const labelNames = labels
				.filter((l) => appliedLabelIds.has(l.id))
				.map((l) => l.name);
			setUndoState({
				message: currentMessage,
				labelNames,
				fromSkippedTab: false,
			});
			await api.advanceMessage(
				currentMessage.chatlog_id,
				currentMessage.message_index,
			);
			setStats((s) => (s ? { ...s, labeled_count: s.labeled_count + 1 } : s));
			setTimeout(
				() =>
					setUndoState((prev) =>
						prev?.message === currentMessage ? null : prev,
					),
				8000,
			);
			api.getQueueStats().then(setStats);
		} else {
			setUndoState(null);
		}
		setAppliedLabelIds(new Set());
		advance();
		api.getQueuePosition().then((p) => setRemaining(p.total_remaining));
		api.getRecentHistory(5).then(setHistory);

		// Check if recalibration is due after advancing
		api.getRecalibration().then(item => {
			if (item) {
				setRecalibration({ item, phase: 'blind', relabelIds: new Set() });
				setAppliedLabelIds(new Set());
			}
		}).catch(() => {});
	}, [
		recalibration,
		isBackNav,
		isSkippedReview,
		skippedQueue,
		skippedIdx,
		isReviewing,
		reviewTarget,
		currentMessage,
		appliedLabelIds,
		labels,
		advance,
	]);

	const handleUndo = useCallback(async () => {
		if (!undoState) return;
		await api.undoLabels(
			undoState.message.chatlog_id,
			undoState.message.message_index,
		);
		setStats((s) =>
			s ? { ...s, labeled_count: Math.max(0, s.labeled_count - 1) } : s,
		);
		if (undoState.fromSkippedTab) {
			await api.skipMessage(
				undoState.message.chatlog_id,
				undoState.message.message_index,
			);
			setSkippedCount((s) => s + 1);
			setStats((s) => (s ? { ...s, skipped_count: s.skipped_count + 1 } : s));
			setSkippedQueue((prev) => {
				const next = [...prev];
				next.splice(skippedIdx, 0, undoState.message);
				return next;
			});
		} else {
			// Re-insert the message at current position
			setQueue((q) => {
				const next = [...q];
				next.splice(currentIdx, 0, undoState.message);
				return next;
			});
		}
		setUndoState(null);
		api.getLabels().then(setLabels);
	}, [undoState, currentIdx]);

	const handleNavBack = useCallback(() => {
		setNavPos((pos) => {
			if (pos === null) return navStack.length > 0 ? navStack.length - 1 : null;
			return pos > 0 ? pos - 1 : pos;
		});
	}, [navStack.length]);

	const handleNavForward = useCallback(() => {
		setNavPos((pos) =>
			pos !== null && pos < navStack.length - 1 ? pos + 1 : null,
		);
	}, [navStack.length]);

	const handleSkip = useCallback(async () => {
		if (isReviewing || isBackNav || !currentMessage) return;
		await api.skipMessage(
			currentMessage.chatlog_id,
			currentMessage.message_index,
		);
		setSkippedCount((s) => s + 1);
		setStats((s) => (s ? { ...s, skipped_count: s.skipped_count + 1 } : s));
		setAppliedLabelIds(new Set());
		setNavStack((prev) => [...prev, currentMessage]);
		setNavPos(null);
		advance();
	}, [isReviewing, isBackNav, currentMessage, advance]);

	// Keyboard shortcuts
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const tag = (document.activeElement as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;

			const num = parseInt(e.key);
			if (num >= 1 && num <= 9) {
				const availableLabels = archiveReview
					? labels.filter((l) => l.id !== archiveReview.labelId)
					: labels;
				const label = availableLabels[num - 1];
				if (label) handleToggleLabel(label.id);
				return;
			}
			if (e.key === "Enter" || e.key === "n") {
				if (!isBackNav && (isReviewing || appliedLabelIds.size > 0)) {
					e.preventDefault(); // prevent focused button from firing a click
					handleNext();
				}
				return;
			}
			if (e.key === "s") {
				if (!isReviewing && !isBackNav) handleSkip();
				return;
			}
			if (e.key === "z" || (e.ctrlKey && e.key === "z")) {
				handleUndo();
				return;
			}
			if (e.key === "Escape" && recalibration) {
				if (recalibration.phase === "blind") {
					setRecalibration(null);
					setAppliedLabelIds(new Set());
				} else {
					api.saveRecalibration({
						chatlog_id: recalibration.item.chatlog_id,
						message_index: recalibration.item.message_index,
						original_label_ids: recalibration.item.original_label_ids,
						relabel_ids: [...recalibration.relabelIds],
						final_label_ids: recalibration.item.original_label_ids,
					}).then(() => {
						api.getRecalibrationStats().then(setRecalibrationStats).catch(() => {});
					});
					setRecalibration(null);
					setAppliedLabelIds(new Set());
				}
				return;
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [
		labels,
		appliedLabelIds,
		isReviewing,
		isBackNav,
		archiveReview,
		recalibration,
		handleToggleLabel,
		handleNext,
		handleSkip,
		handleUndo,
	]);

	const handleUpdateLabel = async (id: number, body: UpdateLabelRequest) => {
		const updated = await api.updateLabel(id, body);
		setLabels((prev) => prev.map((l) => (l.id === id ? updated : l)));
	};

	const handleStartAutolabel = async () => {
		await api.startAutolabel();
		setAutolabelStatus({ running: true, processed: 0, total: 0, error: null });
		// Poll status every 2 seconds
		autolabelPollRef.current = setInterval(async () => {
			const status = await api.getAutolabelStatus();
			setAutolabelStatus(status);
			if (!status.running) {
				if (autolabelPollRef.current) clearInterval(autolabelPollRef.current);
				autolabelPollRef.current = null;
				// Refresh stats and labels
				api.getQueueStats().then(setStats);
				api.getLabels().then(setLabels);
				// Auto-trigger concept discovery if unlabeled messages remain
				api.getEmbedStatus().then((embedStatus) => {
					if (embedStatus.total_unlabeled > 0) handleDiscover();
				});
			}
		}, 2000);
	};

	const handleDiscover = async () => {
		setDiscovering(true);
		await api.discoverConcepts();
		discoverPollRef.current = setInterval(async () => {
			const result = await api.getCandidates();
			const embedStatus = await api.getEmbedStatus();
			if (result.length > 0) {
				setCandidates(result);
				setDiscovering(false);
				setDiscoverModalOpen(true);
				if (discoverPollRef.current) clearInterval(discoverPollRef.current);
				discoverPollRef.current = null;
			} else if (!embedStatus.running) {
				setDiscovering(false);
				if (discoverPollRef.current) clearInterval(discoverPollRef.current);
				discoverPollRef.current = null;
			}
		}, 3000);
	};

	const handleAcceptCandidate = async (id: number, name?: string) => {
		await api.resolveCandidate(id, "accept", name);
		setCandidates((prev) => prev.filter((c) => c.id !== id));
		const updated = await api.getLabels();
		setLabels(updated);
	};

	const handleRejectCandidate = async (id: number) => {
		await api.resolveCandidate(id, "reject");
		setCandidates((prev) => prev.filter((c) => c.id !== id));
	};

	const handleReorderLabels = useCallback(
		async (labelIds: number[]) => {
			const reordered = labelIds
				.map((id) => labels.find((l) => l.id === id)!)
				.filter(Boolean);
			setLabels(reordered);
			await api.reorderLabels(labelIds);
		},
		[labels],
	);

	const handleForceRecalibration = useCallback(async () => {
		if (recalibration) return;
		const item = await api.getRecalibration(true);
		if (item) {
			setRecalibration({ item, phase: 'blind', relabelIds: new Set() });
			setAppliedLabelIds(new Set());
		} else {
			console.warn('[DEV] Force recalibration returned null — no labeled messages yet?');
		}
	}, [recalibration]);

	const handleArchiveLabel = useCallback(
		async (labelId: number) => {
			const label = labels.find((l) => l.id === labelId);
			if (!label) return;
			const orphanedData = await api.getOrphanedMessages(labelId);
			setArchiveConfirm({
				labelId,
				labelName: label.name,
				totalApplications: label.count,
				orphanedCount: orphanedData.count,
				orphanedMessages: orphanedData.messages,
			});
		},
		[labels],
	);

	const handleArchiveAnyway = useCallback(async () => {
		if (!archiveConfirm) return;
		await api.archiveLabel(archiveConfirm.labelId);
		setArchiveConfirm(null);
		const [lbls, q, st] = await Promise.all([
			api.getLabels(),
			api.getQueue(20),
			api.getQueueStats(),
		]);
		setLabels(lbls);
		setQueue(q);
		setCurrentIdx(0);
		setStats(st);
		api.getQueuePosition().then((p) => setRemaining(p.total_remaining));
		api.getRecentHistory(5).then(setHistory);
	}, [archiveConfirm]);

	const handleEnterReviewMode = useCallback(() => {
		if (!archiveConfirm) return;
		setArchiveReview({
			labelId: archiveConfirm.labelId,
			labelName: archiveConfirm.labelName,
			orphanedMessages: archiveConfirm.orphanedMessages,
			completedMessageKeys: new Set(),
		});
		setArchiveConfirm(null);
		if (archiveConfirm.orphanedMessages.length > 0) {
			const first = archiveConfirm.orphanedMessages[0];
			api.getMessage(first.chatlog_id, first.message_index).then((msg) => {
				setReviewTarget(msg);
			});
		}
	}, [archiveConfirm]);

	const handleSelectReviewMessage = useCallback(
		(chatlogId: number, messageIndex: number) => {
			// Mark current message as completed if it has labels applied
			if (archiveReview && displayedMessage && appliedLabelIds.size > 0) {
				const key = `${displayedMessage.chatlog_id}-${displayedMessage.message_index}`;
				setArchiveReview((prev) => {
					if (!prev) return prev;
					const next = new Set(prev.completedMessageKeys);
					next.add(key);
					return { ...prev, completedMessageKeys: next };
				});
			}
			api.getMessage(chatlogId, messageIndex).then((msg) => {
				setReviewTarget(msg);
			});
		},
		[archiveReview, displayedMessage, appliedLabelIds],
	);

	const handleSkipAndArchive = useCallback(async () => {
		if (!archiveReview) return;
		// Mark current message as completed if it has labels
		if (displayedMessage && appliedLabelIds.size > 0) {
			const key = `${displayedMessage.chatlog_id}-${displayedMessage.message_index}`;
			setArchiveReview((prev) => {
				if (!prev) return prev;
				const next = new Set(prev.completedMessageKeys);
				next.add(key);
				return { ...prev, completedMessageKeys: next };
			});
		}
		await api.archiveLabel(archiveReview.labelId);
		setArchiveReview(null);
		setReviewTarget(null);
		const [lbls, q, st] = await Promise.all([
			api.getLabels(),
			api.getQueue(20),
			api.getQueueStats(),
		]);
		setLabels(lbls);
		setQueue(q);
		setCurrentIdx(0);
		setStats(st);
		api.getQueuePosition().then((p) => setRemaining(p.total_remaining));
		api.getRecentHistory(5).then(setHistory);
	}, [archiveReview, displayedMessage, appliedLabelIds]);

	const handleCompleteArchive = useCallback(async () => {
		if (!archiveReview) return;
		// Mark current message as completed if it has labels
		if (displayedMessage && appliedLabelIds.size > 0) {
			const key = `${displayedMessage.chatlog_id}-${displayedMessage.message_index}`;
			setArchiveReview((prev) => {
				if (!prev) return prev;
				const next = new Set(prev.completedMessageKeys);
				next.add(key);
				return { ...prev, completedMessageKeys: next };
			});
		}
		await api.archiveLabel(archiveReview.labelId);
		setArchiveReview(null);
		setReviewTarget(null);
		const [lbls, q, st] = await Promise.all([
			api.getLabels(),
			api.getQueue(20),
			api.getQueueStats(),
		]);
		setLabels(lbls);
		setQueue(q);
		setCurrentIdx(0);
		setStats(st);
		api.getQueuePosition().then((p) => setRemaining(p.total_remaining));
		api.getRecentHistory(5).then(setHistory);
	}, [archiveReview, displayedMessage, appliedLabelIds]);

	const handleCancelArchiveReview = useCallback(() => {
		setArchiveReview(null);
		setReviewTarget(null);
	}, []);

	const handleDismissLabelReview = useCallback(() => {
		setShowLabelReview(false);
		sessionStorage.setItem("label_review_shown", "1");
	}, []);

	const handleSelectHistoryItem = useCallback((item: HistoryItem) => {
		setReviewTarget({
			chatlog_id: item.chatlog_id,
			message_index: item.message_index,
			message_text: item.message_text,
			context_before: item.context_before,
			context_after: item.context_after,
		});
	}, []);

	const handleSelectConversationMessage = useCallback(
		(chatlogId: number, messageIndex: number) => {
			api.getMessage(chatlogId, messageIndex).then((msg) => {
				setReviewTarget(msg);
				setNavPos(null);
			});
		},
		[],
	);

	const reviewingKey = reviewTarget
		? `${reviewTarget.chatlog_id}-${reviewTarget.message_index}`
		: null;

	if (loading) {
		return (
			<div className="flex-1 flex min-h-0" data-testid="loading-skeleton">
				{/* Sidebar skeleton */}
				<div className="w-52 shrink-0 border-r border-neutral-800 p-4 flex flex-col gap-5">
					<div>
						<div className="h-2 bg-neutral-800 rounded animate-pulse w-16 mb-3" />
						<div className="h-1.5 bg-neutral-800 rounded-full mb-2 animate-pulse" />
						<div className="h-3 bg-neutral-800 rounded animate-pulse w-20" />
					</div>
					<div className="flex flex-col gap-1.5">
						{[1, 2, 3, 4].map((i) => (
							<div
								key={i}
								className="h-7 bg-neutral-800 rounded animate-pulse"
							/>
						))}
					</div>
				</div>
				{/* Message card skeleton */}
				<div className="flex-1 p-6 flex flex-col gap-4 min-h-0">
					<div className="h-3 bg-neutral-800 rounded animate-pulse w-1/4" />
					<div className="h-36 bg-neutral-800 rounded-lg animate-pulse" />
					<div className="h-3 bg-neutral-800 rounded animate-pulse w-3/4" />
					<div className="h-3 bg-neutral-800 rounded animate-pulse w-1/2" />
					<div className="mt-auto flex gap-2">
						<div className="h-8 w-16 bg-neutral-800 rounded animate-pulse" />
						<div className="h-8 w-16 bg-neutral-800 rounded animate-pulse" />
					</div>
				</div>
			</div>
		);
	}

	if (!displayedMessage && !isSkippedReview) {
		return (
			<div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
				All messages labeled!
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col min-h-0">
			{recalibration && recalibration.phase === 'blind' && (
				<div className="bg-purple-500/10 border-b border-purple-500/30 px-4 py-2 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="bg-purple-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded">RECALIBRATION</span>
						<span className="text-purple-300 text-xs">Re-label this previously seen message to check consistency</span>
					</div>
					<div className="flex gap-3 text-[10px] text-neutral-500">
						<span><kbd className="bg-neutral-800 px-1 rounded text-neutral-400">1-9</kbd> toggle</span>
						<span><kbd className="bg-neutral-800 px-1 rounded text-neutral-400">Enter</kbd> submit</span>
						<span><kbd className="bg-neutral-800 px-1 rounded text-neutral-400">Esc</kbd> cancel</span>
					</div>
				</div>
			)}
			{recalibration && recalibration.phase === 'reconcile' && (
				<div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="bg-amber-500 text-black text-[10px] font-semibold px-2 py-0.5 rounded">MISMATCH</span>
						<span className="text-amber-300 text-xs">Labels differ from original — toggle labels to reconcile, then press Enter</span>
					</div>
					<div className="flex gap-3 text-[10px] text-neutral-500">
						<span><kbd className="bg-neutral-800 px-1 rounded text-neutral-400">1-9</kbd> toggle</span>
						<span><kbd className="bg-neutral-800 px-1 rounded text-neutral-400">Enter</kbd> confirm</span>
						<span><kbd className="bg-neutral-800 px-1 rounded text-neutral-400">Esc</kbd> keep original</span>
					</div>
				</div>
			)}
			{recalibrationToast === 'match' && (
				<div className="bg-green-500/10 border-b border-green-500/30 px-4 py-2 flex items-center gap-2">
					<span className="text-green-400 text-sm">✓</span>
					<span className="text-green-400 text-xs font-medium">Consistent! Your labels matched your original labeling.</span>
				</div>
			)}
			{archiveReview && (
				<ArchiveReviewBanner
					labelName={archiveReview.labelName}
					remainingCount={
						archiveReview.orphanedMessages.length -
						archiveReview.completedMessageKeys.size
					}
					onSkipAndArchive={handleSkipAndArchive}
					onCompleteArchive={handleCompleteArchive}
					onCancel={handleCancelArchiveReview}
				/>
			)}
			<div className="flex-1 flex min-h-0">
				{archiveReview ? (
					<ArchiveReviewSidebar
						orphanedMessages={archiveReview.orphanedMessages}
						completedMessageKeys={archiveReview.completedMessageKeys}
						selectedChatlogId={displayedMessage?.chatlog_id ?? null}
						selectedMessageIndex={displayedMessage?.message_index ?? null}
						onSelectMessage={handleSelectReviewMessage}
						labels={labels}
						archivedLabelId={archiveReview.labelId}
						appliedLabelIds={appliedLabelIds}
						onToggleLabel={handleToggleLabel}
						onCreateAndApply={handleCreateAndApply}
						onUpdateLabel={handleUpdateLabel}
					/>
				) : (
					<ProgressSidebar
						session={session}
						labels={labels}
						stats={stats}
						skippedCount={skippedCount}
						appliedLabelIds={appliedLabelIds}
						onToggleLabel={handleToggleLabel}
						onCreateAndApply={handleCreateAndApply}
						onUpdateLabel={handleUpdateLabel}
						onStartAutolabel={handleStartAutolabel}
						autolabelStatus={autolabelStatus}
						remaining={remaining}
						history={history}
						onSelectHistoryItem={handleSelectHistoryItem}
						reviewingKey={reviewingKey}
						onReorderLabels={handleReorderLabels}
						onArchiveLabel={handleArchiveLabel}
						candidates={candidates}
						onDiscover={handleDiscover}
						onOpenDiscoverModal={() => setDiscoverModalOpen(true)}
						discovering={discovering}
						recalibration={recalibration ? {
							phase: recalibration.phase,
							originalLabelIds: new Set(recalibration.item.original_label_ids),
							relabelIds: recalibration.relabelIds,
						} : null}
						recalibrationStats={recalibrationStats}
					/>
				)}
				<div className="flex-1 flex flex-col min-h-0">
					{undoState && !archiveReview && (
						<div className="mx-4 mt-3 flex items-center justify-between bg-neutral-900 border border-neutral-700 rounded px-4 py-2">
							<span className="text-xs text-neutral-300">
								Labeled as{" "}
								<span className="text-neutral-100 font-medium">
									{undoState.labelNames.join(", ")}
								</span>
							</span>
							<button
								onClick={handleUndo}
								className="text-xs text-blue-400 hover:text-blue-300 ml-4 shrink-0"
							>
								Undo
							</button>
						</div>
					)}
					<MessageCard
						key={`${displayedMessage.chatlog_id}-${displayedMessage.message_index}`}
						item={displayedMessage}
						aiUnlocked={aiUnlocked}
						suggestion={archiveReview || isRecalibrating ? null : suggestion}
						suggestionLoading={!archiveReview && !isRecalibrating && suggestionLoading}
						onSkip={handleSkip}
						onNext={handleNext}
						onBack={handleNavBack}
						canGoBack={isBackNav ? navPos! > 0 : navStack.length > 0}
						onForward={handleNavForward}
						isBackNav={isBackNav}
						hasLabelsApplied={appliedLabelIds.size > 0}
						isReviewing={isReviewing}
						isRecalibrating={isRecalibrating}
						recalibrationPhase={recalibration?.phase ?? null}
						labels={labels}
						appliedLabelIds={appliedLabelIds}
						onToggleLabel={handleToggleLabel}
						onApplySuggestionAndNext={handleApplySuggestionAndNext}
						conversationMessages={conversationMessages}
						conversationLoading={conversationLoading}
						conversationError={conversationError}
						showConversation={showConversation}
						onToggleConversation={() => setShowConversation((v) => !v)}
						onSelectConversationMessage={handleSelectConversationMessage}
					/>
				</div>
			</div>
			{archiveConfirm && (
				<ArchiveConfirmModal
					labelName={archiveConfirm.labelName}
					totalApplications={archiveConfirm.totalApplications}
					orphanedCount={archiveConfirm.orphanedCount}
					onReviewAndRelabel={handleEnterReviewMode}
					onArchiveAnyway={handleArchiveAnyway}
					onCancel={() => setArchiveConfirm(null)}
				/>
			)}
			{discoverModalOpen && (
				<DiscoverModal
					candidates={candidates}
					labels={labels}
					onAccept={handleAcceptCandidate}
					onReject={handleRejectCandidate}
					onDiscover={handleDiscover}
					onClose={() => setDiscoverModalOpen(false)}
					discovering={discovering}
				/>
			)}
			{showLabelReview && (
				<LabelReviewOverlay
					items={labelReviewItems}
					onDismiss={handleDismissLabelReview}
				/>
			)}
			{import.meta.env.DEV && !recalibration && (
				<button
					onClick={handleForceRecalibration}
					className="fixed bottom-4 right-4 z-50 text-[10px] font-mono text-purple-300 bg-purple-900/40 border border-purple-500/50 rounded px-2.5 py-1.5 hover:bg-purple-900/60 hover:border-purple-400 transition-colors"
					title="Dev-only: force-trigger a recalibration round"
				>
					DEV · trigger recalibration
				</button>
			)}
		</div>
	);
}
