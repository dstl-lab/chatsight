export interface CodeData {
    messageIndex: number;
    codeContent: string;
}

export interface DiffLine {
    type: 'added' | 'removed' | 'unchanged';
    line: number;
    originalLine?: number;
    content: string;
}

export interface DiffData {
    fromIndex: number;
    toIndex: number;
    diff: DiffLine[];
}

export interface FileMetadata {
    id: number;
    filename: string;
    fileType: string | null;
    fileSize: number | null;
    createdAt: string;
}

export interface FileData extends FileMetadata {
    content: string;
}

export interface FileListItem extends FileMetadata {}

export interface FileMessage {
    id: number;
    role: string | null;
    timestamp: string | null;
    content: string;
    sortOrder: number;
}

export interface AssignmentListItem {
    id: number;
    fileId: number;
    assignmentRef: string;
}

export interface ConversationListItem {
    id: number;
    assignmentId: number;
    student: string;
}