/**
 * Dump cleaned, standardized TXT into the database (file → assignment → conversation → message).
 */

import * as fs from "fs";
import * as path from "path";
import { getDatabase } from "./database";
import { parseCleanedTxt } from "./parseCleanedTxt";

export interface DumpResult {
    fileId: number;
    filename: string;
    assignmentCount: number;
    conversationCount: number;
    messageCount: number;
}

/**
 * Dump a cleaned TXT file into the database.
 * Creates a file record, then assignments (unique per file+ref), conversations, and messages.
 */
export function dumpCleanedFile(
    filePath: string,
    options?: { filename?: string }
): DumpResult {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const content = fs.readFileSync(absolutePath, "utf8");
    const filename = options?.filename ?? path.basename(absolutePath);
    return dumpCleanedContent(filename, content);
}

/**
 * Dump cleaned TXT content into the database.
 */
export function dumpCleanedContent(filename: string, content: string): DumpResult {
    const db = getDatabase();
    const parsed = parseCleanedTxt(content);
    const fileSize = Buffer.byteLength(content, "utf8");
    const fileId = db.saveFile(filename, content, "txt", fileSize);
    const { assignmentCount, conversationCount, messageCount } = dumpParsedIntoFile(fileId, parsed);
    return {
        fileId,
        filename,
        assignmentCount,
        conversationCount,
        messageCount,
    };
}

/**
 * Parse cleaned content and insert assignments/conversations/messages for an existing file.
 * Use this after saving a file (e.g. on TXT upload) to populate the hierarchy.
 * Returns counts; does not create a file row.
 */
export function dumpCleanedContentIntoFile(fileId: number, content: string): DumpResult {
    const parsed = parseCleanedTxt(content);
    const { assignmentCount, conversationCount, messageCount } = dumpParsedIntoFile(fileId, parsed);
    return {
        fileId,
        filename: "",
        assignmentCount,
        conversationCount,
        messageCount,
    };
}

function dumpParsedIntoFile(
    fileId: number,
    parsed: { conversations: Array<{ student: string; assignment: string; messages: Array<{ role: string | null; timestamp: string | null; content: string }> }> }
): { assignmentCount: number; conversationCount: number; messageCount: number } {
    const db = getDatabase();
    let assignmentCount = 0;
    let conversationCount = 0;
    let messageCount = 0;
    const seenAssignmentRefs = new Set<string>();

    for (const conv of parsed.conversations) {
        const assignmentRef = conv.assignment;
        const assignmentId = db.getOrCreateAssignment(fileId, assignmentRef);
        if (!seenAssignmentRefs.has(assignmentRef)) {
            seenAssignmentRefs.add(assignmentRef);
            assignmentCount++;
        }

        const conversationId = db.insertConversation(assignmentId, conv.student);
        conversationCount++;

        conv.messages.forEach((msg, idx) => {
            db.insertMessage(
                conversationId,
                msg.role,
                msg.timestamp,
                msg.content,
                idx
            );
            messageCount++;
        });
    }

    return { assignmentCount, conversationCount, messageCount };
}
