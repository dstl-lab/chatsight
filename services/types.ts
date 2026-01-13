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

interface FileMetadata {
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