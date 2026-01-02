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