import type { AssignmentListItem, ConversationListItem, FileData, FileListItem, FileMessage } from '../shared/types';
import { getDatabase } from './database';

class LocalFileService {
    private db = getDatabase();
    
    async saveFile(filename: string, content: string, fileType?: string, fileSize?: number): Promise<FileData> {
        const id = this.db.saveFile(filename, content, fileType, fileSize);
        const file = this.db.getFile(id);

        if (!file) {
            throw new Error('Failed to save file');
        }

        return {
            id: file.id,
            filename: file.filename,
            content: file.content,
            fileType: file.fileType,
            fileSize: file.fileSize,
            createdAt: file.createdAt
        };
    }

    async getFile(id: number): Promise<FileData> {
        const file = this.db.getFile(id);

        if (!file) {
            throw new Error(`File with id ${id} not found`);
        }

        return {
            id: file.id,
            filename: file.filename,
            content: file.content,
            fileType: file.fileType,
            fileSize: file.fileSize,
            createdAt: file.createdAt
        };
    }

    async getAllFiles(): Promise<FileListItem[]> {
        return this.db.getAllFiles();
    }

    async deleteFile(id: number): Promise<void> {
        const file = this.db.getFile(id);
        if (!file) {
            throw new Error(`File with id ${id} not found`);
        }
        this.db.deleteFile(id);
    }

    async getFileMessages(fileId: number): Promise<FileMessage[]> {
        return this.db.getMessagesByFileId(fileId);
    }

    async getFileAssignments(fileId: number): Promise<AssignmentListItem[]> {
        return this.db.getAssignmentsByFileId(fileId);
    }

    async getAssignmentConversations(assignmentId: number): Promise<ConversationListItem[]> {
        return this.db.getConversationsByAssignmentId(assignmentId);
    }

    async getConversationMessages(conversationId: number): Promise<FileMessage[]> {
        return this.db.getMessagesByConversationId(conversationId);
    }
}

export const fileService = new LocalFileService();