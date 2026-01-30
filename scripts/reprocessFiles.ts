#!/usr/bin/env npx tsx
/**
 * Re-process existing files to populate assignment/conversation/message tables.
 * This is a one-time migration for files uploaded before the dump was wired.
 */

import { getDatabase } from '../services/database';
import { parseCleanedTxt } from '../services/parseCleanedTxt';

const db = getDatabase();

// Get all files
const files = db.getAllFiles();
console.log(`Found ${files.length} files to process`);

for (const fileMeta of files) {
    const file = db.getFile(fileMeta.id);
    if (!file) {
        console.log(`  File ${fileMeta.id} not found, skipping`);
        continue;
    }

    // Check if already has assignments
    const existingAssignments = db.getAssignmentsByFileId(file.id);
    if (existingAssignments.length > 0) {
        console.log(`  File ${file.id} (${file.filename}) already has ${existingAssignments.length} assignments, skipping`);
        continue;
    }

    // Parse and dump
    console.log(`  Processing file ${file.id}: ${file.filename}`);
    try {
        const parsed = parseCleanedTxt(file.content);
        
        if (parsed.conversations.length === 0) {
            console.log(`    No conversations found (may not be cleaned format)`);
            continue;
        }

        let assignmentCount = 0;
        let conversationCount = 0;
        let messageCount = 0;
        const seenAssignmentRefs = new Set<string>();

        for (const conv of parsed.conversations) {
            const assignmentRef = conv.assignment;
            const assignmentId = db.getOrCreateAssignment(file.id, assignmentRef);
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

        console.log(`    Created: ${assignmentCount} assignments, ${conversationCount} conversations, ${messageCount} messages`);
    } catch (e) {
        console.error(`    Error processing file ${file.id}:`, e instanceof Error ? e.message : e);
    }
}

db.close();
console.log('Done!');
