import { useState, useEffect, useMemo } from "react";
import "./Workspace.css";
import { Messages } from "./modules/Messages";
import { Code } from "./modules/Code";
import { Sentiment } from "./modules/Sentiment";
import { Chat } from "./modules/Chat";
import { apiClient } from "../services/apiClient";
import type { FileMessage } from "../../shared/types";

type ModuleType =
	| "messages"
	| "code"
	| "notes"
	| "chat"
	| "wordcloud"
	| "sentiment"
	| null;
type ModuleType =
	| "messages"
	| "code"
	| "notes"
	| "chat"
	| "wordcloud"
	| "sentiment"
	| null;

interface Module {
	id: string;
	type: ModuleType;
	startIndex: number;
	colSpan: number;
	rowSpan: number;
	id: string;
	type: ModuleType;
	startIndex: number;
	colSpan: number;
	rowSpan: number;
}

interface WorkspaceProps {
	modules: Module[];
	setModules: React.Dispatch<React.SetStateAction<Module[]>>;
	selectedConversationId: number | null;
}

const getModulePositions = (module: Module): number[] => {
	const positions: number[] = [];
	const startRow = Math.floor(module.startIndex / 3);
	const startCol = module.startIndex % 3;
	const positions: number[] = [];
	const startRow = Math.floor(module.startIndex / 3);
	const startCol = module.startIndex % 3;

	for (let row = 0; row < module.rowSpan; row++) {
		for (let col = 0; col < module.colSpan; col++) {
			const pos = (startRow + row) * 3 + (startCol + col);
			if (pos < 6) positions.push(pos);
		}
	}
	return positions;
	for (let row = 0; row < module.rowSpan; row++) {
		for (let col = 0; col < module.colSpan; col++) {
			const pos = (startRow + row) * 3 + (startCol + col);
			if (pos < 6) positions.push(pos);
		}
	}
	return positions;
};

const arePositionsAvailable = (
	positions: number[],
	modules: Module[],
	excludeModuleId?: string,
): boolean => {
	const occupied = new Set<number>();
	modules.forEach((m) => {
		if (m.id !== excludeModuleId) {
			getModulePositions(m).forEach((pos) => occupied.add(pos));
		}
	});
	return positions.every((pos) => !occupied.has(pos) && pos < 6);
	const occupied = new Set<number>();
	modules.forEach((m) => {
		if (m.id !== excludeModuleId) {
			getModulePositions(m).forEach((pos) => occupied.add(pos));
		}
	});
	return positions.every((pos) => !occupied.has(pos) && pos < 6);
};

const findModuleAtPosition = (
	position: number,
	modules: Module[],
): Module | null => {
	return modules.find((m) => getModulePositions(m).includes(position)) || null;
};

export function Workspace({
	modules,
	setModules,
	selectedConversationId,
}: WorkspaceProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

	const handleDragEnter = () => {
		setIsDragging(true);
	};
	const handleDragEnter = () => {
		setIsDragging(true);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDragging(false);
			setDragOverIndex(null);
		}
	};
	const handleDragLeave = (e: React.DragEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDragging(false);
			setDragOverIndex(null);
		}
	};

	const handleDragEnd = () => {
		setIsDragging(false);
		setDragOverIndex(null);
	};
	const handleDragEnd = () => {
		setIsDragging(false);
		setDragOverIndex(null);
	};

	const handleDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";

		const moduleAtPos = findModuleAtPosition(index, modules);
		if (!moduleAtPos) {
			setDragOverIndex(index);
		}
	};
	const handleDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";

		const moduleAtPos = findModuleAtPosition(index, modules);
		if (!moduleAtPos) {
			setDragOverIndex(index);
		}
	};

	const handleDropZoneDragLeave = (e: React.DragEvent) => {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX;
		const y = e.clientY;
	const handleDropZoneDragLeave = (e: React.DragEvent) => {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX;
		const y = e.clientY;

		if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
			setDragOverIndex(null);
		}
	};
		if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
			setDragOverIndex(null);
		}
	};

	const handleDrop = (e: React.DragEvent, slotIndex: number) => {
		e.preventDefault();
		setIsDragging(false);
		setDragOverIndex(null);
		const moduleType = e.dataTransfer.getData("moduleType") as ModuleType;

		if (
			moduleType === "messages" &&
			modules.some((m) => m.type === "messages")
		) {
			return;
		}

		const moduleAtPos = findModuleAtPosition(slotIndex, modules);
		if (!moduleAtPos && moduleType) {
			// Leaving this in for future use with larger grid size
			const defaultColSpan = 1;
			const defaultRowSpan = 1;

			const startRow = Math.floor(slotIndex / 3);
			const startCol = slotIndex % 3;
			const defaultPositions: number[] = [];
			for (let row = 0; row < defaultRowSpan; row++) {
				for (let col = 0; col < defaultColSpan; col++) {
					const pos = (startRow + row) * 3 + (startCol + col);
					if (pos < 6) defaultPositions.push(pos);
				}
			}

			// Later can be split into canRow... and canColFitDefault
			const canFitDefault =
				startCol + defaultColSpan <= 3 &&
				startRow + defaultRowSpan <= 2 &&
				arePositionsAvailable(defaultPositions, modules);

			const newModule: Module = {
				id: `${moduleType}-${Date.now()}`,
				type: moduleType,
				startIndex: slotIndex,
				colSpan: canFitDefault ? defaultColSpan : 1,
				rowSpan: canFitDefault ? defaultRowSpan : 1,
			};
			setModules((prev) => [...prev, newModule]);
		}
	};

	const handleResize = (
		moduleId: string,
		newColSpan: number,
		newRowSpan: number,
	) => {
		setModules((prev) => {
			const moduleIndex = prev.findIndex((m) => m.id === moduleId);
			if (moduleIndex === -1) return prev;

			const module = prev[moduleIndex];
			const startRow = Math.floor(module.startIndex / 3);
			const startCol = module.startIndex % 3;
			const module = prev[moduleIndex];
			const startRow = Math.floor(module.startIndex / 3);
			const startCol = module.startIndex % 3;

			const newPositions: number[] = [];
			for (let row = 0; row < newRowSpan; row++) {
				for (let col = 0; col < newColSpan; col++) {
					const pos = (startRow + row) * 3 + (startCol + col);
					if (pos < 6) newPositions.push(pos);
				}
			}
			const newPositions: number[] = [];
			for (let row = 0; row < newRowSpan; row++) {
				for (let col = 0; col < newColSpan; col++) {
					const pos = (startRow + row) * 3 + (startCol + col);
					if (pos < 6) newPositions.push(pos);
				}
			}

			if (
				startCol + newColSpan <= 3 &&
				startRow + newRowSpan <= 2 &&
				arePositionsAvailable(newPositions, prev, moduleId)
			) {
				const newModules = [...prev];
				newModules[moduleIndex] = {
					...module,
					colSpan: newColSpan,
					rowSpan: newRowSpan,
				};
				return newModules;
			}
			if (
				startCol + newColSpan <= 3 &&
				startRow + newRowSpan <= 2 &&
				arePositionsAvailable(newPositions, prev, moduleId)
			) {
				const newModules = [...prev];
				newModules[moduleIndex] = {
					...module,
					colSpan: newColSpan,
					rowSpan: newRowSpan,
				};
				return newModules;
			}

			return prev;
		});
	};
			return prev;
		});
	};

	const [messageIndex, setMessageIndex] = useState(0);
	const [conversationMessages, setConversationMessages] = useState<
		FileMessage[]
	>([]);

	useEffect(() => {
		setMessageIndex(0);
		setConversationMessages([]);

		if (selectedConversationId != null) {
			apiClient
				.getConversationMessages(selectedConversationId)
				.then(setConversationMessages)
				.catch(() => setConversationMessages([]));
		}
	}, [selectedConversationId]);

	// Per display index (Student/Tutor only): student message id and code for that turn
	const { studentMessageIdByDisplayIndex, codeByDisplayIndex } = useMemo(() => {
		const studentIds: (number | null)[] = [];
		const codes: (string | null)[] = [];
		let currentTurnStudentId: number | null = null;
		let currentTurnCode: string | null = null;

		for (let i = 0; i < conversationMessages.length; i++) {
			const msg = conversationMessages[i];
			const role = msg.role?.toLowerCase() ?? "";

			if (role === "code") continue;

			if (role === "student" || role === "student:") {
				currentTurnStudentId = msg.id;
				const next = conversationMessages[i + 1];
				currentTurnCode =
					next?.role?.toLowerCase() === "code" ? next.content : null;
				studentIds.push(currentTurnStudentId);
				codes.push(currentTurnCode);
				continue;
			}

			if (role.includes("tutor")) {
				studentIds.push(currentTurnStudentId);
				codes.push(currentTurnCode);
			}
		}

		return {
			studentMessageIdByDisplayIndex: studentIds,
			codeByDisplayIndex: codes,
		};
	}, [conversationMessages]);

	const selectedStudentMessageId =
		messageIndex >= 0 && messageIndex < studentMessageIdByDisplayIndex.length
			? studentMessageIdByDisplayIndex[messageIndex]
			: null;
	const currentCode =
		messageIndex >= 0 && messageIndex < codeByDisplayIndex.length
			? codeByDisplayIndex[messageIndex]
			: null;
	const previousCode =
		messageIndex > 0 && messageIndex - 1 < codeByDisplayIndex.length
			? codeByDisplayIndex[messageIndex - 1]
			: null;

	const renderModule = (module: Module) => {
		switch (module.type) {
			case "messages":
				return (
					<Messages
						conversationId={selectedConversationId}
						sharedMessages={conversationMessages}
						onClose={() => handleClose(module.id)}
						onResize={(newColSpan, newRowSpan) =>
							handleResize(module.id, newColSpan, newRowSpan)
						}
						colSpan={module.colSpan}
						rowSpan={module.rowSpan}
						currentIndex={messageIndex}
						onIndexChange={setMessageIndex}
					/>
				);
			case "code":
				return (
					<Code
						onClose={() => handleClose(module.id)}
						onResize={(newColSpan, newRowSpan) =>
							handleResize(module.id, newColSpan, newRowSpan)
						}
						colSpan={module.colSpan}
						rowSpan={module.rowSpan}
						studentMessageId={selectedStudentMessageId}
						codes={currentCode ?? undefined}
						previousCodes={previousCode ?? undefined}
					/>
				);
			case "sentiment":
				return (
					<Sentiment
						onClose={() => handleClose(module.id)}
						onResize={(newColSpan, newRowSpan) =>
							handleResize(module.id, newColSpan, newRowSpan)
						}
						colSpan={module.colSpan}
						rowSpan={module.rowSpan}
					/>
				);
			case "chat":
				return (
					<Chat
						onClose={() => handleClose(module.id)}
						onResize={(newColSpan, newRowSpan) =>
							handleResize(module.id, newColSpan, newRowSpan)
						}
						colSpan={module.colSpan}
						rowSpan={module.rowSpan}
					/>
				);
			default:
				return null;
		}
	};

	const handleClose = (moduleId: string) => {
		setModules((prev) => {
			const moduleToClose = prev.find((m) => m.id === moduleId);
	const handleClose = (moduleId: string) => {
		setModules((prev) => {
			const moduleToClose = prev.find((m) => m.id === moduleId);

			if (moduleToClose?.type === "messages") {
				return prev.filter((m) => m.type !== "messages" && m.type !== "code");
			}
			if (moduleToClose?.type === "messages") {
				return prev.filter((m) => m.type !== "messages" && m.type !== "code");
			}

			return prev.filter((m) => m.id !== moduleId);
		});
	};
			return prev.filter((m) => m.id !== moduleId);
		});
	};

  const positionMap = new Map<number, Module>();
  modules.forEach(module => {
    getModulePositions(module).forEach(pos => {
      if (pos === module.startIndex) {
        positionMap.set(pos, module);
      }
    });
  });
  
  return (
    <main 
      className="workspace"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragEnd={handleDragEnd}
    >
      {Array.from({ length: 6 }, (_, index) => {
        const module = positionMap.get(index);
        const isEmpty = !module;
        
        const row = Math.floor(index / 3) + 1;
        const col = (index % 3) + 1;

        return (
          <div
            key={index}
            style={
              module
                ? {
                    gridColumn: `${module.startIndex % 3 + 1} / span ${module.colSpan}`,
                    gridRow: `${Math.floor(module.startIndex / 3) + 1} / span ${module.rowSpan}`,
                  }
                : {
                    gridColumn: col,
                    gridRow: row,
                  }
            }
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDropZoneDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            className={`${isEmpty ? 'drop-zone' : ''} ${
              isDragging && isEmpty ? 'dragging-over' : ''
            } ${
              dragOverIndex === index && isEmpty ? 'drag-over-active' : ''
            }`}
          >
            {module && renderModule(module)}
          </div>
        );
      })}
    </main>
  );
}

