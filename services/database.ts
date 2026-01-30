import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export class LocalDatabase {
    private db: Database.Database;
    private dbPath: string;

    constructor(dbPath: string = './database/dev.db') {
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.dbPath = dbPath;
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');

        this.initializeSchema();
        this.seedData();
    }

    private initializeSchema(): void {
        const schema = `
            CREATE TABLE IF NOT EXISTS code_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_index INTEGER NOT NULL UNIQUE,
                code_content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_message_index ON code_versions(message_index);

            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                file_type TEXT,
                file_size INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_filename_created_at ON files(filename, created_at);

            CREATE TABLE IF NOT EXISTS assignment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                assignment_ref TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id INTEGER NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
                student TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS message (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
                role TEXT,
                timestamp TEXT,
                content TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_file_ref ON assignment(file_id, assignment_ref);
            CREATE INDEX IF NOT EXISTS idx_assignment_file_id ON assignment(file_id);
            CREATE INDEX IF NOT EXISTS idx_conversation_assignment_id ON conversation(assignment_id);
            CREATE INDEX IF NOT EXISTS idx_message_conversation_id ON message(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_message_sort ON message(conversation_id, sort_order);
        `;

        this.db.exec(schema);
    }

    private seedData(): void {
        const count = this.db.prepare('SELECT COUNT(*) as count FROM code_versions').get() as { count: number };

        if (count.count === 0) {
            const insert = this.db.prepare(`
                INSERT INTO code_versions (message_index, code_content)
                VALUES (?, ?)
            `)

            const sampleData: [number, string][] = [
                [0, 'print("Hello, World!")'],
                [1, 'def add(a, b):\n    return a + b'],
                [2, 'def multiply(a, b):\n    return a * b'],
            ];

            const insertMany = this.db.transaction((data: [number, string][]) => {
                for (const [index, content] of data) {
                    insert.run(index, content);
                }
            });

            insertMany(sampleData);
        }
    }

    getCode(messageIndex: number): { messageIndex: number; codeContent: string } | null {
        const stmt = this.db.prepare('SELECT message_index, code_content FROM code_versions WHERE message_index = ?');
        const row = stmt.get(messageIndex) as { message_index: number; code_content: string } | undefined;

        if (!row) return null;

        return {
            messageIndex: row.message_index,
            codeContent: row.code_content
        };
    }

    saveCode(messageIndex: number, codeContent: string): void {
        const stmt = this.db.prepare(`
            INSERT INTO code_versions (message_index, code_content)
            VALUES (?, ?)
            ON CONFLICT(message_index) DO UPDATE SET code_content = ?
        `);
        stmt.run(messageIndex, codeContent, codeContent);
    }

    getAllIndices(): number[] {
        const stmt = this.db.prepare('SELECT message_index FROM code_versions ORDER BY message_index');
        const rows = stmt.all() as { message_index: number }[];
        return rows.map(row => row.message_index);
    }

    saveFile(filename: string, content: string, fileType?: string, fileSize?: number): number {
        const stmt = this.db.prepare(`
            INSERT INTO files (filename, content, file_type, file_size)
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(filename, content, fileType || null, fileSize || null);
        return result.lastInsertRowid as number;
    }

    getFile(id: number): { id: number; filename: string; content: string; fileType: string | null; fileSize: number | null; createdAt: string } | null {
        const stmt = this.db.prepare('SELECT * FROM files WHERE id = ?');
        const row = stmt.get(id) as any;

        if (!row) return null;

        return {
            id: row.id,
            filename: row.filename,
            content: row.content,
            fileType: row.file_type,
            fileSize: row.file_size,
            createdAt: row.created_at
        };
    }

    getAllFiles(): Array<{ id: number; filename: string; fileType: string | null; fileSize: number | null; createdAt: string }> {
        const stmt = this.db.prepare(`
            SELECT id, filename, file_type, file_size, created_at 
            FROM files 
            ORDER BY created_at DESC
        `);
        const rows = stmt.all() as any[];
        return rows.map(row => ({
            id: row.id,
            filename: row.filename,
            fileType: row.file_type,
            fileSize: row.file_size,
            createdAt: row.created_at
        }));
    }

    deleteFile(id: number): void {
        const stmt = this.db.prepare(`DELETE FROM files WHERE id = ?`);
        stmt.run(id);
    }

    getOrCreateAssignment(fileId: number, assignmentRef: string): number {
        const existing = this.db.prepare(
            `SELECT id FROM assignment WHERE file_id = ? AND assignment_ref = ?`
        ).get(fileId, assignmentRef) as { id: number } | undefined;
        if (existing) return existing.id;
        const stmt = this.db.prepare(
            `INSERT INTO assignment (file_id, assignment_ref) VALUES (?, ?)`
        );
        const result = stmt.run(fileId, assignmentRef);
        return result.lastInsertRowid as number;
    }

    insertConversation(assignmentId: number, student: string): number {
        const stmt = this.db.prepare(
            `INSERT INTO conversation (assignment_id, student) VALUES (?, ?)`
        );
        const result = stmt.run(assignmentId, student);
        return result.lastInsertRowid as number;
    }

    insertMessage(
        conversationId: number,
        role: string | null,
        timestamp: string | null,
        content: string,
        sortOrder: number
    ): void {
        const stmt = this.db.prepare(
            `INSERT INTO message (conversation_id, role, timestamp, content, sort_order) VALUES (?, ?, ?, ?, ?)`
        );
        stmt.run(conversationId, role, timestamp, content, sortOrder);
    }

    getMessagesByFileId(fileId: number): Array<{ id: number; role: string | null; timestamp: string | null; content: string; sortOrder: number }> {
        const stmt = this.db.prepare(`
            SELECT m.id, m.role, m.timestamp, m.content, m.sort_order AS sortOrder
            FROM message m
            JOIN conversation c ON m.conversation_id = c.id
            JOIN assignment a ON c.assignment_id = a.id
            WHERE a.file_id = ?
            ORDER BY a.id, c.id, m.sort_order
        `);
        const rows = stmt.all(fileId) as Array<{ id: number; role: string | null; timestamp: string | null; content: string; sortOrder: number }>;
        return rows.map((r) => ({
            id: r.id,
            role: r.role,
            timestamp: r.timestamp,
            content: r.content,
            sortOrder: r.sortOrder,
        }));
    }

    getAssignmentsByFileId(fileId: number): Array<{ id: number; fileId: number; assignmentRef: string }> {
        const stmt = this.db.prepare(
            `SELECT id, file_id AS fileId, assignment_ref AS assignmentRef FROM assignment WHERE file_id = ? ORDER BY id`
        );
        const rows = stmt.all(fileId) as Array<{ id: number; fileId: number; assignmentRef: string }>;
        return rows;
    }

    getConversationsByAssignmentId(assignmentId: number): Array<{ id: number; assignmentId: number; student: string }> {
        const stmt = this.db.prepare(
            `SELECT id, assignment_id AS assignmentId, student FROM conversation WHERE assignment_id = ? ORDER BY id`
        );
        const rows = stmt.all(assignmentId) as Array<{ id: number; assignmentId: number; student: string }>;
        return rows;
    }

    getMessagesByConversationId(conversationId: number): Array<{ id: number; role: string | null; timestamp: string | null; content: string; sortOrder: number }> {
        const stmt = this.db.prepare(`
            SELECT id, role, timestamp, content, sort_order AS sortOrder
            FROM message WHERE conversation_id = ? ORDER BY sort_order
        `);
        const rows = stmt.all(conversationId) as Array<{ id: number; role: string | null; timestamp: string | null; content: string; sortOrder: number }>;
        return rows;
    }

    close(): void {
        this.db.close();
    }
}

let dbInstance: LocalDatabase | null = null;

export function getDatabase(): LocalDatabase {
    if (!dbInstance) {
        dbInstance = new LocalDatabase();
    }
    return dbInstance;
}