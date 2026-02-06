import type { AssignmentListItem, CodeData, ConversationListItem, DiffData, FileData, FileListItem, FileMessage } from '../../shared/types';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

class ApiClient {
    private baseUrl: string;

    constructor(baseUrl: string = API_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    async getCode(index: number): Promise<CodeData> {
        const response = await fetch(`${this.baseUrl}/code/${index}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch code at index ${index}`);
        }
        return response.json();
    }

    async getDiff(fromIndex: number, toIndex: number): Promise<DiffData> {
        const response = await fetch(`${this.baseUrl}/code/diff?from=${fromIndex}&to=${toIndex}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch diff from ${fromIndex} to ${toIndex}`);
        }
        return response.json();
    }

    async saveCode(messageIndex: number, codeContent: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messageIndex, codeContent }),
        });
        if (!response.ok) {
            throw new Error('Failed to save code');
        }
    }

    async uploadFile(file: File): Promise<FileData> {
        const content = await file.text();

        const response = await fetch(`${this.baseUrl}/files`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filename: file.name,
                content: content,
                fileType: file.type || null,
                fileSize: file.size,
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to upload file');
        }

        return response.json();
    }

    async getFiles(): Promise<FileListItem[]> {
        const response = await fetch(`${this.baseUrl}/files`);
        if (!response.ok) {
            throw new Error('Failed to fetch files');
        }
        return response.json();
    }

    async getFile(id: number): Promise<FileData> {
        const response = await fetch(`${this.baseUrl}/files/${id}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch file with id ${id}`);
        }
        return response.json();
    }

    async deleteFile(id: number): Promise<void> {
        const response = await fetch(`${this.baseUrl}/files/${id}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            throw new Error(`Failed to delete file ${id}`);
        }
    }

    async getFileMessages(fileId: number): Promise<FileMessage[]> {
        const response = await fetch(`${this.baseUrl}/files/${fileId}/messages`);
        if (!response.ok) {
            throw new Error(`Failed to fetch messages for file ${fileId}`);
        }
        return response.json();
    }

    async getFileAssignments(fileId: number): Promise<AssignmentListItem[]> {
        const response = await fetch(`${this.baseUrl}/files/${fileId}/assignments`);
        if (!response.ok) {
            throw new Error(`Failed to fetch assignments for file ${fileId}`);
        }
        return response.json();
    }

    async getAssignmentConversations(assignmentId: number): Promise<ConversationListItem[]> {
        const response = await fetch(`${this.baseUrl}/assignments/${assignmentId}/conversations`);
        if (!response.ok) {
            throw new Error(`Failed to fetch conversations for assignment ${assignmentId}`);
        }
        return response.json();
    }

    async getConversationMessages(conversationId: number): Promise<FileMessage[]> {
        const response = await fetch(`${this.baseUrl}/conversations/${conversationId}/messages`);
        if (!response.ok) {
            throw new Error(`Failed to fetch messages for conversation ${conversationId}`);
        }
        return response.json();
    }

    async getSentiment(sentences: string[], signal?: AbortSignal): Promise<Array<{ sentence: string; sentiment: Array<{ label: string; score: number }> }>> {
        const response = await fetch(`${this.baseUrl}/sentiment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sentences }),
            signal,
        });
        if (!response.ok) {
            throw new Error('Failed to fetch sentiment');
        }
        return response.json();
    }
}

export const apiClient = new ApiClient();

