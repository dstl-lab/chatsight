const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

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
}

export const apiClient = new ApiClient();

