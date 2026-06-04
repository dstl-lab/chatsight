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
	ConceptCandidate,
	ConversationMessage,
	LabelReviewItem,
	RecalibrationItem,
	RecalibrationStats,
} from "../types";
import { api } from "../services/api";
import { useKeybinds } from "../hooks/useKeybinds";
import { ProgressSidebar } from "../components/queue/ProgressSidebar";
import { MessageCard } from "../components/queue/MessageCard";
import { DeleteLabelConfirmModal } from "../components/queue/DeleteLabelConfirmModal";
import DiscoverModal from "../components/queue/DiscoverModal";
import { LabelReviewOverlay } from "../components/queue/LabelReviewOverlay";
import {
	QueueTutorialOverlay,
	type QueueTutorialStep,
} from "../components/queue/QueueTutorialOverlay";
import {
	markQueueTutorialDone,
	shouldOfferFirstQueueTutorial,
	takeQueueTutorialReloadGate,
} from "../components/queue/queueTutorial";

interface UndoState {
	message: QueueItem;
	labelNames: string[];
	fromSkippedTab: boolean;
}

export function QueuePage() {
	const { keybinds } = useKeybinds();
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
	// Serializes skip/advance. Each handler awaits an API call before advancing
	// the index, so without this lock a rapid second press (or key auto-repeat)
	// fires against a stale `currentMessage`/`currentIdx` closure — double-skipping
	// one message and silently flying past the next. Set synchronously on entry,
	// cleared in finally so a failed request can't wedge the queue.
	const advancingRef = useRef(false);
	const [remaining, setRemaining] = useState<number | null>(null);
	const [history, setHistory] = useState<HistoryItem[]>([]);
	const [reviewTarget, setReviewTarget] = useState<QueueItem | null>(null);
	const [showConversation, setShowConversation] = useState(false);
	const [deleteConfirm, setDeleteConfirm] = useState<{
		labelId: number;
		labelName: string;
		applicationCount: number;
	} | null>(null);
	const [candidates, setCandidates] = useState<ConceptCandidate[]>([]);
	const [discovering, setDiscovering] = useState(false);
	const [discoverModalOpen, setDiscoverModalOpen] = useState(false);
	const discoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const [showLabelReview, setShowLabelReview] = useState(false);
	const [labelReviewItems, setLabelReviewItems] = useState<LabelReviewItem[]>(
		[],
	);
	const [isSkippedReview, setIsSkippedReview] = useState(false);
	const [skippedQueue, setSkippedQueue] = useState<QueueItem[]>([]);
	const [skippedIdx, setSkippedIdx] = useState(0);

	interface RecalibrationState {
		item: RecalibrationItem;
		phase: "blind" | "reconcile";
		relabelIds: Set<number>;
	}
	const [recalibration, setRecalibration] = useState<RecalibrationState | null>(
		null,
	);
	const [recalibrationStats, setRecalibrationStats] =
		useState<RecalibrationStats | null>(null);
	const [recalibrationToast, setRecalibrationToast] = useState<"match" | null>(
		null,
	);
	const [tutorialStep, setTutorialStep] = useState<QueueTutorialStep | null>(
		null,
	);

	const tutorialActive = tutorialStep !== null;

	const currentMessage = queue[currentIdx] ?? null;

	const formatKey = (key: string) => {
		if (key === " ") return "Space";
		if (key === "enter") return "Enter";
		if (key === "arrowleft") return "←";
		if (key === "arrowright") return "→";
		if (key === "arrowup") return "↑";
		if (key === "arrowdown") return "↓";
		if (key === "backspace") return "⌫";
		if (key === "escape") return "Esc";
		if (key.startsWith("shift+")) {
			const base = key.split("+")[1];
			return "⇧" + formatKey(base);
		}
		return key.toUpperCase();
	};

	const isBackNav = navPos !== null;
	const isRecalibrating = recalibration !== null;
	// Single source of truth for the on-screen message + which mode produced
	// it. Handlers should branch on `displayMode` rather than independently
	// testing recalibration / backNav / reviewTarget — when those got out of
	// sync, history-review keyboard handlers used to apply labels to the
	// wrong message.
	type DisplayMode = "recalibration" | "backnav" | "history-review" | "queue";
	const { displayedMessage, displayMode } = (() => {
		if (recalibration?.item) {
			return {
				displayedMessage: recalibration.item,
				displayMode: "recalibration" as DisplayMode,
			};
		}
		if (isBackNav) {
			return {
				displayedMessage: navStack[navPos!],
				displayMode: "backnav" as DisplayMode,
			};
		}
		if (reviewTarget) {
			return {
				displayedMessage: reviewTarget,
				displayMode: "history-review" as DisplayMode,
			};
		}
		return {
			displayedMessage: currentMessage,
			displayMode: "queue" as DisplayMode,
		};
	})();
	const isReviewing = displayMode === "history-review";
	const aiUnlocked = (stats?.labeled_count ?? 0) >= 10;

	const loadQueue = useCallback(async () => {
		const q = await api.getQueue(20);
		setQueue(q);
		setCurrentIdx(0);
		setNavStack([]);
		setNavPos(null);
	}, []);

	useEffect(() => {
		// Use allSettled so a single failing endpoint (e.g., /candidates while
		// concept-induction is unavailable) doesn't blank the whole queue.
		Promise.allSettled([
			api.startSession(),
			api.getLabels(),
			api.getQueue(20),
			api.getQueueStats(),
			api.getQueuePosition(),
			api.getRecentHistory(5),
			api.getCandidates(),
		]).then(([sess, lbls, q, st, pos, hist, cands]) => {
			if (sess.status === "fulfilled") setSession(sess.value);
			if (lbls.status === "fulfilled") setLabels(lbls.value);
			if (q.status === "fulfilled") setQueue(q.value);
			if (st.status === "fulfilled") {
				setStats(st.value);
				setSkippedCount(st.value.skipped_count);
			}
			if (
				lbls.status === "fulfilled" &&
				st.status === "fulfilled" &&
				shouldOfferFirstQueueTutorial(lbls.value.length, st.value.labeled_count)
			) {
				takeQueueTutorialReloadGate();
				setTutorialStep(0);
			}
			if (pos.status === "fulfilled") setRemaining(pos.value.total_remaining);
			if (hist.status === "fulfilled") setHistory(hist.value);
			if (cands.status === "fulfilled") setCandidates(cands.value);

			const failures = [
				["session", sess],
				["labels", lbls],
				["queue", q],
				["stats", st],
				["position", pos],
				["history", hist],
				["candidates", cands],
			].filter(
				([, r]) => (r as PromiseSettledResult<unknown>).status === "rejected",
			);
			if (failures.length > 0) {
				console.error(
					"Queue load partial failure:",
					failures.map(([k, r]) => [k, (r as PromiseRejectedResult).reason]),
				);
			}
			setLoading(false);
			api
				.getRecalibrationStats()
				.then(setRecalibrationStats)
				.catch(() => {});
		});
	}, []);

	const finishTutorial = useCallback(() => {
		markQueueTutorialDone();
		setTutorialStep(null);
	}, []);

	const advanceTutorial = useCallback(() => {
		setTutorialStep((step) => {
			if (step === null) return null;
			if (step >= 4) {
				markQueueTutorialDone();
				return null;
			}
			return (step + 1) as QueueTutorialStep;
		});
	}, []);

	useEffect(() => {
		return () => {
			if (discoverPollRef.current) clearInterval(discoverPollRef.current);
		};
	}, []);

	useEffect(() => {
		if (!displayedMessage) return;
		if (recalibration) return;
		api
			.getAppliedLabels(
				displayedMessage.chatlog_id,
				displayedMessage.message_index,
			)
			.then((ids) => setAppliedLabelIds(new Set(ids)));
		setSuggestion(null);
		if (aiUnlocked) {
			api
				.suggestLabel(
					displayedMessage.chatlog_id,
					displayedMessage.message_index,
				)
				.then((s) => {
					if (s.label_name) setSuggestion(s);
				})
				.catch(() => {});
		}
	}, [
		displayedMessage?.chatlog_id,
		displayedMessage?.message_index,
		aiUnlocked,
		recalibration,
	]);

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
		const blindRecalibration = recalibration?.phase === "blind";
		const reconcileRecalibration = recalibration?.phase === "reconcile";
		if (blindRecalibration) {
			// Blind check: don't load saved labels from the DB or the sidebar
			// reveals the answer we're asking the instructor to reproduce.
			setAppliedLabelIds(new Set());
			setSuggestion(null);
			setSuggestionLoading(false);
			return;
		}
		if (reconcileRecalibration) {
			// Keep the toggles from the blind attempt; the DB still holds the
			// original labels, so don't overwrite the in-progress comparison.
			setSuggestion(null);
			setSuggestionLoading(false);
			return;
		}
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
		recalibration?.phase,
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
		[displayedMessage, appliedLabelIds],
	);

	const handleApplySuggestionAndNext = useCallback(
		async (labelId: number) => {
			if (!currentMessage) return;
			if (advancingRef.current) return;
			advancingRef.current = true;
			const msg = currentMessage;
			try {
				await api.applyLabel({
					chatlog_id: msg.chatlog_id,
					message_index: msg.message_index,
					label_id: labelId,
				});
				const appliedLabel = labels.find((l) => l.id === labelId);
				const allLabelNames = [
					...labels.filter((l) => appliedLabelIds.has(l.id)).map((l) => l.name),
					...(appliedLabel ? [appliedLabel.name] : []),
				];
				setNavStack((prev) => [...prev, msg]);
				setNavPos(null);
				setUndoState({
					message: msg,
					labelNames: allLabelNames,
					fromSkippedTab: false,
				});
				await api.advanceMessage(msg.chatlog_id, msg.message_index);
				setStats((s) => (s ? { ...s, labeled_count: s.labeled_count + 1 } : s));
				setTimeout(
					() => setUndoState((prev) => (prev?.message === msg ? null : prev)),
					8000,
				);
				setAppliedLabelIds(new Set());
				advance();
				api.getQueuePosition().then((p) => setRemaining(p.total_remaining));
				api.getRecentHistory(5).then(setHistory);
				api.getLabels().then(setLabels);
			} finally {
				advancingRef.current = false;
			}
		},
		[currentMessage, labels, appliedLabelIds, advance],
	);

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

	const handleNextInner = useCallback(async () => {
		// Recalibration: blind phase → check match → reconcile or auto-advance
		if (recalibration && recalibration.phase === "blind") {
			const relabelIds = new Set(appliedLabelIds);
			const originalSet = new Set(recalibration.item.original_label_ids);
			const matched =
				relabelIds.size === originalSet.size &&
				[...relabelIds].every((id) => originalSet.has(id));

			if (matched) {
				await api.saveRecalibration({
					chatlog_id: recalibration.item.chatlog_id,
					message_index: recalibration.item.message_index,
					original_label_ids: recalibration.item.original_label_ids,
					relabel_ids: [...relabelIds],
					final_label_ids: [...relabelIds],
				});
				setRecalibration(null);
				setRecalibrationToast("match");
				setTimeout(() => setRecalibrationToast(null), 2000);
				setAppliedLabelIds(new Set());
				api
					.getRecalibrationStats()
					.then(setRecalibrationStats)
					.catch(() => {});
			} else {
				setRecalibration((prev) =>
					prev ? { ...prev, phase: "reconcile", relabelIds } : prev,
				);
			}
			return;
		}

		// Recalibration: reconcile phase → save final labels and exit
		if (recalibration && recalibration.phase === "reconcile") {
			await api.saveRecalibration({
				chatlog_id: recalibration.item.chatlog_id,
				message_index: recalibration.item.message_index,
				original_label_ids: recalibration.item.original_label_ids,
				relabel_ids: [...recalibration.relabelIds],
				final_label_ids: [...appliedLabelIds],
			});
			setRecalibration(null);
			setAppliedLabelIds(new Set());
			api
				.getRecalibrationStats()
				.then(setRecalibrationStats)
				.catch(() => {});
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
		} else {
			setUndoState(null);
		}
		setAppliedLabelIds(new Set());
		advance();
		api.getQueuePosition().then((p) => setRemaining(p.total_remaining));
		api.getRecentHistory(5).then(setHistory);

		// Check if recalibration is due after advancing
		api
			.getRecalibration()
			.then((item) => {
				if (item) {
					setRecalibration({ item, phase: "blind", relabelIds: new Set() });
					setAppliedLabelIds(new Set());
				}
			})
			.catch(() => {});
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

	// Guard wrapper: drops re-entrant calls (rapid double-press / key auto-repeat)
	// while an advance is mid-flight, so the queue can't jump multiple messages
	// per intended action. Mirrors the lock in handleSkip.
	const handleNext = useCallback(async () => {
		if (advancingRef.current) return;
		advancingRef.current = true;
		try {
			await handleNextInner();
		} finally {
			advancingRef.current = false;
		}
	}, [handleNextInner]);

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
		if (advancingRef.current) return;
		advancingRef.current = true;
		const msg = currentMessage;
		try {
			await api.skipMessage(msg.chatlog_id, msg.message_index);
			setSkippedCount((s) => s + 1);
			setStats((s) => (s ? { ...s, skipped_count: s.skipped_count + 1 } : s));
			setAppliedLabelIds(new Set());
			setNavStack((prev) => [...prev, msg]);
			setNavPos(null);
			advance();
		} finally {
			advancingRef.current = false;
		}
	}, [isReviewing, isBackNav, currentMessage, advance]);

	// Keyboard shortcuts
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (tutorialActive) return;

			const tag = (document.activeElement as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;

			// Ignore OS key auto-repeat: holding (or fast-tapping) skip/label keys
			// would otherwise fire one shortcut per repeat and run away through the
			// queue. Every shortcut here is a discrete one-shot action.
			if (e.repeat) return;

			const num = parseInt(e.key);
			if (num >= 1 && num <= 9) {
				const label = labels[num - 1];
				if (label) handleToggleLabel(label.id);
				return;
			}
			const rawKey = e.key.toLowerCase();
			const pressedKey = e.shiftKey ? `shift+${rawKey}` : rawKey;

			// Submit/advance. Enter and `n` are convenience aliases for the
			// configurable yes key (default: z).
			if (
				pressedKey === keybinds.yes ||
				rawKey === "enter" ||
				rawKey === "n"
			) {
				if (!isBackNav && (isReviewing || appliedLabelIds.size > 0)) {
					e.preventDefault(); // prevent focused button from firing a click
					(document.activeElement as HTMLElement)?.blur();
					handleNext();
				}
				return;
			}
			if (pressedKey === keybinds.skip || rawKey === "s") {
				if (!isReviewing && !isBackNav) {
					if (rawKey === " ") e.preventDefault(); // prevent scroll if space is bound to skip
					if (rawKey === "arrowright") e.preventDefault(); // prevent browser scroll
					handleSkip();
				}
				return;
			}
			if (pressedKey === keybinds.undo || (e.ctrlKey && rawKey === "z")) {
				if (rawKey === "arrowleft") e.preventDefault(); // prevent browser back navigation
				handleUndo();
				return;
			}
			// if (e.key === "Escape" && recalibration) { /* recalibration disabled */ }
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [
		labels,
		appliedLabelIds,
		isReviewing,
		isBackNav,
		recalibration,
		keybinds,
		handleToggleLabel,
		handleNext,
		handleSkip,
		handleUndo,
		tutorialActive,
	]);

	const handleUpdateLabel = async (id: number, body: UpdateLabelRequest) => {
		const updated = await api.updateLabel(id, body);
		setLabels((prev) => prev.map((l) => (l.id === id ? updated : l)));
	};

	const handleStopAutolabel = async () => {
		await api.stopAutolabel().catch(() => {});
	};

	const handleClearAutolabel = async () => {
		if (!confirm("Delete all AI-applied labels? This cannot be undone.")) return;
		await api.clearAutolabelResults();
		setAutolabelStatus(null);
		const st = await api.getQueueStats();
		setStats(st);
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


	const handleDeleteLabel = useCallback(
		(labelId: number) => {
			const label = labels.find((l) => l.id === labelId);
			if (!label) return;
			setDeleteConfirm({
				labelId,
				labelName: label.name,
				applicationCount: label.count,
			});
		},
		[labels],
	);

	const handleConfirmDeleteLabel = useCallback(async () => {
		if (!deleteConfirm) return;
		const deletedId = deleteConfirm.labelId;
		await api.deleteLabel(deletedId, true);
		setDeleteConfirm(null);
		setAppliedLabelIds((prev) => {
			if (!prev.has(deletedId)) return prev;
			const next = new Set(prev);
			next.delete(deletedId);
			return next;
		});
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
	}, [deleteConfirm]);

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

	const handleToggleLabelForMessage = useCallback(
		async (
			chatlogId: number,
			messageIndex: number,
			labelId: number,
			currentlyApplied: boolean,
		) => {
			if (currentlyApplied) {
				await api
					.unapplyLabel(chatlogId, messageIndex, labelId)
					.catch(() => {});
			} else {
				await api
					.applyLabel({
						chatlog_id: chatlogId,
						message_index: messageIndex,
						label_id: labelId,
					})
					.catch(() => {});
			}
			// Keep the main card's applied state in sync when the toggled message is the one displayed
			if (
				chatlogId === displayedMessage?.chatlog_id &&
				messageIndex === displayedMessage?.message_index
			) {
				setAppliedLabelIds((prev) => {
					const next = new Set(prev);
					if (currentlyApplied) next.delete(labelId);
					else next.add(labelId);
					return next;
				});
			}
			api.getLabels().then(setLabels);
		},
		[displayedMessage],
	);

	const handleCreateLabelForMessage = useCallback(
		async (
			chatlogId: number,
			messageIndex: number,
			name: string,
		): Promise<number> => {
			const newLabel = await api.createLabel({ name });
			setLabels((prev) => [...prev, newLabel]);
			await api
				.applyLabel({
					chatlog_id: chatlogId,
					message_index: messageIndex,
					label_id: newLabel.id,
				})
				.catch(() => {});
			if (
				chatlogId === displayedMessage?.chatlog_id &&
				messageIndex === displayedMessage?.message_index
			) {
				setAppliedLabelIds((prev) => new Set(prev).add(newLabel.id));
			}
			return newLabel.id;
		},
		[displayedMessage],
	);

	const reviewingKey = reviewTarget
		? `${reviewTarget.chatlog_id}-${reviewTarget.message_index}`
		: null;

	if (loading) {
		return (
			<div className="flex-1 flex min-h-0" data-testid="loading-skeleton">
				{/* Sidebar skeleton */}
				<div className="w-52 shrink-0 border-r border-edge-subtle p-4 flex flex-col gap-5">
					<div>
						<div className="h-2 bg-elevated rounded animate-pulse w-16 mb-3" />
						<div className="h-1.5 bg-elevated rounded-full mb-2 animate-pulse" />
						<div className="h-3 bg-elevated rounded animate-pulse w-20" />
					</div>
					<div className="flex flex-col gap-1.5">
						{[1, 2, 3, 4].map((i) => (
							<div key={i} className="h-7 bg-elevated rounded animate-pulse" />
						))}
					</div>
				</div>
				{/* Message card skeleton */}
				<div className="flex-1 p-6 flex flex-col gap-4 min-h-0">
					<div className="h-3 bg-elevated rounded animate-pulse w-1/4" />
					<div className="h-36 bg-elevated rounded-lg animate-pulse" />
					<div className="h-3 bg-elevated rounded animate-pulse w-3/4" />
					<div className="h-3 bg-elevated rounded animate-pulse w-1/2" />
					<div className="mt-auto flex gap-2">
						<div className="h-8 w-16 bg-elevated rounded animate-pulse" />
						<div className="h-8 w-16 bg-elevated rounded animate-pulse" />
					</div>
				</div>
			</div>
		);
	}

	if (!displayedMessage && !isSkippedReview) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<div className="text-center">
					<p className="font-mono text-[10px] tracking-[0.18em] uppercase text-ochre mb-2">Complete</p>
					<p className="font-serif text-2xl text-paper">All messages labeled!</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="flex items-center gap-2 border-b border-edge-subtle px-4 py-1.5 font-mono text-[11px] text-muted">
				<span className="text-[9px] uppercase tracking-[0.06em] text-faint">scope</span>
				<span className="text-fg">Week 3 — Lab 1 &amp; HW 1</span>
			</div>
			{/* Recalibration banners disabled */}
			<div className="flex-1 flex min-h-0">
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
				onStopAutolabel={handleStopAutolabel}
				onClearAutolabel={handleClearAutolabel}
					autolabelStatus={autolabelStatus}
					remaining={remaining}
					history={history}
					onSelectHistoryItem={handleSelectHistoryItem}
					reviewingKey={reviewingKey}
					onReorderLabels={handleReorderLabels}
					onDeleteLabel={handleDeleteLabel}
					candidates={candidates}
					onDiscover={handleDiscover}
					onOpenDiscoverModal={() => setDiscoverModalOpen(true)}
					discovering={discovering}
					recalibration={null /* recalibration disabled */}
					recalibrationStats={null}
					tutorialDisabled={tutorialActive}
				/>
				<div className="flex-1 flex flex-col min-h-0">
					{undoState && (
						<div className="mx-4 mt-3 flex items-center justify-between bg-surface border border-edge rounded px-4 py-2">
							<span className="text-xs text-tertiary">
								Labeled as{" "}
								<span className="text-on-canvas font-medium">
									{undoState.labelNames.join(", ")}
								</span>
							</span>
							<button
								onClick={handleUndo}
								className="text-xs text-ochre hover:text-paper ml-4 shrink-0"
							>
								Undo
							</button>
						</div>
					)}
					<MessageCard
						key={`${displayedMessage.chatlog_id}-${displayedMessage.message_index}`}
						item={displayedMessage}
						aiUnlocked={aiUnlocked}
						suggestion={isRecalibrating ? null : suggestion}
						suggestionLoading={
							!isRecalibrating && suggestionLoading
						}
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
						onToggleLabelForMessage={handleToggleLabelForMessage}
						onCreateLabelForMessage={handleCreateLabelForMessage}
						tutorialDisabled={tutorialActive}
					/>
				</div>
			</div>
			{deleteConfirm && (
				<DeleteLabelConfirmModal
					labelName={deleteConfirm.labelName}
					applicationCount={deleteConfirm.applicationCount}
					onConfirm={handleConfirmDeleteLabel}
					onCancel={() => setDeleteConfirm(null)}
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
			{tutorialStep !== null && (
				<QueueTutorialOverlay
					step={tutorialStep}
					onAdvance={advanceTutorial}
					onSkip={finishTutorial}
				/>
			)}
		</div>
	);
}
