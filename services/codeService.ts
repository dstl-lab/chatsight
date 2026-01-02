import { getDatabase } from './database';
import { diffLines } from 'diff';

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

class LocalCodeService {
    private db = getDatabase();

    async getCode(index: number): Promise<CodeData> {
        const codeData = this.db.getCode(index);

        if (!codeData) {
            throw new Error(`Code at index ${index} not found`);
        }

        return codeData;
    }

    async getDiff(fromIndex: number, toIndex: number): Promise<DiffData> {
        const fromCode = this.db.getCode(fromIndex);
        const toCode = this.db.getCode(toIndex);

        if (!fromCode || !toCode) {
            throw new Error('One or both code versions not found');
        }

        const diff = this.computeDiff(fromCode.codeContent, toCode.codeContent);

        return {
            fromIndex,
            toIndex,
            diff
        };
    }

    async saveCode(index: number, code: string): Promise<void> {
        this.db.saveCode(index, code);
    }

    private computeDiff(oldCode: string, newCode: string): DiffLine[] {
        const changes = diffLines(oldCode, newCode);
        const diff: DiffLine[] = [];
        
        let oldLineNum = 1;
        let newLineNum = 1;

        changes.forEach(part => {
            const lines = part.value.split('\n');

            if (lines.length > 0 && lines[lines.length - 1] === '') {
                lines.pop();
            }

            lines.forEach(line => {
                if (part.added) {
                    diff.push({
                        type: 'added',
                        line: newLineNum++,
                        content: line
                    });
                } else if (part.removed) {
                    diff.push({
                        type: 'removed',
                        line: newLineNum,
                        originalLine: oldLineNum++,
                        content: line
                    });
                } else {
                    diff.push({
                        type: 'unchanged',
                        line: newLineNum++,
                        originalLine: oldLineNum++,
                        content: line
                    });
                }
            });
        });
        return diff;
    }
}

export const codeService = new LocalCodeService();