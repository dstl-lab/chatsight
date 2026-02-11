#!/usr/bin/env npx tsx
/**
 * Import cleaned, standardized TXT files into the database.
 * Usage: npm run import-cleaned -- <path1> [path2 ...]
 * Example: npm run import-cleaned -- ~/Downloads/cleaned_DSC10.txt ~/Downloads/cleaned_CSE8A.txt
 */

import * as path from "path";
import { dumpCleanedFile, type DumpResult } from "../services/cleanedImport";

const paths = process.argv.slice(2).filter((p) => p && !p.startsWith("-"));
if (paths.length === 0) {
    console.error("Usage: npm run import-cleaned -- <path1> [path2 ...]");
    console.error("Example: npm run import-cleaned -- ~/Downloads/cleaned_DSC10.txt ~/Downloads/cleaned_CSE8A.txt");
    process.exit(1);
}

const results: { path: string; result: DumpResult }[] = [];
const errors: { path: string; error: unknown }[] = [];

for (const filePath of paths) {
    const resolved = path.resolve(filePath);
    try {
        const result = dumpCleanedFile(resolved);
        results.push({ path: resolved, result });
    } catch (e) {
        errors.push({ path: resolved, error: e });
    }
}

for (const { path: p, result } of results) {
    console.log(`Imported: ${p}`);
    console.log(
        `  file_id=${result.fileId} | assignments=${result.assignmentCount} | conversations=${result.conversationCount} | messages=${result.messageCount}`
    );
}

for (const { path: p, error } of errors) {
    console.error(`Failed: ${p}`);
    console.error(" ", error instanceof Error ? error.message : String(error));
}

process.exit(errors.length > 0 ? 1 : 0);
